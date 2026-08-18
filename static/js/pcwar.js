(() => {
  const appEl = document.getElementById("pcwarApp");
  const targetKey = appEl.dataset.targetKey;
  const tutorial = appEl.dataset.tutorial === "true";
  const base = "/games/pcwar/" + targetKey;

  const overlay = document.getElementById("pcwarWindowOverlay");
  const windowTitle = document.getElementById("pcwarWindowTitle");
  const windowBody = document.getElementById("pcwarWindowBody");
  const closeBtn = document.getElementById("pcwarWindowClose");
  const tutorialBanner = document.getElementById("pcwarTutorialBanner");
  const clockEl = document.getElementById("pcwarClock");
  const profileView = document.getElementById("pcwarProfileView");
  const targetScreen = document.getElementById("pcwarTargetScreen");

  const icons = {
    ip: document.getElementById("pcwarIconIp"),
    ports: document.getElementById("pcwarIconPorts"),
    password: document.getElementById("pcwarIconPassword"),
    login: document.getElementById("pcwarIconLogin"),
    results: document.getElementById("pcwarIconResults"),
  };

  const TUTORIAL_STEPS = {
    ip: '<b>Tutorial -- Schritt 1/4:</b> Öffne den <b>IP-Scanner</b>, um die Adresse des Ziels herauszufinden.',
    ports: '<b>Tutorial -- Schritt 2/4:</b> Öffne den <b>Port-Scanner</b>, um herauszufinden, welche Dienste offen sind.',
    password: '<b>Tutorial -- Schritt 3/4:</b> Öffne den <b>Passwort-Cracker</b>, um das Zugangspasswort zu knacken.',
    login: '<b>Tutorial -- Schritt 4/4:</b> Öffne <b>Zugriff</b>, um dich mit IP und Passwort einzuloggen.',
    done: '<b>Geschafft!</b> Öffne <b>Ergebnisse</b>, um die erbeuteten Daten zu sehen.',
  };
  const TOOL_ORDER = ["ip", "ports", "password", "login"];

  function updateClock() {
    const now = new Date();
    clockEl.textContent = now.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  }
  updateClock();
  setInterval(updateClock, 15000);

  function setTutorialStep(key) {
    if (!tutorial || !tutorialBanner) return;
    tutorialBanner.innerHTML = TUTORIAL_STEPS[key] || "";
    for (const tool of TOOL_ORDER) {
      icons[tool].classList.toggle("suggested", tool === key);
    }
  }

  function lockIconsForTutorial() {
    if (!tutorial) return;
    TOOL_ORDER.slice(1).forEach((tool) => (icons[tool].disabled = true));
    setTutorialStep("ip");
  }

  function unlockNextTutorialStep(justDoneTool) {
    if (!tutorial) return;
    const idx = TOOL_ORDER.indexOf(justDoneTool);
    const next = TOOL_ORDER[idx + 1];
    if (next) {
      icons[next].disabled = false;
      setTutorialStep(next);
    } else {
      setTutorialStep("done");
    }
  }

  function openWindow(title) {
    windowTitle.textContent = title;
    windowBody.innerHTML = "";
    overlay.style.display = "flex";
  }
  closeBtn.addEventListener("click", () => (overlay.style.display = "none"));

  function appendLine(text, cls) {
    const line = document.createElement("div");
    line.className = "pcwar-line" + (cls ? " " + cls : "");
    line.textContent = text;
    windowBody.appendChild(line);
    windowBody.scrollTop = windowBody.scrollHeight;
    return line;
  }

  function playLines(lines, delayMs) {
    return lines.reduce(
      (chain, text) =>
        chain.then(
          () =>
            new Promise((resolve) => {
              setTimeout(() => {
                appendLine(text);
                window.leroxGamesSounds.keyFlash();
                resolve();
              }, delayMs);
            })
        ),
      Promise.resolve()
    );
  }

  async function callStep(path) {
    const res = await fetch(base + path, { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Unbekannter Fehler.");
    return data;
  }

  function markStatus(id, text) {
    const el = document.getElementById(id);
    el.textContent = "● " + text;
    el.classList.add("done");
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

  icons.ip.addEventListener("click", async () => {
    window.leroxGamesSounds.click();
    openWindow("IP-Scanner");
    await playLines(["Initiiere Netzwerk-Trace...", "Verfolge Paketrouten zu " + targetKeyLabel() + "...", "Ziel lokalisiert."], 550);
    try {
      const data = await callStep("/scan-ip");
      appendLine("");
      appendLine("IP-Adresse: " + data.ip, "result");
      markStatus("pcwarStatusIp", "IP: " + data.ip);
      unlockNextTutorialStep("ip");
    } catch (e) {
      appendLine("Fehler: " + e.message, "error");
      window.leroxGamesSounds.wrong();
    }
  });

  icons.ports.addEventListener("click", async () => {
    window.leroxGamesSounds.click();
    openWindow("Port-Scanner");
    await playLines(["Scanne Ports 1-65535...", "Prüfe Antwortzeiten...", "Offene Ports gefunden."], 550);
    try {
      const data = await callStep("/scan-ports");
      appendLine("");
      data.ports.forEach((p) => appendLine("Port " + p.port + "/tcp  offen  " + p.service, "result"));
      markStatus("pcwarStatusPorts", data.ports.length + " offene Ports gefunden");
      unlockNextTutorialStep("ports");
    } catch (e) {
      appendLine("Fehler: " + e.message, "error");
      window.leroxGamesSounds.wrong();
    }
  });

  icons.password.addEventListener("click", async () => {
    window.leroxGamesSounds.click();
    openWindow("Passwort-Cracker");
    await playLines(["Lade Wörterbuch...", "Teste Kombinationen..."], 550);
    try {
      const data = await callStep("/crack-password");
      const line = appendLine("", "result");
      await scrambleReveal(line, data.password, 55);
      appendLine("Passwort geknackt (Dienst auf Port " + data.login_port + ").", "result");
      markStatus("pcwarStatusPassword", "Passwort geknackt");
      window.leroxGamesSounds.aiAnswer();
      unlockNextTutorialStep("password");
    } catch (e) {
      appendLine("Fehler: " + e.message, "error");
      window.leroxGamesSounds.wrong();
    }
  });

  icons.login.addEventListener("click", async () => {
    window.leroxGamesSounds.click();
    openWindow("Zugriff");
    await playLines(["Verbinde zum Ziel...", "Authentifiziere mit erbeuteten Zugangsdaten..."], 600);
    try {
      const data = await callStep("/login");
      appendLine("");
      appendLine("ZUGRIFF GEWÄHRT.", "result");
      window.leroxGamesSounds.solved();
      icons.results.disabled = false;
      showProfile(data.profile, data.ip, data.password);
      unlockNextTutorialStep("login");
    } catch (e) {
      appendLine("Fehler: " + e.message, "error");
      window.leroxGamesSounds.wrong();
    }
  });

  let lastProfile = null;
  function showProfile(profile, ip, password) {
    lastProfile = { profile, ip, password };
    targetScreen.style.display = "none";
    profileView.style.display = "block";
    profileView.innerHTML =
      '<div class="pcwar-profile-title">🔓 ZUGRIFF GEWÄHRT -- private Daten</div>' +
      '<div class="pcwar-profile-row"><b>Name:</b> ' + profile.name + "</div>" +
      '<div class="pcwar-profile-row"><b>Alter:</b> ' + profile.age + "</div>" +
      '<div class="pcwar-profile-row"><b>E-Mail:</b> ' + profile.email + "</div>" +
      '<div class="pcwar-profile-row"><b>Passwort:</b> ' + password + "</div>" +
      '<div class="pcwar-profile-row"><b>IP:</b> ' + ip + "</div>" +
      '<div class="pcwar-profile-note">' + profile.note + "</div>" +
      '<p style="color:var(--lg-text-dim); font-size:11.5px;">Alles auf dieser Seite ist erfunden -- keine echte Person, keine echte Adresse.</p>';
  }

  icons.results.addEventListener("click", () => {
    window.leroxGamesSounds.click();
    openWindow("Ergebnisse");
    if (lastProfile) {
      showProfile(lastProfile.profile, lastProfile.ip, lastProfile.password);
      overlay.style.display = "none";
    }
  });

  function targetKeyLabel() {
    return appEl.dataset.targetKey.toUpperCase();
  }

  // Start a fresh attempt as soon as the page loads.
  fetch(base + "/start", { method: "POST" }).then(() => {
    lockIconsForTutorial();
  });
})();
