// Full-mesh peer-to-peer voice chat for Kampumion, signaled over the same
// Socket.IO connection the lobby/room state already uses (see app.py's
// km_rtc_signal handler -- a pure relay, no audio ever touches the
// server). Per-role muting is entirely client-side and local to each
// player's own browser:
//   - role "deaf": every remote participant's audio element stays muted,
//     regardless of who's speaking -- this player never hears anyone.
//   - role "mute": never acquires a microphone track at all, so nobody
//     else ever receives audio from this player.
// STUN-only (Google's public server) -- there is no TURN relay in this
// deployment, so voice may fail to connect across some restrictive
// NATs/corporate networks; that's an accepted limitation of a
// no-infrastructure setup, not something silently faked as working.
class KampumionVoice {
  constructor(socket, myUserId, myRole) {
    this.socket = socket;
    this.myUserId = myUserId;
    this.myRole = myRole;
    this.localStream = null;
    this.peers = new Map(); // otherUserId -> RTCPeerConnection
    this.iceServers = [{ urls: "stun:stun.l.google.com:19302" }];
  }

  async start() {
    if (this.myRole === "mute") return; // never acquire a mic at all
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch (e) {
      console.warn("Mikrofon nicht verfügbar:", e);
    }
  }

  _createPeer(otherUserId) {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => pc.addTrack(track, this.localStream));
    }
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.socket.emit("km_rtc_signal", { to: otherUserId, signal: { candidate: e.candidate } });
      }
    };
    pc.ontrack = (e) => {
      let audioEl = document.getElementById("km-voice-" + otherUserId);
      if (!audioEl) {
        audioEl = document.createElement("audio");
        audioEl.id = "km-voice-" + otherUserId;
        audioEl.autoplay = true;
        document.body.appendChild(audioEl);
      }
      audioEl.srcObject = e.streams[0];
      audioEl.muted = this.myRole === "deaf";
    };
    this.peers.set(otherUserId, pc);
    return pc;
  }

  // Only the lower user_id should call connectTo() for a given pair,
  // avoiding a simultaneous-offer race -- the other side just responds
  // to the incoming offer inside handleSignal().
  async connectTo(otherUserId) {
    if (this.peers.has(otherUserId) || otherUserId === this.myUserId) return;
    const pc = this._createPeer(otherUserId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.socket.emit("km_rtc_signal", { to: otherUserId, signal: { sdp: pc.localDescription } });
  }

  async handleSignal(fromUserId, signal) {
    let pc = this.peers.get(fromUserId);
    if (!pc) pc = this._createPeer(fromUserId);
    if (signal.sdp) {
      await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
      if (signal.sdp.type === "offer") {
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this.socket.emit("km_rtc_signal", { to: fromUserId, signal: { sdp: pc.localDescription } });
      }
    } else if (signal.candidate) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
      } catch (e) {
        console.warn("ICE candidate error", e);
      }
    }
  }

  disconnectFrom(otherUserId) {
    const pc = this.peers.get(otherUserId);
    if (pc) {
      pc.close();
      this.peers.delete(otherUserId);
    }
    const audioEl = document.getElementById("km-voice-" + otherUserId);
    if (audioEl) audioEl.remove();
  }

  stopAll() {
    for (const userId of Array.from(this.peers.keys())) this.disconnectFrom(userId);
    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => t.stop());
      this.localStream = null;
    }
  }
}
window.KampumionVoice = KampumionVoice;
