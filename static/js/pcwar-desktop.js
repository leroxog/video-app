(() => {
  const appEl = document.getElementById("pcwarDesktopApp");
  const targetKey = appEl.dataset.targetKey;
  const targetName = appEl.dataset.targetName;
  const difficulty = appEl.dataset.difficulty;
  const base = "/games/pcwar/" + targetKey;

  const clockEl = document.getElementById("pcwarClock");
  const notesIcon = document.getElementById("pcwarNotesIcon");
  const notesOverlay = document.getElementById("pcwarNotesOverlay");
  const notesBody = document.getElementById("pcwarNotesBody");
  const notesClose = document.getElementById("pcwarNotesClose");
  const trashIcon = document.getElementById("pcwarTrashIcon");
  const restartBtn = document.getElementById("pcwarRestartBtn");

  let currentIp = null;

  function updateClock() {
    const now = new Date();
    clockEl.textContent = now.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  }
  updateClock();
  setInterval(updateClock, 15000);

  function renderNotes() {
    notesBody.innerHTML = "";
    const lines = [
      ["--- Auftrag.txt ---", "dim"],
      ["Ziel: " + targetName, "file"],
      ["Schwierigkeit: " + difficulty, "file"],
      ["IP: " + (currentIp || "wird geladen…"), "file"],
      ["", ""],
      ["Öffne Terminal und finde mit nmap heraus, welche Dienste offen sind.", "dim"],
      ["Danach: hydra für das Passwort, ssh zum Einloggen, dann secrets.txt lesen.", "dim"],
    ];
    lines.forEach(([t, c]) => {
      const el = document.createElement("div");
      el.className = "pcwar-line" + (c ? " " + c : "");
      el.textContent = t;
      notesBody.appendChild(el);
    });
  }

  document.querySelectorAll(".pcwar-dicon").forEach((el) => {
    el.addEventListener("click", () => window.leroxGamesSounds.click());
  });

  notesIcon.addEventListener("click", () => {
    window.leroxGamesSounds.click();
    renderNotes();
    notesOverlay.style.display = "flex";
  });
  notesClose.addEventListener("click", () => (notesOverlay.style.display = "none"));

  trashIcon.addEventListener("click", () => {
    window.leroxGamesSounds.wrong();
    trashIcon.classList.add("shake");
    setTimeout(() => trashIcon.classList.remove("shake"), 400);
  });

  restartBtn.addEventListener("click", async () => {
    window.leroxGamesSounds.click();
    const res = await fetch(base + "/restart", { method: "POST" });
    const data = await res.json();
    currentIp = data.ip;
    restartBtn.textContent = "✓ Neuer Versuch";
    setTimeout(() => (restartBtn.textContent = "↻ Neu starten"), 1200);
  });

  fetch(base + "/start", { method: "POST" })
    .then((res) => res.json())
    .then((data) => {
      currentIp = data.ip;
    });
})();
