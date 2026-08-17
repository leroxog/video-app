(() => {
  const appEl = document.getElementById("kmRoomApp");
  const code = appEl.dataset.code;
  const myUserId = parseInt(appEl.dataset.userId, 10);
  let myRole = appEl.dataset.role || null;
  let solved = appEl.dataset.solved === "true";

  const roleBanner = document.getElementById("kmRoleBanner");
  const flashEl = document.getElementById("kmFlash");
  const flashKeyEl = document.getElementById("kmFlashKey");
  const wrongFlashEl = document.getElementById("kmWrongFlash");
  const micIndicator = document.getElementById("kmMicIndicator");
  const solvedOverlay = document.getElementById("kmSolvedOverlay");
  const solvedCodeEl = document.getElementById("kmSolvedCode");
  const rematchBtn = document.getElementById("kmRematchBtn");
  const codeInput = document.getElementById("kmCodeInput");
  const submitBtn = document.getElementById("kmSubmitBtn");
  const aiForm = document.getElementById("kmAiForm");
  const aiQuestionInput = document.getElementById("kmAiQuestion");
  const aiLog = document.getElementById("kmAiLog");

  const ROLE_INFO = {
    blind: ["BLIND", "Dein Bildschirm ist schwarz -- ein Tastendruck zeigt kurz einen Blitz. Nur du darfst den Code eintippen."],
    deaf: ["TAUB", "Du hörst niemanden über Sprachchat -- lies mit, wenn andere tippen."],
    mute: ["STUMM", "Niemand hört dich über Sprachchat -- du kannst nur zuhören."],
    normal: ["", "Du siehst und hörst alles normal."],
  };

  function renderRoleBanner() {
    if (!myRole) return;
    const [label, desc] = ROLE_INFO[myRole] || ["", ""];
    roleBanner.innerHTML = (label ? "<b>" + label + "</b><br>" : "") + desc;
  }
  renderRoleBanner();

  const socket = io();
  const knownPlayers = new Set();
  let voice = null;

  socket.on("connect", () => {
    socket.emit("km_join_lobby", { code });
  });

  socket.on("km_role", (data) => {
    myRole = data.role;
    appEl.dataset.role = myRole;
    renderRoleBanner();
    startVoice();
  });

  socket.on("km_state", (state) => {
    for (const p of state.players) {
      if (p.user_id === myUserId) continue;
      const isNew = !knownPlayers.has(p.user_id);
      knownPlayers.add(p.user_id);
      if (isNew && voice && myUserId < p.user_id) {
        voice.connectTo(p.user_id);
      }
    }
  });

  socket.on("km_player_left", (data) => {
    knownPlayers.delete(data.user_id);
    if (voice) voice.disconnectFrom(data.user_id);
  });

  socket.on("km_rtc_signal", (data) => {
    if (voice) voice.handleSignal(data.from, data.signal);
  });

  function startVoice() {
    if (voice || !myRole) return;
    voice = new KampumionVoice(socket, myUserId, myRole);
    voice.start().then(() => {
      if (myRole === "mute") {
        micIndicator.textContent = "🔇 Stumm (deine Rolle)";
      } else if (voice.localStream) {
        micIndicator.textContent = "🎤 Mikrofon aktiv";
      } else {
        micIndicator.textContent = "⚠️ Kein Mikrofonzugriff";
      }
      if (myRole === "deaf") {
        micIndicator.textContent += " -- du hörst niemanden";
      }
    });
    for (const otherId of knownPlayers) {
      if (myUserId < otherId) voice.connectTo(otherId);
    }
  }

  // --- Blind terminal: any keypress -> broadcast + local flash ---
  document.addEventListener("keydown", (e) => {
    if (solved) return;
    if (document.activeElement === codeInput) return; // typing the code itself doesn't trigger a flash
    const key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
    socket.emit("km_key_press", { key });
  });

  socket.on("km_flash", (data) => {
    window.leroxGamesSounds.keyFlash();
    flashKeyEl.textContent = data.key;
    flashEl.classList.add("on");
    clearTimeout(flashEl._t);
    flashEl._t = setTimeout(() => flashEl.classList.remove("on"), 420);
  });

  // --- Blind code submission ---
  if (submitBtn) {
    submitBtn.addEventListener("click", () => {
      const value = (codeInput.value || "").trim();
      if (!value) return;
      socket.emit("km_submit_code", { code: value });
    });
    codeInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submitBtn.click();
    });
  }

  socket.on("km_wrong", () => {
    window.leroxGamesSounds.wrong();
    wrongFlashEl.classList.add("on");
    setTimeout(() => wrongFlashEl.classList.remove("on"), 250);
    if (codeInput) {
      codeInput.value = "";
      codeInput.focus();
    }
  });

  socket.on("km_solved", (data) => {
    solved = true;
    window.leroxGamesSounds.solved();
    solvedCodeEl.textContent = "Code war: " + data.code;
    solvedOverlay.style.display = "flex";
  });

  if (rematchBtn) {
    rematchBtn.addEventListener("click", () => socket.emit("km_rematch"));
  }
  socket.on("km_reset", () => {
    window.location.href = "/games/kampumion/" + code;
  });

  // --- AI hint panel (sighted players only) ---
  if (aiForm) {
    aiForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const question = (aiQuestionInput.value || "").trim();
      if (!question) return;
      socket.emit("km_ask_ai", { question });
      aiQuestionInput.value = "";
    });
  }
  socket.on("km_ai_answer", (data) => {
    window.leroxGamesSounds.aiAnswer();
    const turn = document.createElement("div");
    turn.className = "km-ai-turn";
    turn.innerHTML = '<div class="q"></div><div class="a"></div>';
    turn.querySelector(".q").textContent = "❓ " + data.question;
    turn.querySelector(".a").textContent = "🖥️ " + data.answer;
    aiLog.appendChild(turn);
    aiLog.scrollTop = aiLog.scrollHeight;
  });

  window.addEventListener("beforeunload", () => {
    if (voice) voice.stopAll();
    socket.emit("km_leave_lobby");
  });
})();
