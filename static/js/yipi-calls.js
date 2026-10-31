/* Nex calls (yipi-calls.js): a call with a friend or a group, live, from the head of a chat. The handset in the chat starts it (`Y.calls.start`), the page asks the server every few seconds whether somebody
   is ringing (a window with a ringing sound appears, a phone that is locked gets a notification), and in a call the browser does two things every third of a second in one request: it sends the sound of
   the microphone and it fetches the sound of the others. The sound travels as short pieces (16 kHz, one byte per sample, 8 bit companded) and is never recorded: the server keeps a piece in memory
   until ten seconds after the person it was for has played it (this page reports that with the next request) and deletes it then. */
(function () {
  "use strict";

  const Y = window.Yipi;
  const Api = window.YipiApi;
  const { h, icon, toast, fill } = Y;

  const RATE = 16000;                     // samples per second that travel
  const SYNC_MS = 300;                    // how often the browser sends and asks (one request does both)
  const JITTER = 0.25;                    // seconds of voice held back before it plays, so a late piece does not crackle
  const MAX_LAG = 1.8;                    // when the voice is later than this, pieces are skipped to catch up
  const MAX_BYTES = 40000;                // the server takes 48000 bytes at most in one go
  const POLL_MS = 3000;                   // how often the page asks whether somebody rings
  const COMPAND = 255;

  /* ---- the sound: 8 bit companding (quiet voices get more of the 256 steps than loud ones), as on a telephone line */
  const encode = (value) => {
    const x = Math.max(-1, Math.min(1, value));
    const y = Math.sign(x) * Math.log1p(COMPAND * Math.abs(x)) / Math.log1p(COMPAND);
    return Math.round((y + 1) / 2 * 255);
  };
  const DECODE = new Float32Array(256);
  for (let i = 0; i < 256; i += 1) { const y = (i / 255) * 2 - 1; DECODE[i] = Math.sign(y) * (Math.pow(1 + COMPAND, Math.abs(y)) - 1) / COMPAND; }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const clockText = (seconds) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
  const fromBase64 = (text) => { const raw = atob(text); const bytes = new Uint8Array(raw.length); for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i); return bytes; };

  /* ---- one sound system for the page: made on the first tap (a browser plays nothing before the person has tapped once), so that a ringing sound can play later */
  let shared = null;
  function audio() {
    if (!shared) {
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) return null;
      try { shared = new Context(); } catch (error) { return null; }
    }
    if (shared.state === "suspended") shared.resume().catch(() => {});
    return shared;
  }
  for (const type of ["pointerdown", "keydown", "touchend"]) document.addEventListener(type, () => { if (Y.me) audio(); }, { passive: true });

  /* A ringing sound: "incoming" (a little tune, with the phone buzzing) or "ringback" (the long note a caller hears while it rings at the other end). */
  function ringer(kind) {
    const notes = kind === "incoming" ? [[659.25, 0, 0.16], [880, 0.2, 0.16], [659.25, 0.4, 0.16], [880, 0.6, 0.16], [987.77, 1.0, 0.34]] : [[425, 0, 1.0]];
    const volume = kind === "incoming" ? 0.2 : 0.1;
    const play = () => {
      const ctx = audio();
      if (ctx && ctx.state === "running") {
        const start = ctx.currentTime + 0.03;
        for (const [pitch, at, length] of notes) {
          const oscillator = ctx.createOscillator();
          const gain = ctx.createGain();
          oscillator.type = "sine";
          oscillator.frequency.value = pitch;
          oscillator.connect(gain);
          gain.connect(ctx.destination);
          gain.gain.setValueAtTime(0, start + at);
          gain.gain.linearRampToValueAtTime(volume, start + at + 0.02);
          gain.gain.setValueAtTime(volume, start + at + length - 0.05);
          gain.gain.linearRampToValueAtTime(0, start + at + length);
          oscillator.start(start + at);
          oscillator.stop(start + at + length + 0.05);
        }
      }
      if (kind === "incoming") navigator.vibrate?.([350, 150, 350, 150, 350]);
    };
    play();
    const timer = setInterval(play, kind === "incoming" ? 2400 : 3200);
    return { stop() { clearInterval(timer); navigator.vibrate?.(0); } };
  }

  /* two short notes: up when the call is connected, down when it is over */
  function chime(up) {
    const ctx = audio();
    if (!ctx || ctx.state !== "running") return;
    const start = ctx.currentTime + 0.02;
    (up ? [660, 880] : [660, 440]).forEach((pitch, index) => {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.frequency.value = pitch;
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      gain.gain.setValueAtTime(0.0001, start + index * 0.14);
      gain.gain.exponentialRampToValueAtTime(0.15, start + index * 0.14 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + index * 0.14 + 0.13);
      oscillator.start(start + index * 0.14);
      oscillator.stop(start + index * 0.14 + 0.15);
    });
  }

  const ENDED = { missed: "Nicht erreicht", cancelled: "Aufgelegt", declined: "Abgelehnt", ended: "Anruf beendet", timeout: "Anruf beendet", lost: "Verbindung verloren", offline: "Keine Verbindung" };

  // ------------------------------------------------------------------------------------------- the call this page is in
  let session = null;

  /* The microphone, turned into pieces of sound: `take()` answers what was heard since the last time as bytes (or null). */
  async function openMicrophone(ctx) {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    const source = ctx.createMediaStreamSource(stream);
    const processor = ctx.createScriptProcessor(2048, 1, 1);
    const quiet = ctx.createGain();
    quiet.gain.value = 0;                                         // (the processor has to be connected to run; nothing of it may be heard)
    source.connect(processor);
    processor.connect(quiet);
    quiet.connect(ctx.destination);
    const ratio = ctx.sampleRate / RATE;
    const heard = [];
    let sum = 0, count = 0, position = 0, next = ratio;
    processor.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);
      for (let i = 0; i < input.length; i += 1) {
        sum += input[i];
        count += 1;
        position += 1;
        if (position >= next) { heard.push(sum / count); sum = 0; count = 0; next += ratio; }
      }
      if (heard.length > RATE * 3) heard.splice(0, heard.length - RATE * 3);             // (a browser that held the page back: only the last three seconds count)
    };
    return {
      stream,
      take() {
        if (!heard.length) return null;
        const pieces = heard.splice(0, Math.min(heard.length, MAX_BYTES));
        const bytes = new Uint8Array(pieces.length);
        for (let i = 0; i < pieces.length; i += 1) bytes[i] = encode(pieces[i]);
        return bytes;
      },
      drop() { heard.length = 0; },
      mute(on) { stream.getAudioTracks().forEach((track) => { track.enabled = !on; }); },
      close() { processor.onaudioprocess = null; try { source.disconnect(); processor.disconnect(); quiet.disconnect(); } catch (error) { /* already gone */ } stream.getTracks().forEach((track) => track.stop()); },
    };
  }

  /* A piece of the voice of somebody: plays it after the one before it. Answers false when it was skipped (the voice was too far behind). */
  function playPiece(s, from, bytes, seq) {
    const ctx = shared;
    const length = Math.max(1, Math.round(bytes.length * ctx.sampleRate / RATE));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    const step = (bytes.length - 1) / Math.max(1, length - 1);
    for (let i = 0; i < length; i += 1) {                          // (the page plays at the rate of the device: a straight line between two samples)
      const at = i * step, low = Math.floor(at), high = Math.min(bytes.length - 1, low + 1);
      data[i] = DECODE[bytes[low]] * (1 - (at - low)) + DECODE[bytes[high]] * (at - low);
    }
    const now = ctx.currentTime;
    let when = s.timeline.get(from) || 0;
    if (when < now + 0.02) when = now + (s.timeline.has(from) ? 0.12 : JITTER);             // the first piece waits a little; after a gap it starts soon
    if (when - now > MAX_LAG) { s.playedSeq = Math.max(s.playedSeq, seq); return false; }
    const node = ctx.createBufferSource();
    node.buffer = buffer;
    node.connect(s.volume);
    node.start(when);
    s.timeline.set(from, when + buffer.duration);
    node.onended = () => { s.playedSeq = Math.max(s.playedSeq, seq); };
    return true;
  }

  function who(call) {
    if (call.group) return call.group.name;
    const other = call.people.find((person) => !(Y.me && person.handle === Y.me.handle));
    return other ? other.name : "Anruf";
  }

  /* ---- the call screen */
  function screen(s) {
    const face = h("div", { class: "call-face" });
    const title = h("b", { class: "call-name" });
    const status = h("span", { class: "call-status", role: "status", "aria-live": "polite" });
    const crowd = h("div", { class: "call-crowd" });
    const muteButton = h("button", { class: "call-btn", type: "button", "aria-label": "Mikrofon aus", "aria-pressed": "false" }, icon("mic"));
    const hangButton = h("button", { class: "call-btn hang", type: "button", "aria-label": "Auflegen" }, icon("callEnd"));
    const smallButton = h("button", { class: "call-btn small", type: "button", "aria-label": "Verkleinern", "aria-pressed": "false" }, icon("minimize"));
    const element = h("div", { class: "call-screen", role: "dialog", "aria-label": "Anruf" },
      h("div", { class: "call-top" }, smallButton), h("div", { class: "call-center" }, face, title, status, crowd), h("div", { class: "call-bar" }, muteButton, hangButton));
    muteButton.addEventListener("click", () => {
      s.muted = !s.muted;
      s.mic?.mute(s.muted);
      muteButton.setAttribute("aria-pressed", String(s.muted));
      muteButton.setAttribute("aria-label", s.muted ? "Mikrofon an" : "Mikrofon aus");
      muteButton.classList.toggle("on", s.muted);
      fill(muteButton, icon(s.muted ? "micOff" : "mic"));
    });
    hangButton.addEventListener("click", () => finish(s, s.call.status === "ringing" ? "cancelled" : "ended", true));
    smallButton.addEventListener("click", () => {
      const mini = element.classList.toggle("mini");
      smallButton.setAttribute("aria-pressed", String(mini));
      fill(smallButton, icon(mini ? "maximize" : "minimize"));
      smallButton.setAttribute("aria-label", mini ? "Vergrößern" : "Verkleinern");
    });
    return {
      element,
      draw() {
        const call = s.call;
        title.textContent = who(call);
        element.dataset.state = s.over ? "over" : call.status;
        if (call.group) {
          fill(face, Y.groupFace ? Y.groupFace("lg") : h("span", { class: "avatar lg" }, icon("users")));
          fill(crowd, ...call.people.map((person) => h("span", { class: `call-who ${person.state}` }, Y.avatar(person, "sm"), h("small", {}, person.state === "joined" ? person.name.split(" ")[0] : person.state === "invited" ? "klingelt …" : "weg"))));
        } else {
          const other = call.people.find((person) => !(Y.me && person.handle === Y.me.handle)) || call.people[0];
          fill(face, Y.avatar(other, "xl"));
        }
        if (s.over) status.textContent = ENDED[s.over] || "Anruf beendet";
        else if (call.status === "ringing") status.textContent = call.me === "joined" && call.caller.handle === (Y.me && Y.me.handle) ? "Klingelt …" : "Verbinde …";
        else status.textContent = clockText(Math.max(0, (Date.now() - s.startedAt) / 1000));
      },
    };
  }

  function sound(s, kind) {
    s.ringer?.stop();
    s.ringer = kind ? ringer(kind) : null;
  }

  function finish(s, reason, hangUp) {
    if (s.over) return;
    s.over = reason;
    clearInterval(s.clock);
    sound(s, null);
    s.mic?.close();
    s.lock?.release?.().catch(() => {});
    if (hangUp) Api.post(`/calls/${s.call.id}/hangup`);
    chime(false);
    s.view.draw();
    s.view.element.classList.remove("mini");
    if (session === s) session = null;
    setTimeout(() => { s.view.element.classList.add("leaving"); setTimeout(() => s.view.element.remove(), 400); }, 1600);
    Y.refreshBadges?.();
  }

  /* what the answer of the server says: the state of the call and the pieces of the others */
  function take(s, data) {
    const before = s.call.status;
    s.call = data.call;
    if (s.call.status === "ended") { finish(s, s.call.reason || "ended", false); return; }
    if (s.call.status === "active" && before !== "active") {
      s.startedAt = Date.now() - (s.call.seconds || 0) * 1000;
      sound(s, null);
      chime(true);
      s.mic?.drop();
    } else if (s.call.status === "ringing" && !s.ringer && s.call.caller.handle === (Y.me && Y.me.handle)) {
      sound(s, "ringback");
    }
    for (const chunk of data.chunks || []) {
      s.after = Math.max(s.after, chunk.seq);
      try { playPiece(s, chunk.from, fromBase64(chunk.data), chunk.seq); } catch (error) { /* a broken piece is a gap of a third of a second */ }
    }
    s.view.draw();
  }

  async function loop(s) {
    let failed = 0;
    while (!s.over) {
      const started = performance.now();
      let bytes = null;
      if (s.call.status === "active" && s.mic) bytes = s.muted ? (s.mic.drop(), null) : s.mic.take();
      else s.mic?.drop();
      const reply = await Api.sync(`/calls/${s.call.id}/sync?after=${s.after}&played=${s.playedSeq}`, bytes);
      if (s.over) return;
      if (reply.ok) { failed = 0; take(s, reply.data); }
      else if (reply.status === 404 || reply.status === 409 || reply.status === 410) { finish(s, "lost", false); return; }
      else if ((failed += 1) > 12) { finish(s, "offline", true); return; }
      await sleep(Math.max(30, SYNC_MS - (performance.now() - started)));
    }
  }

  /* Takes part in a call the server has (the caller after it was made, the callee after answering). */
  async function join(call, microphone) {
    const ctx = audio();
    const s = { call, mic: microphone, muted: false, after: call.seq || 0, playedSeq: 0, timeline: new Map(), over: null, startedAt: Date.now() - (call.seconds || 0) * 1000, ringer: null, lock: null, clock: 0, view: null, volume: null };
    s.volume = ctx.createGain();
    s.volume.gain.value = 1;
    s.volume.connect(ctx.destination);
    s.view = screen(s);
    session = s;
    document.body.append(s.view.element);
    s.view.draw();
    s.clock = setInterval(() => { if (!s.over && s.call.status === "active") s.view.draw(); }, 500);
    if (call.status === "ringing" && call.caller.handle === (Y.me && Y.me.handle)) sound(s, "ringback");
    else if (call.status === "active") chime(true);
    try { s.lock = await navigator.wakeLock?.request("screen"); } catch (error) { s.lock = null; }      // (the screen stays on in a call where the browser allows it)
    loop(s);
    return s;
  }

  async function microphone() {
    const ctx = audio();
    if (!ctx || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { toast("Dein Browser kann keine Anrufe."); return null; }
    try { return await openMicrophone(ctx); } catch (error) { toast("Das Mikrofon darf Nex nicht hören. Erlaube es in den Einstellungen des Browsers."); return null; }
  }

  /* Rings a friend ({handle}) or a group ({groupId}): the microphone first (this tap is the one that lets the page make sound), then the call. */
  async function start(target) {
    if (!Y.requireLogin("Melde dich an, um anzurufen.")) return;
    if (session) { toast("Du bist schon in einem Anruf."); return; }
    const mic = await microphone();
    if (!mic) return;
    const reply = await Api.post("/calls", target.handle ? { handle: target.handle } : { groupId: target.groupId });
    if (reply.status === 409 && reply.data.error === "in_call" && reply.data.call) { join(reply.data.call, mic); return; }
    if (!reply.ok) {
      mic.close();
      toast(reply.data && reply.data.error === "call_not_allowed" && target.name ? `Du kannst ${target.name} erst anrufen, wenn die Person dir folgt oder deine Nachricht angenommen hat.`
        : reply.data && reply.data.error === "busy" && target.name ? `${target.name} spricht gerade mit jemand anderem.` : Api.message(reply));
      return;
    }
    join(reply.data.call, mic);
  }

  // ------------------------------------------------------------------------------------------- somebody rings
  let card = null;                         // {id, element, ringer, title, timer}
  let polling = false;

  function drop(missed) {
    if (!card) return;
    card.ringer?.stop();
    document.title = card.title;
    card.element.classList.add("leaving");
    const element = card.element;
    setTimeout(() => element.remove(), 400);
    if (missed) toast("Verpasster Anruf");
    card = null;
  }

  function showCard(call, resume) {
    drop(false);
    const caller = call.people.find((person) => person.handle === call.caller.handle) || call.caller;
    const text = resume ? "Dein Anruf läuft noch" : call.group ? `${caller.name} ruft in „${call.group.name}“ an …` : "ruft dich an …";
    const answer = h("button", { class: "call-btn answer", type: "button", "aria-label": resume ? "Zurück zum Anruf" : "Annehmen" }, icon("call"));
    const decline = h("button", { class: "call-btn hang", type: "button", "aria-label": resume ? "Auflegen" : "Ablehnen" }, icon("callEnd"));
    const element = h("div", { class: "call-incoming", role: "alertdialog", "aria-label": "Eingehender Anruf" },
      Y.avatar(caller, "lg"), h("div", { class: "call-incoming-text" }, h("b", {}, call.group ? call.group.name : caller.name), h("span", {}, text)), decline, answer);
    card = { id: call.id, element, ringer: resume ? null : ringer("incoming"), title: document.title };
    if (!resume) document.title = `📞 ${call.group ? call.group.name : caller.name} ruft an`;
    document.body.append(element);
    answer.addEventListener("click", async () => {
      answer.disabled = decline.disabled = true;
      const mic = await microphone();
      if (!mic) { answer.disabled = decline.disabled = false; return; }
      if (resume) { drop(false); join(call, mic); return; }
      const reply = await Api.post(`/calls/${call.id}/answer`);
      drop(false);
      if (!reply.ok) { mic.close(); toast(Api.message(reply)); return; }
      join(reply.data.call, mic);
    });
    decline.addEventListener("click", async () => {
      decline.disabled = answer.disabled = true;
      drop(false);
      await Api.post(`/calls/${call.id}/${resume ? "hangup" : "decline"}`);
    });
  }

  async function pollIncoming() {
    if (!Y.me || document.hidden || polling || session) return;
    polling = true;
    const reply = await Api.get("/calls/incoming");
    polling = false;
    if (!reply.ok || session) return;
    const { call, active } = reply.data;
    if (call) { if (!card || card.id !== call.id) showCard(call, false); }
    else if (active) { if (!card || card.id !== active.id) showCard(active, true); }
    else if (card) drop(true);
  }
  setInterval(pollIncoming, POLL_MS);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) pollIncoming(); });
  setTimeout(pollIncoming, 1200);
  window.addEventListener("pagehide", () => { if (session && !session.over && navigator.sendBeacon) navigator.sendBeacon(`/api/yipi/calls/${session.call.id}/hangup`, new Blob(["{}"], { type: "application/json" })); });

  /* Is a call going on in this group? (The chat shows a green dot on the handset.) */
  async function groupCall(groupId) {
    const reply = await Api.get(`/calls/active?groupId=${groupId}`);
    return reply.ok ? reply.data.call : null;
  }

  Y.calls = { start, groupCall, get busy() { return !!session; } };
})();
