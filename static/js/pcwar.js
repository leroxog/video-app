(() => {
  const appEl = document.getElementById("pcwarApp");
  const targetKey = appEl.dataset.targetKey;
  const targetName = document.querySelector(".pcwar-topbar-title").firstChild.textContent.trim();
  const tutorial = appEl.dataset.tutorial === "true";
  const base = "/games/pcwar/" + targetKey;

  const output = document.getElementById("pcwarOutput");
  const input = document.getElementById("pcwarInput");
  const promptEl = document.getElementById("pcwarPrompt");
  const briefIp = document.getElementById("pcwarBriefIp");
  const tutorialBox = document.getElementById("pcwarTutorialBox");
  const helpBtn = document.getElementById("pcwarHelpBtn");

  const TUTORIAL_STEPS = [
    { cmd: "nmap &lt;IP&gt;", text: "Scanne offene Ports mit:" },
    { cmd: "hydra -l &lt;user&gt; -P wordlist ssh://&lt;IP&gt;", text: "Knacke das Passwort mit:" },
    { cmd: "ssh &lt;user&gt;@&lt;IP&gt;", text: "Logge dich per SSH ein mit:" },
    { cmd: "ls  /  cat secrets.txt", text: "Sieh dir die Dateien an und lies die geheime Datei:" },
    { cmd: "", text: "Geschafft! Der Hack ist abgeschlossen." },
  ];

  const state = {
    mode: "shell", // shell | await_password | remote
    portsKnown: false,
    username: null,
    password: null,
    pendingSshUser: null,
    ip: null,
    tutorialStep: 0,
  };

  const history = [];
  let historyIndex = -1;

  function setTutorialStep(idx) {
    if (!tutorial || !tutorialBox) return;
    state.tutorialStep = idx;
    const step = TUTORIAL_STEPS[Math.min(idx, TUTORIAL_STEPS.length - 1)];
    tutorialBox.innerHTML =
      "<b>Tutorial -- Schritt " + Math.min(idx + 1, 4) + "/4</b>" +
      "<p>" + step.text + "</p>" +
      (step.cmd ? "<code>" + step.cmd + "</code>" : "");
  }

  function line(text, cls) {
    const el = document.createElement("div");
    el.className = "pcwar-line" + (cls ? " " + cls : "");
    el.innerHTML = text;
    output.appendChild(el);
    output.scrollTop = output.scrollHeight;
    return el;
  }

  function lineDelayed(text, cls, delayMs) {
    return new Promise((resolve) => {
      setTimeout(() => {
        line(text, cls);
        window.leroxGamesSounds.keyFlash();
        resolve();
      }, delayMs);
    });
  }

  async function playSequence(lines, gap) {
    for (const [text, cls] of lines) {
      await lineDelayed(text, cls, gap);
    }
  }

  async function callApi(path, body) {
    const res = await fetch(base + path, {
      method: "POST",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, data };
  }

  function updatePrompt() {
    promptEl.textContent =
      state.mode === "remote" ? state.username + "@" + targetKey + ":~$" : "attacker@kali:~$";
  }

  function scrambleReveal(el, finalText, stepMs) {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$";
    let revealed = 0;
    return new Promise((resolve) => {
      const interval = setInterval(() => {
        let display = "";
        for (let i = 0; i < finalText.length; i++) {
          display += i < revealed ? finalText[i] : chars[Math.floor(Math.random() * chars.length)];
        }
        el.textContent = display;
        if (revealed >= finalText.length) {
          clearInterval(interval);
          resolve();
        } else {
          revealed++;
        }
      }, stepMs);
    });
  }

  const HELP_TEXT = [
    ["Verfügbare Befehle:", "dim"],
    ["  nmap &lt;IP&gt;                       -- Ports scannen", "dim"],
    ["  hydra -l &lt;user&gt; -P wl ssh://&lt;IP&gt;  -- Passwort knacken", "dim"],
    ["  ssh &lt;user&gt;@&lt;IP&gt;                 -- einloggen", "dim"],
    ["  ls / cat &lt;datei&gt;                -- (nach dem Login) Dateien lesen", "dim"],
    ["  clear                            -- Bildschirm leeren", "dim"],
  ];

  async function runShellCommand(raw) {
    const trimmed = raw.trim();
    const cmd = trimmed.split(/\s+/)[0] || "";

    if (cmd === "help") {
      HELP_TEXT.forEach(([t, c]) => line(t, c));
      return;
    }
    if (cmd === "clear") {
      output.innerHTML = "";
      return;
    }
    if (cmd === "nmap") {
      await playSequence(
        [
          ["Starting Nmap...", "dim"],
          ["Scanning " + state.ip + " [1000 ports]...", "dim"],
        ],
        450
      );
      const { ok, data } = await callApi("/scan-ports");
      if (!ok) return line(data.error || "Fehler.", "error");
      line("PORT     STATE  SERVICE", "result");
      data.ports.forEach((p) => line(String(p.port).padEnd(9, " ") + "open   " + p.service, "result"));
      state.portsKnown = true;
      window.leroxGamesSounds.aiAnswer();
      if (state.tutorialStep === 0) setTutorialStep(1);
      return;
    }
    if (cmd === "hydra") {
      if (!state.portsKnown) return line("hydra: Ziel unbekannt -- erst 'nmap " + state.ip + "' ausführen.", "error");
      await playSequence(
        [
          ["Hydra starting...", "dim"],
          ["[DATA] attacking ssh://" + state.ip + ":22/", "dim"],
          ["[ATTEMPT] login \"admin\" - pass \"123456\" - 1 of 14344399", "dim"],
          ["[ATTEMPT] login \"admin\" - pass \"password\" - 2 of 14344399", "dim"],
        ],
        450
      );
      const { ok, data } = await callApi("/crack-password");
      if (!ok) return line(data.error || "Fehler.", "error");
      state.username = data.username;
      const passLine = line("", "result");
      await scrambleReveal(passLine, data.password, 55);
      line("[22][ssh] host: " + state.ip + "   login: " + data.username + "   password: " + data.password, "result");
      line("1 valid password found", "dim");
      window.leroxGamesSounds.aiAnswer();
      if (state.tutorialStep === 1) setTutorialStep(2);
      return;
    }
    if (cmd === "ssh") {
      if (!state.username) return line("ssh: erst das Passwort knacken (hydra).", "error");
      const arg = trimmed.split(/\s+/)[1] || "";
      const user = arg.includes("@") ? arg.split("@")[0] : state.username;
      state.pendingSshUser = user;
      line(user + "@" + state.ip + "'s password:", "dim");
      state.mode = "await_password";
      input.type = "password";
      return;
    }
    if (cmd === "") return;
    line("bash: " + cmd + ": command not found", "error");
  }

  async function runRemoteCommand(raw) {
    const trimmed = raw.trim();
    const cmd = trimmed.split(/\s+/)[0] || "";

    if (cmd === "help") {
      HELP_TEXT.forEach(([t, c]) => line(t, c));
      return;
    }
    if (cmd === "clear") {
      output.innerHTML = "";
      return;
    }
    if (cmd === "whoami") {
      line(state.username, "file");
      return;
    }
    if (cmd === "ls") {
      line("secrets.txt", "file");
      return;
    }
    if (cmd === "cat") {
      const arg = trimmed.split(/\s+/)[1] || "";
      if (!arg || !arg.includes("secrets")) {
        return line("cat: " + (arg || "") + ": No such file or directory", "error");
      }
      const { ok, data } = await callApi("/read-file");
      if (!ok) return line(data.error || "Fehler.", "error");
      const p = data.profile;
      line("--- secrets.txt ---", "dim");
      line("name: " + p.name, "file");
      line("age: " + p.age, "file");
      line("email: " + p.email, "file");
      line("password: " + data.password, "file");
      line("note: " + p.note, "file");
      line("");
      line("ZUGRIFF ABGESCHLOSSEN -- alle Daten hier sind erfunden.", "result");
      window.leroxGamesSounds.solved();
      if (state.tutorialStep === 3) setTutorialStep(4);
      return;
    }
    if (cmd === "exit") {
      line("logout", "dim");
      state.mode = "shell";
      updatePrompt();
      return;
    }
    if (cmd === "") return;
    line("bash: " + cmd + ": command not found", "error");
  }

  async function handlePasswordEntry(pw) {
    input.type = "text";
    const { ok } = await callApi("/login", { username: state.pendingSshUser, password: pw });
    if (!ok) {
      line("Permission denied, please try again.", "error");
      state.mode = "shell";
      return;
    }
    state.username = state.pendingSshUser;
    line("");
    line("Welcome to " + targetName + " (fake shell).", "dim");
    line("Last login: just now from 10.0.0.1", "dim");
    state.mode = "remote";
    updatePrompt();
    window.leroxGamesSounds.aiAnswer();
    if (state.tutorialStep === 2) setTutorialStep(3);
  }

  input.addEventListener("keydown", async (e) => {
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (history.length && historyIndex > 0) {
        historyIndex--;
        input.value = history[historyIndex];
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyIndex < history.length - 1) {
        historyIndex++;
        input.value = history[historyIndex];
      } else {
        historyIndex = history.length;
        input.value = "";
      }
      return;
    }
    if (e.key !== "Enter") return;

    const value = input.value;
    input.value = "";
    window.leroxGamesSounds.click();

    if (state.mode === "await_password") {
      // Real ssh never echoes the password or shows a "$" prompt line for
      // it -- just silently move on to the auth result.
      await handlePasswordEntry(value);
      return;
    }

    history.push(value);
    historyIndex = history.length;
    line(value, "cmd");
    if (state.mode === "remote") {
      await runRemoteCommand(value);
    } else {
      await runShellCommand(value);
    }
  });

  helpBtn.addEventListener("click", () => {
    input.focus();
    HELP_TEXT.forEach(([t, c]) => line(t, c));
  });

  document.addEventListener("click", () => input.focus());

  // Fresh attempt on load -- the IP is handed over immediately, like a
  // real engagement's target IP, not something to "discover".
  callApi("/start").then(({ data }) => {
    state.ip = data.ip;
    briefIp.textContent = data.ip;
    line("Verbindung zu " + targetName + " (" + data.ip + ") vorbereitet.", "dim");
    line("Tippe 'help' für verfügbare Befehle.", "dim");
    if (tutorial) setTutorialStep(0);
    input.focus();
  });
})();
