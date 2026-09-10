(function () {
  "use strict";

  var canvas = document.getElementById("nxCanvas");
  var statusEl = document.getElementById("nxStatus");
  var heardEl = document.getElementById("nxHeard");
  var micBtn = document.getElementById("nxMic");
  var kbBtn = document.getElementById("nxKb");
  var typeRow = document.getElementById("nxTypeRow");
  var typeInput = document.getElementById("nxTypeInput");
  var typeSend = document.getElementById("nxTypeSend");

  var state = "idle";        // idle | listening | thinking | speaking
  var conversing = false;    // true while a hands-free session is running
  var chatId = null;
  var permBlocked = false;

  function setStatus(t) { statusEl.textContent = t; }
  function showHeard(t) { heardEl.textContent = "„" + t + "“"; heardEl.classList.add("show"); }
  function hideHeard() { heardEl.classList.remove("show"); }

  // ===================== 3D glass orb (raymarched purple smoke) =============
  var THREE = window.THREE, renderer, scene, camera, uniforms, raf = 0, running = true;
  var bounceP = 0, bounceV = 0, audioLvl = 0, audioTgt = 0, thinkLvl = 0, listenLvl = 0, lastT = 0;

  var FRAG = [
    "precision highp float;",
    "uniform vec2 uRes; uniform float uTime,uAudio,uBounce,uThink,uListen;",
    "float hash(vec3 p){ p=fract(p*0.3183099+0.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }",
    "float vn(vec3 x){ vec3 i=floor(x),f=fract(x); f=f*f*(3.0-2.0*f);",
    " return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),",
    "  mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z); }",
    "float fbm(vec3 p){ float a=0.5,s=0.0; for(int i=0;i<4;i++){ s+=a*vn(p); p*=2.03; a*=0.5; } return s; }",
    "void main(){",
    " vec2 uv=(gl_FragCoord.xy-0.5*uRes)/uRes.y;",
    " vec3 bg=mix(vec3(0.024,0.017,0.045),vec3(0.09,0.045,0.16),0.5+0.5*uv.y);",
    " bg+=0.08*vec3(0.5,0.2,0.9)*(uAudio+0.15)*smoothstep(1.2,0.0,length(uv));",
    " vec3 col=bg;",
    " vec3 ro=vec3(0.0,0.0,3.4); vec3 rd=normalize(vec3(uv,-1.55));",
    " vec3 ctr=vec3(0.0,uBounce,0.0);",
    " float R=0.335+0.024*sin(uTime*2.1)+uAudio*0.085;",
    " vec3 oc=ro-ctr; float b=dot(oc,rd); float c2=dot(oc,oc)-R*R; float disc=b*b-c2;",
    " if(disc>0.0){ float sq=sqrt(disc); float tN=-b-sq; float tF=-b+sq;",
    "  if(tF>0.0){",
    "   vec3 pIn=ro+rd*max(tN,0.0); vec3 nrm=normalize(pIn-ctr);",
    "   vec3 rr=refract(rd,nrm,0.70); float span=tF-max(tN,0.0);",
    "   float dens=0.0; vec3 acc=vec3(0.0);",
    "   for(int i=0;i<26;i++){",
    "    float f=(float(i)+0.5)/26.0;",
    "    vec3 sp=(pIn-ctr)+rr*f*span*1.18; float rl=length(sp);",
    "    if(rl>R) continue;",
    "    float tt=uTime*(0.24+0.18*uThink+0.12*uAudio);",
    "    vec3 q=sp*3.2; q+=vec3(fbm(q*0.8+tt),fbm(q*0.7+4.0-tt),fbm(q*0.75+tt*1.3))*1.35;",
    "    float d=fbm(q*1.7+vec3(0.0,-tt*1.4,0.0));",
    "    d=smoothstep(0.36,0.66,d)*smoothstep(R*1.06,R*0.05,rl);",
    "    d*=(1.9+uAudio*3.0+uThink*1.3+uListen*0.7);",
    "    vec3 pc=mix(vec3(0.28,0.03,0.58),vec3(0.92,0.55,1.0),f*0.55+0.4*uAudio+0.2*sin(uTime*1.4+rl*5.0));",
    "    acc+=(1.0-dens)*d*pc*0.34; dens+=(1.0-dens)*d*0.32;",
    "    if(dens>0.985) break;",
    "   }",
    "   float ndv=max(dot(-rd,nrm),0.0);",
    "   float fres=pow(1.0-ndv,3.5);",
    "   vec3 refl=reflect(rd,nrm);",
    "   float spec=pow(max(dot(refl,normalize(vec3(0.55,0.7,0.55))),0.0),70.0);",
    "   float spec2=pow(max(dot(refl,normalize(vec3(-0.5,0.35,0.6))),0.0),22.0);",
    "   vec3 glassTint=bg*0.55+vec3(0.05,0.02,0.10);",
    "   col=mix(glassTint,acc+glassTint*0.10,clamp(dens,0.0,1.0));",
    "   col+=vec3(0.58,0.42,0.95)*fres*0.4;",
    "   col+=vec3(1.0)*spec*1.0;",
    "   col+=vec3(0.8,0.6,1.0)*spec2*0.25;",
    "   col+=vec3(0.55,0.28,0.95)*(1.0-fres)*0.16*(0.4+uAudio+0.4*uThink);",
    "   col+=vec3(0.95,0.6,1.0)*pow(1.0-ndv,8.0)*0.6;",
    "  }",
    " }",
    " col=pow(max(col,0.0),vec3(0.85));",
    " col*=1.0-0.26*dot(uv,uv);",
    " gl_FragColor=vec4(col,1.0);",
    "}"
  ].join("\n");

  function initOrb() {
    if (!THREE) return false;
    try {
      renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: false, alpha: false, powerPreference: "high-performance" });
    } catch (e) { return false; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.4) * 0.64);
    scene = new THREE.Scene();
    camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    uniforms = {
      uRes: { value: new THREE.Vector2(1, 1) }, uTime: { value: 0 },
      uAudio: { value: 0 }, uBounce: { value: 0 }, uThink: { value: 0 }, uListen: { value: 0 },
    };
    var mat = new THREE.ShaderMaterial({
      uniforms: uniforms,
      vertexShader: "void main(){ gl_Position=vec4(position.xy,0.0,1.0); }",
      fragmentShader: FRAG,
    });
    scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));
    resize();
    window.addEventListener("resize", resize);
    lastT = performance.now();
    raf = requestAnimationFrame(frame);
    return true;
  }

  function resize() {
    if (!renderer) return;
    var w = canvas.clientWidth || window.innerWidth;
    var h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    var px = renderer.getPixelRatio();
    uniforms.uRes.value.set(w * px, h * px);
  }

  function kick(strength) {
    bounceV += strength;
    audioTgt = Math.max(audioTgt, Math.min(1, strength * 0.16));
  }

  function frame(now) {
    if (!running) { raf = 0; return; }
    var dt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
    bounceV += (-26.0 * bounceP - 7.5 * bounceV) * dt;
    bounceP += bounceV * dt;
    audioTgt *= Math.pow(0.015, dt);
    if (state === "listening" && analyser) audioTgt = Math.max(audioTgt, readMic());
    if (state === "speaking") audioTgt = Math.max(audioTgt, 0.20 + 0.14 * Math.abs(Math.sin(now * 0.021)));
    audioLvl += (audioTgt - audioLvl) * Math.min(1, dt * 14);
    thinkLvl += ((state === "thinking" ? 1 : 0) - thinkLvl) * Math.min(1, dt * 4);
    listenLvl += ((state === "listening" ? 1 : 0) - listenLvl) * Math.min(1, dt * 4);
    uniforms.uTime.value = now * 0.001;
    uniforms.uAudio.value = audioLvl;
    uniforms.uBounce.value = bounceP * 0.30;
    uniforms.uThink.value = thinkLvl;
    uniforms.uListen.value = listenLvl;
    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  }

  function fallbackOrb() {
    canvas.style.background =
      "radial-gradient(circle at 50% 46%, rgba(190,95,255,.7), rgba(95,32,160,.35) 40%, rgba(8,6,14,1) 66%)";
  }
  if (!initOrb()) fallbackOrb();

  // ===================== mic capture (recording + level) ==================
  var micStream = null, audioCtx = null, analyser = null, micData = null;
  var mediaRec = null, chunks = [], recStartAt = 0;
  var vadTimer = null, sawSpeech = false, silentFrames = 0;

  function pickMime() {
    var t = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus", ""];
    for (var i = 0; i < t.length; i++) {
      if (!t[i]) return "";
      if (window.MediaRecorder && MediaRecorder.isTypeSupported(t[i])) return t[i];
    }
    return "";
  }

  function getMic() {
    if (micStream) return Promise.resolve(micStream);
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return Promise.reject("nogum");
    return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }).then(function (s) {
      micStream = s;
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      var src = audioCtx.createMediaStreamSource(s);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);
      micData = new Uint8Array(analyser.frequencyBinCount);
      return s;
    });
  }
  function readMic() {
    if (!analyser) return 0;
    analyser.getByteFrequencyData(micData);
    var sum = 0;
    for (var i = 2; i < 60; i++) sum += micData[i];   // voice band
    return Math.min(1, (sum / 58) / 70);
  }
  function releaseMic() {
    if (micStream) { micStream.getTracks().forEach(function (t) { t.stop(); }); micStream = null; }
    if (audioCtx) { try { audioCtx.close(); } catch (e) {} audioCtx = null; }
    analyser = null; micData = null;
  }

  // ===================== conversation loop ===============================
  function startListening() {
    if (state === "listening" || state === "recording") return;
    hideHeard();
    if (!window.MediaRecorder) { openTyping(); setStatus("Sprachaufnahme geht hier nicht — tipp"); return; }
    setStatus("Erlaube das Mikrofon …");
    getMic().then(function (stream) {
      state = "listening";
      micBtn.classList.add("listening");
      setStatus("Nex hört zu … (nochmal tippen zum Abschicken)");
      chunks = [];
      sawSpeech = false; silentFrames = 0;
      var mime = pickMime();
      try { mediaRec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream); }
      catch (e) { mediaRec = new MediaRecorder(stream); }
      mediaRec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
      mediaRec.onstop = onRecordingStopped;
      mediaRec.start();
      recStartAt = Date.now();
      // simple voice-activity auto-stop
      vadTimer = setInterval(function () {
        var lvl = readMic();
        if (lvl > 0.10) { sawSpeech = true; silentFrames = 0; }
        else if (sawSpeech) { silentFrames++; }
        if (sawSpeech && silentFrames > 14) finishListening();   // ~1.5s of silence
        if (Date.now() - recStartAt > 20000) finishListening();  // hard cap 20s
      }, 110);
    }).catch(function (err) {
      micBtn.classList.remove("listening");
      permBlocked = true;
      state = "idle"; conversing = false;
      setStatus("Kein Mikro-Zugriff — nutz die Tastatur");
      openTyping();
    });
  }

  function finishListening() {
    if (vadTimer) { clearInterval(vadTimer); vadTimer = null; }
    micBtn.classList.remove("listening");
    if (mediaRec && mediaRec.state !== "inactive") { try { mediaRec.stop(); } catch (e) {} }
    else onRecordingStopped();
  }

  function stopConversation() {
    conversing = false;
    if (vadTimer) { clearInterval(vadTimer); vadTimer = null; }
    if (mediaRec && mediaRec.state !== "inactive") { try { mediaRec.stop(); } catch (e) {} }
    if (window.speechSynthesis) { try { window.speechSynthesis.cancel(); } catch (e) {} }
    micBtn.classList.remove("listening");
    releaseMic();
    state = "idle";
    setStatus("Tipp den Kreis und red mit Nex");
  }

  function onRecordingStopped() {
    var recorded = chunks.slice();
    chunks = [];
    var tooShort = Date.now() - recStartAt < 400 || !recorded.length;
    if (tooShort || !sawSpeech) {
      if (conversing) startListening(); else { state = "idle"; setStatus("Tipp den Kreis und red mit Nex"); }
      return;
    }
    var blob = new Blob(recorded, { type: recorded[0].type || "audio/webm" });
    var ext = (blob.type.indexOf("mp4") >= 0) ? "mp4" : (blob.type.indexOf("ogg") >= 0 ? "ogg" : "webm");
    state = "thinking";
    setStatus("Nex versteht dich …");
    var fd = new FormData();
    fd.append("audio", blob, "speech." + ext);
    fetch("/api/pl/nex/voice", { method: "POST", body: fd })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        var txt = (j && j.transcript || "").trim();
        if (!txt) {
          setStatus("Hab dich nicht verstanden — nochmal");
          if (conversing) setTimeout(startListening, 600);
          else state = "idle";
          return;
        }
        showHeard(txt);
        askNex(txt);
      })
      .catch(function () {
        setStatus("Verbindung weg");
        if (conversing) setTimeout(startListening, 800); else state = "idle";
      });
  }

  function askNex(text) {
    state = "thinking";
    setStatus("Nex denkt nach …");
    var body = { message: text, character: window.NEX.character, project_type: window.NEX.projectType, via_voice: true };
    if (chatId) body.chat_id = chatId;
    fetch("/api/ai/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j.ok) { speak("Ging gerade nicht. Nochmal."); return; }
        chatId = j.chat_id;
        pollJob(j.job_id);
      })
      .catch(function () { speak("Verbindung ist weg."); });
  }
  function pollJob(id) {
    fetch("/api/ai/chat/" + id).then(function (r) { return r.json(); }).then(function (j) {
      if (j.status === "running") { setTimeout(function () { pollJob(id); }, 650); return; }
      if (j.status === "done" && j.reply) speak(j.reply);
      else speak("Ich bin grad nicht erreichbar.");
    }).catch(function () { speak("Verbindungsfehler."); });
  }

  function stripMd(t) {
    return String(t)
      .replace(/```[\s\S]*?```/g, " (Code) ")
      .replace(/[*_`#>]/g, "")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/\s+/g, " ").trim();
  }
  var voices = [];
  function loadVoices() { try { voices = window.speechSynthesis.getVoices() || []; } catch (e) {} }
  loadVoices();
  if (window.speechSynthesis) window.speechSynthesis.onvoiceschanged = loadVoices;
  function germanVoice() {
    for (var i = 0; i < voices.length; i++) if (/^de([-_]|$)/i.test(voices[i].lang)) return voices[i];
    return null;
  }

  function speak(text) {
    hideHeard();
    if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) {
      state = "idle"; setStatus("Sprachausgabe hier nicht verfügbar"); return;
    }
    state = "speaking";
    setStatus("Nex spricht …");
    var u = new SpeechSynthesisUtterance(stripMd(text));
    u.lang = "de-DE"; u.rate = 1.05; u.pitch = 0.95;
    var v = germanVoice(); if (v) u.voice = v;
    u.onstart = function () { kick(6); };
    u.onboundary = function () { kick(2.4 + Math.random() * 2.6); };
    u.onend = function () {
      if (conversing) startListening();
      else { state = "idle"; setStatus("Tipp den Kreis, um weiterzureden"); }
    };
    u.onerror = u.onend;
    try { window.speechSynthesis.cancel(); window.speechSynthesis.speak(u); } catch (e) { u.onend(); }
  }

  // ===================== interaction =====================================
  function tap() {
    if (window.speechSynthesis && state === "speaking") { try { window.speechSynthesis.cancel(); } catch (e) {} }
    if (state === "listening") { finishListening(); return; }        // send now
    if (state === "thinking") return;
    // start / resume a hands-free conversation
    conversing = true;
    startListening();
  }
  micBtn.addEventListener("click", tap);
  canvas.addEventListener("click", function () {
    if (state === "idle" || state === "speaking" || state === "listening") tap();
    else stopConversation();   // tapping the orb while thinking = abort
  });

  function openTyping() { typeRow.classList.add("show"); setTimeout(function () { typeInput.focus(); }, 100); }
  kbBtn.addEventListener("click", function () {
    if (typeRow.classList.contains("show")) typeRow.classList.remove("show");
    else openTyping();
  });
  function sendTyped() {
    var t = typeInput.value.trim();
    if (!t) return;
    typeInput.value = "";
    typeRow.classList.remove("show");
    conversing = false;          // typed -> don't auto-open the mic afterwards
    showHeard(t);
    askNex(t);
  }
  typeSend.addEventListener("click", sendTyped);
  typeInput.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); sendTyped(); } });

  // ===================== lifecycle ======================================
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      running = false;
      stopConversation();
    } else if (!running) {
      running = true; lastT = performance.now();
      if (renderer) raf = requestAnimationFrame(frame);
    }
  });

  fetch("/api/ai/chats?character=" + encodeURIComponent(window.NEX.character))
    .then(function (r) { return r.json(); })
    .then(function (j) { if (j.ok && j.chats.length) chatId = j.chats[0].id; })
    .catch(function () {});
})();
