/* Nex Ai: the page -- loads the list of models (static/data/models.json), shows what kinds there are, lets people search and filter, and
   opens a model with its files, so that they can be downloaded to the computer (into a folder, or the normal way), with the commands and
   the programs to use it.  Nothing is sent to anybody except the files that a person chooses to download, which come from Hugging Face. */
(function () {
  "use strict";

  const Core = window.RegalCore;
  const T = (window.Regal = window.Regal || {});
  const { h, put, fill, icon, logo, toast, dialog, copyText, count } = T;
  const Downloader = T.Downloader;

  const FAV_KEY = "regal.fav";
  const store = {
    get(key) { try { return window.localStorage.getItem(key); } catch (error) { return null; } },
    set(key, value) { try { window.localStorage.setItem(key, value); } catch (error) { /* not kept */ } },
  };

  const app = { models: [], byId: new Map(), state: { ...Core.DEFAULTS, m: "" }, favs: new Set(), shown: 0, list: [], generated: "" };
  try { app.favs = new Set(JSON.parse(store.get(FAV_KEY)) || []); } catch (error) { app.favs = new Set(); }

  // ---------------------------------------------------------------------------------------------- helpers
  const kind = (m) => Core.BY_KEY[m.k] || { label: m.k, icon: "cube", hint: "" };
  const formatBadge = (f) => ({ gguf: "GGUF", safetensors: "Safetensors", onnx: "ONNX", tflite: "TFLite" }[f] || f);
  function syncAddress() { history.replaceState(null, "", `${location.pathname}${Core.queryFromState(app.state)}`); }
  function saveFavs() { store.set(FAV_KEY, JSON.stringify([...app.favs])); }

  // -------------------------------------------------------------------------------------------- the cards
  function card(m) {
    const info = Core.licenseInfo(m.lic);
    const { author, name } = Core.modelParts(m.id);
    const fav = h("button", { class: `icon-btn fav${app.favs.has(m.id) ? " on" : ""}`, type: "button", "aria-pressed": String(app.favs.has(m.id)), "aria-label": `${name} merken`, title: "Merken", onclick: (e) => { e.stopPropagation(); toggleFav(m, fav); } }, icon("heart"));
    const el = h("article", { class: "card", "data-id": m.id, tabindex: "0", "aria-label": `${name}, ${kind(m).label}` },
      h("div", { class: "card-top" }, h("span", { class: "kind" }, icon(kind(m).icon), h("span", {}, kind(m).label)), fav),
      h("h3", { class: "card-name" }, name),
      h("p", { class: "card-author" }, author),
      h("div", { class: "badges" },
        m.fmt.slice(0, 2).map((f) => h("span", { class: `badge fmt-${f}` }, formatBadge(f))),
        m.p ? h("span", { class: "badge" }, `${Core.formatParams(m.p)} Param.`) : null,
        h("span", { class: `badge lic-${info.commercial}`, title: Core.COMMERCIAL_TEXT[info.commercial] }, info.label)),
      h("div", { class: "card-stats" },
        h("strong", { class: "size" }, Core.formatBytes(m.s)),
        h("span", { title: "Downloads bei Hugging Face" }, icon("download"), Core.formatCount(m.d)),
        h("span", { title: "Herzen bei Hugging Face" }, icon("heart"), Core.formatCount(m.l))),
      h("div", { class: "card-actions" },
        h("button", { class: "btn primary small", type: "button", onclick: (e) => { e.stopPropagation(); openModel(m); } }, icon("download"), "Herunterladen"),
        h("a", { class: "icon-btn", href: Core.repoUrl(m.id), target: "_blank", rel: "noopener noreferrer", "aria-label": `${name} bei Hugging Face ansehen`, title: "Bei Hugging Face ansehen", onclick: (e) => e.stopPropagation() }, icon("external"))));
    el.addEventListener("click", () => openModel(m));
    el.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target === el) openModel(m); });
    return el;
  }

  function toggleFav(m, button) {
    if (app.favs.has(m.id)) app.favs.delete(m.id); else app.favs.add(m.id);
    saveFavs();
    const on = app.favs.has(m.id);
    button.classList.toggle("on", on);
    button.setAttribute("aria-pressed", String(on));
    app.favButton && app.paintFavCount();
    if (app.state.fav) applyFilters();
  }

  // ---------------------------------------------------------------------------------------------- the model
  function copyRow(label, text) {
    return h("div", { class: "cmd" }, h("span", { class: "cmd-label" }, label), h("code", {}, text),
      h("button", { class: "icon-btn small", type: "button", "aria-label": `${label} kopieren`, onclick: async () => toast((await copyText(text)) ? "Befehl kopiert." : "Das Kopieren hat nicht geklappt.") }, icon("copy")));
  }

  function openModel(m) {
    const info = Core.licenseInfo(m.lic);
    const { author, name } = Core.modelParts(m.id);
    const files = Core.filesOf(m);
    const chosen = new Set(Core.recommended(m).map((f) => f.path));
    const sortedFiles = m.fmt.includes("gguf") ? files.slice().sort((a, b) => a.size - b.size) : files;
    const summary = h("p", { class: "dl-summary" });
    const progress = h("div", { class: "dl-progress", hidden: true });
    const flat = h("input", { type: "checkbox" });
    flat.checked = !m.fmt.includes("gguf");
    const selected = () => sortedFiles.filter((f) => chosen.has(f.path));
    const paintSummary = () => {
      const list = selected();
      const total = list.reduce((s, f) => s + f.size, 0);
      summary.textContent = list.length ? `${list.length} ${list.length === 1 ? "Datei" : "Dateien"} ausgewählt: ${Core.formatBytes(total)}` : "Wähle mindestens eine Datei aus.";
      saveButton && (saveButton.disabled = !list.length);
      browserButton && (browserButton.disabled = !list.length);
    };
    const rows = sortedFiles.map((f) => {
      const box = h("input", { type: "checkbox", "aria-label": f.path });
      box.checked = chosen.has(f.path);
      box.addEventListener("change", () => { if (box.checked) chosen.add(f.path); else chosen.delete(f.path); paintSummary(); });
      return h("label", { class: "file-row" }, box, h("span", { class: "file-name" }, f.path, f.quant ? h("em", {}, f.quant) : null, f.parts > 1 ? h("em", {}, `${f.parts} Teile`) : null), h("span", { class: "file-size" }, Core.formatBytes(f.size)));
    });
    let saveButton = null, browserButton = null, controller = null;
    const run = async () => {
      const list = selected();
      const items = Downloader.expand(m, list);
      let root;
      try { root = await Downloader.pickFolder(); } catch (error) { toast(error.message); return; }
      if (!root) return;
      controller = new AbortController();
      progress.hidden = false;
      const bar = h("div", { class: "bar" }, h("i", {}));
      const text = h("p", {});
      const stop = h("button", { class: "btn ghost small", type: "button", onclick: () => controller.abort() }, icon("stop"), "Abbrechen");
      fill(progress, bar, text, stop);
      saveButton.disabled = true;
      try {
        const written = await Downloader.save(root, m, items, { flat: flat.checked && new Set(items.map((i) => i.path.split("/").pop())).size === items.length, signal: controller.signal, onProgress: (p) => {
          bar.firstChild.style.width = `${Math.round(100 * p.overallLoaded / Math.max(1, p.overallTotal))}%`;
          text.textContent = `Datei ${p.index + 1} von ${p.count}: ${p.path.split("/").pop()} · ${Core.formatBytes(p.overallLoaded)} von ${Core.formatBytes(p.overallTotal)}${p.speed ? ` · ${Core.formatBytes(p.speed)}/s` : ""}`;
        } });
        fill(progress, h("p", { class: "dl-done" }, icon("check"), written ? `Fertig: ${written} ${written === 1 ? "Datei liegt" : "Dateien liegen"} jetzt in deinem Ordner.` : "Alle Dateien waren schon in deinem Ordner."));
      } catch (error) {
        fill(progress, h("p", { class: "dl-error" }, icon("warn"), error && error.name === "AbortError" ? "Abgebrochen." : (error.message || "Das hat nicht geklappt.")));
      } finally { saveButton.disabled = false; controller = null; }
    };
    saveButton = Downloader.supported() ? h("button", { class: "btn primary", type: "button", onclick: run }, icon("folder"), "In einen Ordner speichern") : null;
    browserButton = h("button", { class: `btn ${saveButton ? "ghost" : "primary"}`, type: "button", onclick: async () => {
      const items = Downloader.expand(m, selected());
      toast(items.length > 1 ? `${items.length} Downloads starten nacheinander. Dein Browser fragt eventuell nach, ob er mehrere erlauben soll.` : "Der Download startet.");
      await Downloader.viaBrowser(m, items);
    } }, icon("download"), "Normal herunterladen");
    const cmds = Core.commands(m);
    const tools = Core.toolsFor(m);
    const warn = info.commercial === "no" || info.commercial === "unknown";
    const body = h("div", { class: "model-body" },
      h("div", { class: "model-head" }, h("span", { class: "kind" }, icon(kind(m).icon), h("span", {}, kind(m).label)), h("span", { class: "muted" }, author)),
      h("dl", { class: "facts" },
        h("div", {}, h("dt", {}, "Größe"), h("dd", {}, Core.formatBytes(m.s), m.hi > m.lo * 1.3 ? h("small", {}, ` (je nach Qualität ${Core.formatBytes(m.lo)} bis ${Core.formatBytes(m.hi)})`) : null)),
        m.p ? h("div", {}, h("dt", {}, "Parameter"), h("dd", {}, Core.formatParams(m.p))) : null,
        h("div", {}, h("dt", {}, "Format"), h("dd", {}, m.fmt.map(formatBadge).join(", "))),
        h("div", {}, h("dt", {}, "Lizenz"), h("dd", {}, `${info.label}, ${Core.COMMERCIAL_TEXT[info.commercial]}`)),
        h("div", {}, h("dt", {}, "Beliebtheit"), h("dd", {}, `${Core.formatCount(m.d)} Downloads, ${Core.formatCount(m.l)} Herzen`)),
        m.u ? h("div", {}, h("dt", {}, "Zuletzt geändert"), h("dd", {}, Core.formatMonth(m.u))) : null),
      warn ? h("p", { class: "notice" }, icon("info"), h("span", {}, info.commercial === "no" ? "Diese Lizenz erlaubt nur nicht-kommerzielle Nutzung. Zum Ausprobieren und Lernen ist das in Ordnung, für Geld verdienen nicht." : "Die Lizenz ist nicht eindeutig angegeben. Lies die Modellseite, bevor du das Modell für mehr als Ausprobieren benutzt.")) : null,
      h("h3", { class: "section" }, icon("pc"), "Auf deinen PC laden"),
      h("div", { class: "file-list", role: "group", "aria-label": "Dateien" }, rows),
      summary,
      h("label", { class: "check-row" }, flat, h("span", {}, h("b", {}, "Ohne Unterordner speichern"), h("small", {}, "Die Datei liegt direkt im Ordner, den du wählst (zum Beispiel ComfyUI/models/checkpoints). Ohne den Haken entsteht autor/modell/…, wie es LM Studio mag."))),
      h("div", { class: "dl-buttons" }, saveButton, browserButton),
      Downloader.supported() ? null : h("p", { class: "muted small" }, "Direkt in einen Ordner speichern kann Chrome oder Edge am Computer. Hier lädt der Browser die Dateien normal herunter."),
      progress,
      h("p", { class: "muted small" }, icon("folder"), h("span", {}, Core.folderHint(m))),
      h("h3", { class: "section" }, icon("terminal"), "Oder per Befehl"),
      cmds.ollama ? copyRow("Ollama", cmds.ollama) : null,
      copyRow("Hugging Face", cmds.hf),
      h("h3", { class: "section" }, icon("wand"), "Womit startest du es?"),
      h("ul", { class: "tools" }, tools.map((t) => h("li", {}, h("a", { href: t.url, target: "_blank", rel: "noopener noreferrer" }, t.name, icon("external")), h("span", {}, t.text)))),
      h("p", { class: "dialog-links" }, h("a", { class: "btn ghost small", href: Core.repoUrl(m.id), target: "_blank", rel: "noopener noreferrer" }, icon("external"), "Beschreibung bei Hugging Face"),
        h("button", { class: "btn ghost small", type: "button", onclick: async () => toast((await copyText(`${location.origin}/?m=${m.id}`)) ? "Link zum Modell kopiert." : "Das Kopieren hat nicht geklappt.") }, icon("copy"), "Link kopieren")));
    paintSummary();
    const entry = dialog({ title: name, body, wide: true, onClose: () => { if (controller) controller.abort(); app.state.m = ""; syncAddress(); } });
    app.state.m = m.id;
    syncAddress();
    return entry;
  }

  // ------------------------------------------------------------------------------------------- the results
  function applyFilters() {
    const s = app.state;
    const fav = s.fav ? app.favs : null;
    app.list = Core.sortModels(Core.filterModels(app.models, { ...s, fav }), s.sort);
    app.shown = 0;
    fill(app.cards);
    more();
    const total = app.models.length;
    app.countLine.textContent = app.list.length === total ? `${count(total)} Modelle` : `${count(app.list.length)} von ${count(total)} Modelle`;
    app.empty.hidden = app.list.length > 0;
    app.reset.hidden = !(s.q || s.k || s.gb || s.fmt || s.commercial || s.fav);
    for (const t of app.tiles) t.classList.toggle("on", t.dataset.key === s.k);
    app.chipAll.classList.toggle("on", !s.k);
    syncAddress();
  }

  function more() {
    const next = app.list.slice(app.shown, app.shown + Core.PAGE);
    app.shown += next.length;
    put(app.cards, next.map(card));
    app.moreButton.hidden = app.shown >= app.list.length;
  }

  function setState(change, scroll) {
    Object.assign(app.state, change);
    app.syncControls();
    applyFilters();
    if (scroll) app.results.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // --------------------------------------------------------------------------------------------- the page
  function select(label, options, value, onChange) {
    const el = h("select", { class: "field", "aria-label": label }, options.map(([v, text]) => h("option", { value: String(v) }, text)));
    el.value = String(value);
    el.addEventListener("change", () => onChange(el.value));
    return h("label", { class: "control" }, h("span", {}, label), el);
  }

  function build(data) {
    const s = app.state;
    const counts = Core.countByKind(app.models);
    app.search = h("input", { class: "hero-search", type: "search", placeholder: "Modell suchen, zum Beispiel „llama“, „flux“ oder „whisper“", "aria-label": "Modelle suchen", autocomplete: "off", maxlength: "80", value: s.q });
    let timer = null;
    app.search.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => setState({ q: app.search.value.trim() }), 180); });
    app.tiles = Core.CATEGORIES.filter((c) => counts[c.key]).map((c) => h("button", { class: "tile", type: "button", "data-key": c.key, onclick: () => setState({ k: app.state.k === c.key ? "" : c.key }, true) },
      h("span", { class: "tile-icon" }, icon(c.icon)), h("span", { class: "tile-text" }, h("b", {}, c.label), h("small", {}, c.hint)), h("span", { class: "tile-count" }, count(counts[c.key]))));
    app.chipAll = h("button", { class: "chip", type: "button", onclick: () => setState({ k: "" }) }, "Alle");
    const sort = select("Sortieren", Core.SORTS, s.sort, (v) => setState({ sort: v }));
    const memory = select("Mein PC hat", Core.MEMORY.map(([g, t]) => [g, g ? `${t} Speicher` : "Speicher egal"]), s.gb, (v) => setState({ gb: Number(v) }));
    const format = select("Format", [["", "alle"], ["gguf", "GGUF (Chat-Programme)"], ["safetensors", "Safetensors"], ["onnx", "ONNX"]], s.fmt, (v) => setState({ fmt: v }));
    const commercial = h("input", { type: "checkbox" });
    commercial.checked = s.commercial;
    commercial.addEventListener("change", () => setState({ commercial: commercial.checked }));
    app.favButton = h("button", { class: "chip", type: "button", "aria-pressed": "false", onclick: () => setState({ fav: !app.state.fav }, true) }, icon("heart"), h("span", {}, "Merkliste"), h("b", { class: "count" }));
    app.paintFavCount = () => { const n = app.favs.size; app.favButton.querySelector(".count").textContent = n ? String(n) : ""; };
    app.reset = h("button", { class: "btn ghost small", type: "button", hidden: true, onclick: () => { app.search.value = ""; setState({ ...Core.DEFAULTS, m: "" }); } }, icon("close"), "Zurücksetzen");
    app.countLine = h("p", { class: "count-line", role: "status" });
    app.cards = h("div", { class: "cards" });
    app.moreButton = h("button", { class: "btn ghost more", type: "button", hidden: true, onclick: more }, icon("down"), "Mehr anzeigen");
    app.empty = h("div", { class: "empty", hidden: true }, icon("search"), h("h2", {}, "Dazu gibt es nichts"), h("p", {}, "Versuche ein anderes Wort, einen anderen Speicher oder alle Arten."), h("button", { class: "btn primary", type: "button", onclick: () => app.reset.click() }, "Alles zurücksetzen"));
    app.syncControls = () => {
      app.search.value = app.state.q;
      sort.querySelector("select").value = app.state.sort;
      memory.querySelector("select").value = String(app.state.gb);
      format.querySelector("select").value = app.state.fmt;
      commercial.checked = app.state.commercial;
      app.favButton.setAttribute("aria-pressed", String(app.state.fav));
      app.favButton.classList.toggle("on", app.state.fav);
      app.paintFavCount();
    };
    app.results = h("section", { class: "results", id: "modelle", "aria-label": "Modelle" },
      h("div", { class: "toolbar" }, h("div", { class: "chips" }, app.chipAll, app.favButton), h("div", { class: "controls" }, memory, format, sort, h("label", { class: "control check" }, commercial, h("span", {}, "kommerziell nutzbar")))),
      h("div", { class: "result-head" }, app.countLine, app.reset), app.cards, app.empty, h("div", { class: "more-wrap" }, app.moreButton));

    const step = (n, title, text) => h("li", {}, h("span", { class: "step-no" }, String(n)), h("div", {}, h("b", {}, title), h("span", {}, text)));
    const faq = (q, a) => h("details", { class: "faq" }, h("summary", {}, q), h("p", {}, a));
    const root = document.getElementById("app");
    fill(root, h("div", { class: "page" },
      h("header", { class: "top" }, h("a", { class: "brand", href: "/", "aria-label": "Nex Ai, Startseite" }, logo(), h("span", {}, "Nex Ai")),
        h("nav", { "aria-label": "Bereiche" }, h("a", { href: "/" }, "KI-Chat"), h("a", { href: "#modelle" }, "Modelle"), h("a", { href: "#so-gehts" }, "So geht’s"), h("a", { href: "#fragen" }, "Fragen"))),
      h("main", { id: "main" },
        h("section", { class: "hero" },
          h("p", { class: "eyebrow" }, "Gratis. Auf deinem PC. Ohne Konto."),
          h("h1", {}, `Über ${count(Math.floor(app.models.length / 100) * 100)} KI-Modelle zum Herunterladen`),
          h("p", { class: "lead" }, "Zum Chatten und Programmieren, für Bilder, Videos, Musik, Sprache und mehr. Such dir eins aus, lade es auf deinen Computer und nutze es dort, ohne Internet und ohne Abo."),
          h("label", { class: "hero-field" }, icon("search"), app.search)),
        h("section", { class: "try", "aria-label": "Direkt ausprobieren" },
          h("div", { class: "try-icon" }, icon("chat")),
          h("div", { class: "try-text" }, h("h2", {}, "Gleich ausprobieren: KI-Chat im Browser"), h("p", {}, "Ohne App und ohne etwas herunterzuladen: Ein kleines Modell läuft direkt in deinem Browser, auf deinem Computer. Wie ChatGPT, nur privat und gratis.")),
          h("a", { class: "btn primary big", href: "/" }, "Chat öffnen")),
        h("section", { class: "tiles", "aria-label": "Was es gibt" }, h("h2", {}, "Was es gibt"), h("div", { class: "tile-grid" }, app.tiles)),
        app.results,
        h("section", { class: "steps", id: "so-gehts" }, h("h2", {}, "So geht’s"), h("ol", {},
          step(1, "Aussuchen", "Wähle oben eine Art oder suche nach einem Namen. Mit „Mein PC hat“ siehst du nur, was auf deinen PC passt."),
          step(2, "Herunterladen", "Tippe auf „Herunterladen“. In Chrome und Edge speicherst du die Dateien direkt in einen Ordner deiner Wahl, sonst lädt der Browser sie normal."),
          step(3, "Starten", "Öffne die Datei in einem Programm wie LM Studio (Chat) oder ComfyUI (Bilder, Videos). Es läuft auf deinem PC.")),
          h("p", { class: "muted small" }, "Zu jedem Modell zeigen wir dir die passenden Programme und, wenn es einen gibt, den Befehl für Ollama.")),
        h("section", { class: "faqs", id: "fragen" }, h("h2", {}, "Fragen"),
          faq("Kostet das etwas?", "Nein. Alle Modelle in der Liste kannst du kostenlos herunterladen, ohne Konto. Manche Lizenzen erlauben nur nicht-kommerzielle Nutzung: das steht an jedem Modell."),
          faq("Muss ich etwas installieren?", "Für den Chat nicht: Er läuft direkt in deinem Browser. Das Modell wird einmal geladen und bleibt dann dort gespeichert. Die Modelle in der Liste dagegen lädst du herunter und startest sie in einem Programm wie LM Studio."),
          faq("Wo liegen die Modelle?", "Bei Hugging Face, dem üblichen öffentlichen Ort für freie Modelle. Nex Ai ist die Liste dazu: Die Dateien kommen von dort direkt zu dir, nicht über unseren Server."),
          faq("Welches Modell passt zu meinem PC?", "Als Faustregel sollte die Datei kleiner sein als dein Arbeitsspeicher oder der Speicher deiner Grafikkarte. Wähle oben „Mein PC hat“, dann zeigen wir nur passende. Bei Chat-Modellen heißt eine kleinere Datei (zum Beispiel Q4 statt Q8) etwas schlechtere Antworten, aber weniger Speicher."),
          faq("Was heißt GGUF, Safetensors, ONNX?", "Das sind Dateiformate. GGUF sind fertig verkleinerte Chat-Modelle für LM Studio, Ollama und llama.cpp. Safetensors ist das übliche sichere Format für Bilder, Videos und vieles mehr. ONNX ist ein Austauschformat für Programme."),
          faq("Ist das sicher?", "Wir listen nur Modelle in sicheren Dateiformaten (keine Pickle-Dateien, die Programme ausführen können), ohne Login-Pflicht und ohne Inhalte für Erwachsene. Trotzdem: Lade Programme nur von den offiziellen Seiten, die wir verlinken."),
          faq("Warum nicht alle Modelle der Welt?", "Es gibt hunderttausende. Wir zeigen eine Auswahl der beliebtesten und brauchbarsten, damit du schnell findest, was du suchst. Die Liste wird immer wieder erneuert.")),
        h("footer", { class: "foot" },
          h("p", {}, `Liste vom ${data.generated ? new Date(data.generated).toLocaleDateString("de-DE", { day: "numeric", month: "long", year: "numeric" }) : "heute"}. Die Modelle gehören ihren Urhebern und liegen bei Hugging Face. Lies vor dem Benutzen die Lizenz.`),
          h("nav", { "aria-label": "Mehr" }, h("a", { href: "/nutzungsbedingungen" }, "Nutzungsbedingungen"), h("a", { href: "/datenschutz" }, "Datenschutz"), h("a", { href: "/impressum" }, "Impressum"))))));
    app.syncControls();
    applyFilters();
    if (s.m && app.byId.has(s.m)) openModel(app.byId.get(s.m));
  }

  async function boot() {
    const root = document.getElementById("app");
    app.state = { ...Core.stateFromQuery(location.search) };
    fill(root, h("div", { class: "page loading" }, h("div", { class: "spinner" }), h("p", {}, "Die Liste wird geladen …")));
    try {
      const response = await fetch(root.dataset.models, { credentials: "omit" });
      if (!response.ok) throw new Error(`Fehler ${response.status}`);
      const data = await response.json();
      app.models = data.models;
      app.generated = data.generated;
      for (const m of app.models) app.byId.set(m.id, m);
      build(data);
      if ("serviceWorker" in navigator) navigator.serviceWorker.register("/service-worker.js").catch(() => {});
    } catch (error) {
      console.error(error);
      fill(root, h("div", { class: "page loading" }, icon("warn"), h("h2", {}, "Die Liste konnte nicht geladen werden"), h("p", {}, "Prüfe deine Verbindung und versuche es noch einmal."), h("button", { class: "btn primary", type: "button", onclick: boot }, "Noch einmal")));
    }
    document.querySelector(".skip")?.addEventListener("click", (event) => { event.preventDefault(); const main = document.getElementById("main"); if (main) { main.setAttribute("tabindex", "-1"); main.focus(); } });
  }

  T.app = app;
  boot();
})();
