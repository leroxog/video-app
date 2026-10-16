/* NSTL: asks the visitor's own browser to look up a question on Wikipedia (German and English), then hands the candidates to a swarm
   of agents (static/js/nstl-swarm-worker.js, running NstlSwarm off this thread) that argue about which one answers it best -- and shows
   the argument as it happens: a live map of the swarm and a window with real sampled talks between agents, not scripted ones.  Nothing
   here is a language model: the agents only compare a few measured properties of the Wikipedia pages and a word they made up for each. */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const root = $("app");
  const form = $("ask-form");
  const input = $("question");
  const startButton = $("start");
  const stopButton = $("stop");
  const message = $("message");
  const runSection = $("run");
  const resultSection = $("result");
  const chatList = $("chat-list");
  const map = $("map");
  const mapCtx = map.getContext("2d", { alpha: false });
  const modeButtons = { opinion: $("mode-opinion"), word: $("mode-word") };

  const STATS = { round: $("stat-round"), agents: $("stat-agents"), understanding: $("stat-understanding"), consensus: $("stat-consensus"), word: $("stat-word"), dialects: $("stat-dialects") };
  const PROGRESS_BAR = $("progress-bar");

  const MAP_COLUMNS = 220;
  const MAX_CHAT_LINES = 160;
  const REDUCE_MOTION = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const app = { worker: null, candidates: [], mode: "opinion", running: false, rows: 1 };

  /* 10 million agents is the plan, but a browser with little memory would choke on the typed arrays (about 20 bytes per agent); on
     such a device the swarm is honestly shrunk and the page says so, instead of silently failing. */
  function agentTarget() {
    const mem = Number(navigator.deviceMemory || 0);
    return mem && mem < 4 ? 2000000 : 10000000;
  }

  function setMessage(text, kind) {
    message.textContent = text || "";
    message.className = text ? `message ${kind || ""}`.trim() : "message";
  }

  function setBusy(busy) {
    app.running = busy;
    startButton.disabled = busy;
    input.disabled = busy;
    stopButton.hidden = !busy;
  }

  async function fetchWikipedia(query) {
    const byLanguage = {};
    await Promise.all(NstlCore.LANGUAGES.map(async (lang) => {
      try {
        const response = await fetch(NstlCore.searchUrl(lang, query), { credentials: "omit" });
        if (response.ok) byLanguage[lang] = await response.json();
      } catch (error) { /* one language failing (offline, blocked) should not stop the other */ }
    }));
    return byLanguage;
  }

  function describeEvent(e) {
    const title = (app.candidates[e.concept] && app.candidates[e.concept].title) || "?";
    const a = `Agent ${NstlCore.formatCount(e.from)}`, b = `Agent ${NstlCore.formatCount(e.to)}`;
    if (e.ok && e.took) return `${a} überzeugt ${b}: „${e.wordText}“ heißt „${title}“ – ${b} übernimmt diese Meinung.`;
    if (e.ok) return `${a} und ${b} verstehen sich bei „${e.wordText}“ für „${title}“.`;
    return `${a} sagt „${e.wordText}“ für „${title}“, ${b} kennt dafür noch „${e.heardText}“ – noch nicht verstanden.`;
  }

  function addChatLines(events) {
    for (const e of events) {
      const line = document.createElement("li");
      line.textContent = describeEvent(e);
      chatList.append(line);
    }
    while (chatList.children.length > MAX_CHAT_LINES) chatList.firstElementChild.remove();
    if (!REDUCE_MOTION) chatList.parentElement.scrollTop = chatList.parentElement.scrollHeight;
  }

  function updateStats(m) {
    const top = app.candidates[m.top];
    STATS.round.textContent = NstlCore.formatCount(m.round);
    STATS.agents.textContent = NstlCore.formatCount(m.agents);
    STATS.understanding.textContent = NstlCore.formatPercent(m.understanding);
    STATS.consensus.textContent = NstlCore.formatPercent(m.shares[m.top]);
    STATS.word.textContent = top ? `„${m.lexicon[m.top].text}“ für „${top.title}“` : "–";
    STATS.dialects.textContent = String(m.dialects);
    const fraction = Math.max(0, Math.min(1, Math.min(m.shares[m.top], m.understanding) / 0.9));
    PROGRESS_BAR.style.width = `${Math.round(fraction * 100)}%`;
  }

  function requestPaint() {
    // The worker keeps the swarm until the next run starts, so the map can still be repainted (in the other colour mode, say) after
    // the swarm has already settled -- only a worker that was never started, or one just replaced by a new run, has nothing to paint.
    if (app.worker) app.worker.postMessage({ type: "paint", columns: MAP_COLUMNS, rows: app.rows, mode: app.mode });
  }

  function paint(columns, rows, pixels) {
    map.width = columns;
    map.height = rows;
    mapCtx.putImageData(new ImageData(pixels, columns, rows), 0, 0);
  }

  function renderResult(done) {
    const top = app.candidates[done.measure.top];
    resultSection.hidden = false;
    $("answer-status").textContent = done.agreed
      ? "Der Schwarm hat sich geeinigt:"
      : `Nach ${NstlCore.formatCount(done.measure.round)} Runden gab es noch keine volle Einigkeit (${NstlCore.formatPercent(done.measure.shares[done.measure.top])} statt 90 %). Das führende Ergebnis:`;
    $("answer-text").textContent = top ? top.extract : "Der Schwarm fand keinen klaren Favoriten.";
    const source = $("answer-source");
    source.replaceChildren();
    if (top) {
      const link = document.createElement("a");
      link.href = top.url; link.target = "_blank"; link.rel = "noopener noreferrer";
      link.textContent = top.title;
      source.append(`Wikipedia (${top.lang === "de" ? "Deutsch" : "Englisch"}): `, link);
    }
    $("answer-meta").textContent =
      `${NstlCore.formatCount(done.measure.agents)} Agenten, ${NstlCore.formatCount(done.measure.round)} Runden, ${(done.ms / 1000).toFixed(1)} s, `
      + `Verständigung ${NstlCore.formatPercent(done.measure.understanding)}, eigenes Wort „${done.measure.lexicon[done.measure.top].text}“, `
      + `${done.measure.dialects} ${done.measure.dialects === 1 ? "Dialekt" : "Dialekte"} dafür übrig.`;
  }

  async function start(event) {
    event.preventDefault();
    const query = input.value.trim();
    if (!query || app.running) return;
    resultSection.hidden = true;
    chatList.replaceChildren();
    setMessage("");
    setBusy(true);
    setMessage("Frage Wikipedia (Deutsch und Englisch) …");
    let byLanguage;
    try {
      byLanguage = await fetchWikipedia(query);
    } catch (error) {
      setMessage("Die Wikipedia war gerade nicht erreichbar. Versuch es noch einmal.", "bad");
      setBusy(false);
      return;
    }
    app.candidates = NstlCore.candidatesFor(query, byLanguage);
    if (app.candidates.length < 2) {
      setMessage("Dazu fand die Wikipedia zu wenig, worüber sich ein Schwarm streiten könnte. Versuch eine andere Formulierung.", "bad");
      setBusy(false);
      return;
    }
    const target = agentTarget();
    if (target < 10000000) setMessage("Dein Gerät hat wenig Arbeitsspeicher: der Schwarm läuft deshalb mit 2 statt 10 Millionen Agenten.");
    else setMessage("");
    const { width, height } = NstlCore.gridFor(target);
    app.rows = Math.max(1, Math.round((MAP_COLUMNS * height) / width));
    runSection.hidden = false;
    if (app.worker) app.worker.terminate();
    const worker = new Worker(root.dataset.worker);
    app.worker = worker;
    worker.onmessage = (e) => {
      const data = e.data;
      if (data.type === "progress") { updateStats(data.measure); addChatLines(data.events); requestPaint(); }
      else if (data.type === "paint") { paint(data.columns, data.rows, data.pixels); }
      else if (data.type === "done") { setBusy(false); renderResult(data); }
      else if (data.type === "error") { setMessage(`Der Schwarm ist abgebrochen: ${data.message}`, "bad"); setBusy(false); }
    };
    worker.postMessage({
      type: "start", width, height, features: app.candidates.map((c) => c.features),
      types: 256, radius: 48, longDistance: 64, seed: Date.now() % 2147483647,
      maxRounds: 260, maxMs: 200000, keep: 3,
    });
  }

  function stop() {
    if (app.worker) app.worker.postMessage({ type: "stop" });
  }

  function setMode(mode) {
    app.mode = mode;
    for (const [key, button] of Object.entries(modeButtons)) button.setAttribute("aria-pressed", String(key === mode));
    requestPaint();
  }

  form.addEventListener("submit", start);
  stopButton.addEventListener("click", stop);
  modeButtons.opinion.addEventListener("click", () => setMode("opinion"));
  modeButtons.word.addEventListener("click", () => setMode("word"));
})();
