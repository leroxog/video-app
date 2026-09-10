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
  var stoppedByUser = true;  // don't auto-restart listening after this
  var chatId = null;
  var rec = null, SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  var micStream = null, audioCtx = null, analyser = null, micData = null;

  function setStatus(t) { statusEl.textContent = t; }
  function showHeard(t) { heardEl.textContent = "„" + t + "\""; heardEl.classList.add("show"); }
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
    "float fbm(vec3 p){ float a=0.5,s=0.0; for(int i=0;i<3;i++){ s+=a*vn(p); p*=2.03; a*=0.5; } return s; }",
    "void main(){",
    " vec2 uv=(gl_FragCoord.xy-0.5*uRes)/uRes.y;",
    " vec3 bg=mix(vec3(0.028,0.02,0.05),vec3(0.10,0.05,0.17),0.5+0.5*uv.y);",
    " bg+=0.07*vec3(0.5,0.2,0.85)*(uAudio+0.18)*smoothstep(1.3,0.0,length(uv));",
    " vec3 col=bg;",
    " vec3 ro=vec3(0.0,0.0,3.4); vec3 rd=normalize(vec3(uv,-1.65));",
    " vec3 ctr=vec3(0.0,uBounce,0.0);",
    " float R=0.58+0.026*sin(uTime*2.1)+uAudio*0.12;",
    " vec3 oc=ro-ctr; float b=dot(oc,rd); float c2=dot(oc,oc)-R*R; float disc=b*b-c2;",
    " if(disc>0.0){ float sq=sqrt(disc); float tN=-b-sq; float tF=-b+sq;",
    "  if(tF>0.0){",
    "   vec3 pIn=ro+rd*max(tN,0.0); vec3 nrm=normalize(pIn-ctr);",
    "   vec3 rr=refract(rd,nrm,0.72); float span=tF-max(tN,0.0);",
    "   float dens=0.0; vec3 acc=vec3(0.0);",
    "   for(int i=0;i<18;i++){",
    "    float f=(float(i)+0.5)/18.0;",
    "    vec3 sp=(pIn-ctr)+rr*f*span*1.15; float rl=length(sp);",
    "    if(rl>R) continue;",
    "    float tt=uTime*(0.16+0.13*uThink+0.06*uAudio);",
    "    vec3 q=sp*2.3; q+=vec3(fbm(q*0.8+tt),fbm(q*0.7+4.0-tt),fbm(q*0.75+tt*1.3))*0.85;",
    "    float d=fbm(q*1.5+vec3(0.0,-tt*1.1,0.0));",
    "    d=smoothstep(0.46,0.80,d)*smoothstep(R*1.02,R*0.12,rl);",
    "    d*=(1.15+uAudio*2.2+uThink*0.8+uListen*0.45);",
    "    vec3 pc=mix(vec3(0.34,0.06,0.62),vec3(0.80,0.46,1.0),f*0.55+0.4*uAudio+0.18*sin(uTime*1.3+rl*5.0));",
    "    acc+=(1.0-dens)*d*pc*0.22; dens+=(1.0-dens)*d*0.20;",
    "    if(dens>0.97) break;",
    "   }",
    "   float ndv=max(dot(-rd,nrm),0.0);",
    "   float fres=pow(1.0-ndv,3.5);",
    "   vec3 refl=reflect(rd,nrm);",
    "   float spec=pow(max(dot(refl,normalize(vec3(0.55,0.7,0.55))),0.0),60.0);",
    "   float spec2=pow(max(dot(refl,normalize(vec3(-0.5,0.35,0.6))),0.0),20.0);",
    "   col=mix(bg,acc+bg*0.15,clamp(dens,0.0,1.0));",
    "   col+=vec3(0.55,0.4,0.92)*fres*0.34;",
    "   col+=vec3(1.0)*spec*0.9;",
    "   col+=vec3(0.8,0.6,1.0)*spec2*0.22;",
    "   col+=vec3(0.5,0.25,0.9)*(1.0-fres)*0.12*(0.4+uAudio+0.4*uThink);",
    "   col+=vec3(0.9,0.6,1.0)*pow(1.0-ndv,8.0)*0.5;",
    "  }",
    " }",
    " col=pow(max(col,0.0),vec3(0.86));",
    " col*=1.0-0.28*dot(uv,uv);",
    " gl_FragColor=vec4(col,1.0);",
    "}"
  ].join("\n");

  function initOrb() {
    if (!THREE) return false;
    try {
      renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: false, alpha: false, powerPreference: "high-performance" });
    } catch (e) { return false; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.4) * 0.62);
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
    // spring
    bounceV += (-26.0 * bounceP - 7.5 * bounceV) * dt;
    bounceP += bounceV * dt;
    // audio envelope
    audioTgt *= Math.pow(0.015, dt);
    if (state === "listening" && analyser) audioTgt = Math.max(audioTgt, readMic());
    if (state === "speaking") audioTgt = Math.max(audioTgt, 0.18 + 0.12 * Math.abs(Math.sin(now * 0.02)));
    audioLvl += (audioTgt - audioLvl) * Math.min(1, dt * 14);
    thinkLvl += ((state === "thinking" ? 1 : 0) - thinkLvl) * Math.min(1, dt * 4);
    listenLvl += ((state === "listening" ? 1 : 0) - listenLvl) * Math.min(1, dt * 4);

    uniforms.uTime.value = now * 0.001;
    uniforms.uAudio.value = audioLvl;
    uniforms.uBounce.value = bounceP * 0.32;
    uniforms.uThink.value = thinkLvl;
    uniforms.uListen.value = listenLvl;
    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  }

  // fallback if WebGL is missing
  function fallbackOrb() {
    canvas.style.background =
      "radial-gradient(circle at 50% 45%, rgba(180,90,255,.55), rgba(90,30,150,.25) 45%, rgba(10,8,16,1) 72%)";
    canvas.style.animation = "nxPulse 3s ease-in-out infinite";
  }
  if (!initOrb()) fallbackOrb();

  // ===================== mic analyser (visual only) =======================
  function startMicAnalyser() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (s) {
      micStream = s;
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      var src = audioCtx.createMediaStreamSource(s);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      src.connect(analyser);
      micData = new Uint8Array(analyser.frequencyBinCount);
    }).catch(function () {});
  }
  function readMic() {
    if (!analyser) return 0;
    analyser.getByteFrequencyData(micData);
    var sum = 0;
    for (var i = 0; i < micData.length; i++) sum += micData[i];
    return Math.min(1, (sum / micData.length) / 80);
  }
  function stopMicAnalyser() {
    if (micStream) { micStream.getTracks().forEach(function (t) { t.stop(); }); micStream = null; }
    if (audioCtx) { try { audioCtx.close(); } catch (e) {} audioCtx = null; }
    analyser = null;
  }

  // ===================== speech recognition ===============================
  var FATAL = { "not-allowed": 1, "service-not-allowed": 1, "audio-capture": 1 };

  function startListening() {
    if (state === "listening") return;
    stoppedByUser = false;
    hideHeard();
    if (!SR) { openTyping(); return; }
    state = "listening";
    setStatus("Nex hört zu …");
    micBtn.classList.add("listening");
    startMicAnalyser();
    rec = new SR();
    rec.lang = "de-DE"; rec.interimResults = false; rec.maxAlternatives = 1;
    rec.onresult = function (e) {
      var txt = (e.results[0][0].transcript || "").trim();
      micBtn.classList.remove("listening");
      stopMicAnalyser();
      if (txt) { showHeard(txt); sendToNex(txt); }
      else startListening();
    };
    rec.onerror = function (e) {
      micBtn.classList.remove("listening");
      stopMicAnalyser();
      if (FATAL[e.error]) {
        state = "idle"; stoppedByUser = true;
        setStatus("Kein Mikro-Zugriff — nutz die Tastatur");
      } else if (!stoppedByUser && state === "listening") {
        startListening();
      }
    };
    rec.onend = function () { micBtn.classList.remove("listening"); if (state === "listening") stopMicAnalyser(); };
    try { rec.start(); } catch (e) {}
  }

  function stopListening() {
    stoppedByUser = true;
    state = "idle";
    setStatus("Tipp den Kreis und red mit Nex");
    micBtn.classList.remove("listening");
    if (rec) { try { rec.stop(); } catch (e) {} }
    stopMicAnalyser();
  }

  // ===================== talk to Nex + speak back =========================
  function sendToNex(text) {
    if (!text) { startListening(); return; }
    state = "thinking";
    setStatus("Nex denkt nach …");
    var body = { message: text, character: window.NEX.character, project_type: window.NEX.projectType, via_voice: true };
    if (chatId) body.chat_id = chatId;
    fetch("/api/ai/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j.ok) { speak("Ging gerade nicht. Nochmal."); return; }
        chatId = j.chat_id;
        poll(j.job_id);
      })
      .catch(function () { speak("Verbindung ist weg."); });
  }
  function poll(id) {
    fetch("/api/ai/chat/" + id).then(function (r) { return r.json(); }).then(function (j) {
      if (j.status === "running") { setTimeout(function () { poll(id); }, 650); return; }
      if (j.status === "done" && j.reply) speak(j.reply);
      else speak("Ich bin grad nicht erreichbar.");
    }).catch(function () { speak("Verbindungsfehler."); });
  }

  function stripMd(t) {
    return String(t)
      .replace(/```[\s\S]*?```/g, " Code weggelassen. ")
      .replace(/[*_`#>]/g, "")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/\s+/g, " ")
      .trim();
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
      state = "idle"; setStatus("Sprachausgabe nicht verfügbar"); return;
    }
    state = "speaking";
    setStatus("Nex spricht …");
    var u = new SpeechSynthesisUtterance(stripMd(text));
    u.lang = "de-DE"; u.rate = 1.06; u.pitch = 0.95;
    var v = germanVoice(); if (v) u.voice = v;
    u.onstart = function () { kick(6); };
    u.onboundary = function () { kick(2.6 + Math.random() * 2.4); };
    u.onend = function () {
      if (!stoppedByUser) startListening();
      else { state = "idle"; setStatus("Tipp den Kreis, um weiterzureden"); }
    };
    u.onerror = u.onend;
    try { window.speechSynthesis.cancel(); window.speechSynthesis.speak(u); } catch (e) { u.onend(); }
  }

  // ===================== interaction =====================================
  function toggle() {
    if (window.speechSynthesis) { try { window.speechSynthesis.cancel(); } catch (e) {} }
    if (state === "listening") stopListening();
    else startListening();
  }
  micBtn.addEventListener("click", toggle);
  canvas.addEventListener("click", function () {
    if (state === "speaking" || state === "idle") toggle();
  });

  function openTyping() {
    typeRow.classList.add("show");
    setTimeout(function () { typeInput.focus(); }, 100);
  }
  kbBtn.addEventListener("click", function () {
    if (typeRow.classList.contains("show")) typeRow.classList.remove("show");
    else openTyping();
  });
  function sendTyped() {
    var t = typeInput.value.trim();
    if (!t) return;
    typeInput.value = "";
    typeRow.classList.remove("show");
    showHeard(t);
    stoppedByUser = true; // typed -> don't auto-open the mic after the reply
    sendToNex(t);
  }
  typeSend.addEventListener("click", sendTyped);
  typeInput.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); sendTyped(); } });

  // ===================== lifecycle ======================================
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      running = false;
      if (rec) { try { rec.stop(); } catch (e) {} }
      stopMicAnalyser();
      if (window.speechSynthesis) { try { window.speechSynthesis.cancel(); } catch (e) {} }
      if (state !== "idle") { state = "idle"; setStatus("Tipp den Kreis und red mit Nex"); }
      micBtn.classList.remove("listening");
    } else if (!running) {
      running = true; lastT = performance.now();
      if (renderer) raf = requestAnimationFrame(frame);
    }
  });

  // load the running Nex conversation id so it stays one thread
  fetch("/api/ai/chats?character=" + encodeURIComponent(window.NEX.character))
    .then(function (r) { return r.json(); })
    .then(function (j) { if (j.ok && j.chats.length) chatId = j.chats[0].id; })
    .catch(function () {});
})();
