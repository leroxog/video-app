/* Nex Ai core: the small functions that do not touch the page -- the kinds of models and what they are for, how sizes and numbers are
   said, what a licence allows, searching, filtering and sorting the list, the address of a file, the commands to fetch it, and which
   program runs it.  They run in the browser and in Node (that is how they are tested, tests/regal_core.test.js). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.RegalCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* What there is.  `key` is what the list calls it; `label` and `hint` are what people read. */
  const CATEGORIES = [
    { key: "chat", label: "Chat & Schreiben", hint: "Mit der KI schreiben, fragen, Texte machen", icon: "chat" },
    { key: "code", label: "Programmieren", hint: "Code schreiben und erklären lassen", icon: "code" },
    { key: "image", label: "Bilder erzeugen", hint: "Aus einem Text ein Bild malen lassen", icon: "image" },
    { key: "video", label: "Videos erzeugen", hint: "Aus Text oder einem Bild ein Video machen", icon: "video" },
    { key: "music", label: "Musik & Klänge", hint: "Musik, Geräusche und Töne erzeugen", icon: "music" },
    { key: "speech", label: "Sprache vorlesen", hint: "Aus Text gesprochene Sprache machen", icon: "voice" },
    { key: "listen", label: "Sprache zu Text", hint: "Gesprochenes aufschreiben lassen", icon: "ear" },
    { key: "vision", label: "Bilder verstehen", hint: "Der KI ein Bild zeigen und Fragen stellen", icon: "eye" },
    { key: "image-edit", label: "Bilder bearbeiten", hint: "Vergrößern, verbessern, verändern", icon: "wand" },
    { key: "audio-edit", label: "Stimmen & Audio verändern", hint: "Stimmen umwandeln, Audio bearbeiten", icon: "wave" },
    { key: "detect", label: "Bilder analysieren", hint: "Erkennen, ausschneiden, Tiefe schätzen", icon: "scan" },
    { key: "translate", label: "Übersetzen", hint: "Texte in andere Sprachen übersetzen", icon: "globe" },
    { key: "embed", label: "Texte durchsuchen", hint: "Für eigene Suche und Programme", icon: "search" },
    { key: "3d", label: "3D-Modelle", hint: "Aus Bildern oder Text 3D-Objekte machen", icon: "cube" },
  ];
  const BY_KEY = Object.fromEntries(CATEGORIES.map((c) => [c.key, c]));
  const SORTS = [["popular", "Beliebteste"], ["likes", "Meiste Herzen"], ["new", "Neueste"], ["small", "Kleinste"], ["big", "Größte"], ["name", "Name A–Z"]];
  const MEMORY = [[0, "egal"], [4, "4 GB"], [8, "8 GB"], [12, "12 GB"], [16, "16 GB"], [24, "24 GB"], [48, "48 GB"]];
  const PAGE = 36;

  // ------------------------------------------------------------------------------------------------ numbers
  const de = (x, digits) => x.toLocaleString("de-DE", { minimumFractionDigits: digits, maximumFractionDigits: digits });

  /* "4,6 GB", "820 MB", "1,2 TB" (decimal units, like the file managers of the download sites). */
  function formatBytes(n) {
    if (!(n > 0)) return "–";
    if (n >= 1e12) return `${de(n / 1e12, n >= 1e13 ? 0 : 1)} TB`;
    if (n >= 1e9) return `${de(n / 1e9, n >= 1e10 ? 0 : 1)} GB`;
    if (n >= 1e6) return `${de(n / 1e6, n >= 1e8 ? 0 : 1)} MB`;
    if (n >= 1e3) return `${de(n / 1e3, 0)} kB`;
    return `${n} B`;
  }
  /* "812", "34 Tsd.", "1,2 Mio.", "3,4 Mrd." */
  function formatCount(n) {
    n = Number(n) || 0;
    if (n >= 1e9) return `${de(n / 1e9, 1)} Mrd.`;
    if (n >= 1e6) return `${de(n / 1e6, n >= 1e7 ? 0 : 1)} Mio.`;
    if (n >= 1e4) return `${de(n / 1e3, 0)} Tsd.`;
    if (n >= 1e3) return `${de(n / 1e3, 1)} Tsd.`;
    return String(n);
  }
  /* "7,6 Mrd. Parameter": how big the "brain" of a model is. */
  function formatParams(p) {
    if (!(p > 0)) return "";
    if (p >= 1e9) return `${de(p / 1e9, p >= 1e10 ? 0 : 1)} Mrd.`;
    if (p >= 1e6) return `${de(p / 1e6, p >= 1e8 ? 0 : 1)} Mio.`;
    return `${de(p / 1e3, 0)} Tsd.`;
  }
  /* "Okt. 2026" from "2026-10-09". */
  const MONTHS = ["Jan.", "Feb.", "März", "Apr.", "Mai", "Juni", "Juli", "Aug.", "Sept.", "Okt.", "Nov.", "Dez."];
  function formatMonth(date) {
    const m = /^(\d{4})-(\d{2})/.exec(date || "");
    return m ? `${MONTHS[Number(m[2]) - 1] || ""} ${m[1]}` : "";
  }

  // ------------------------------------------------------------------------------------------------ licences
  const FREE = { "apache-2.0": "Apache 2.0", mit: "MIT", "bsd-2-clause": "BSD 2", "bsd-3-clause": "BSD 3", "cc0-1.0": "CC0", unlicense: "Unlicense", "cc-by-4.0": "CC BY 4.0", "cc-by-3.0": "CC BY 3.0", "cc-by-sa-4.0": "CC BY-SA 4.0", isc: "ISC", "afl-3.0": "AFL 3.0", zlib: "zlib", wtfpl: "WTFPL", "ofl-1.1": "OFL 1.1", "bsl-1.0": "BSL 1.0", "artistic-2.0": "Artistic 2.0", "pddl": "PDDL", "odc-by": "ODC-By" };
  const CONDITIONS = { "creativeml-openrail-m": "CreativeML OpenRAIL-M", "openrail++": "OpenRAIL++", openrail: "OpenRAIL", "bigscience-openrail-m": "BigScience OpenRAIL-M", "bigscience-bloom-rail-1.0": "BLOOM RAIL", "gpl-3.0": "GPL 3.0", "gpl-2.0": "GPL 2.0", "lgpl-3.0": "LGPL 3.0", "agpl-3.0": "AGPL 3.0", "mpl-2.0": "MPL 2.0", gemma: "Gemma", llama2: "Llama 2", llama3: "Llama 3", "llama3.1": "Llama 3.1", "llama3.2": "Llama 3.2", "llama3.3": "Llama 3.3", llama4: "Llama 4", deepseek: "DeepSeek", "tongyi-qianwen": "Qwen", "tongyi-qianwen-license-agreement": "Qwen", "qwen": "Qwen", "stabilityai-ai-community": "Stability Community", "cc-by-sa-3.0": "CC BY-SA 3.0", "falcon-llm": "Falcon LLM", "bigcode-openrail-m": "BigCode OpenRAIL-M", "ms-pl": "MS-PL" };
  /* What the licence of a model says in short: {label, commercial: "yes" | "conditions" | "no" | "unknown"}.  Only a hint: the licence text rules. */
  function licenseInfo(lic) {
    const l = String(lic || "").toLowerCase();
    if (!l) return { label: "Lizenz offen", commercial: "unknown" };
    if (FREE[l]) return { label: FREE[l], commercial: "yes" };
    if (CONDITIONS[l]) return { label: CONDITIONS[l], commercial: "conditions" };
    if (/(^|-)nc(-|$)|noncommercial|non-commercial|research|academic/.test(l)) return { label: l.replace(/^cc-by-nc/, "CC BY-NC").replace(/-/g, " ").toUpperCase().replace("CC BY NC", "CC BY-NC"), commercial: "no" };
    if (l === "other") return { label: "Eigene Lizenz", commercial: "unknown" };
    return { label: l.toUpperCase(), commercial: "unknown" };
  }
  const COMMERCIAL_TEXT = { yes: "auch kommerziell erlaubt", conditions: "kommerziell mit Bedingungen", no: "nur nicht-kommerziell", unknown: "Lizenz prüfen" };

  // --------------------------------------------------------------------------------------------- names, files
  function modelParts(id) {
    const i = id.indexOf("/");
    return { author: i < 0 ? "" : id.slice(0, i), name: i < 0 ? id : id.slice(i + 1) };
  }
  const encodePath = (path) => path.split("/").map(encodeURIComponent).join("/");
  const repoUrl = (id) => `https://huggingface.co/${id}`;
  /* The address of a file of a model: opens as a download (download=true) or for the program that streams it. */
  const fileUrl = (id, path, download = true) => `https://huggingface.co/${id}/resolve/main/${encodePath(path)}${download ? "?download=true" : ""}`;

  /* A model that comes in pieces (…-00001-of-00004.safetensors): the paths of all pieces, from the path of the first. */
  function shardPaths(first, parts) {
    const m = /(\d+)-of-(\d+)/.exec(first);
    if (!m || !(parts > 1)) return [first];
    const width = m[1].length, total = m[2];
    return Array.from({ length: parts }, (_, i) => first.replace(m[0], `${String(i + 1).padStart(width, "0")}-of-${total}`));
  }
  /* The quality of a quantised file: "Q4_K_M". */
  function quantOf(path) {
    const m = /(?<![A-Za-z0-9])(I?Q\d(?:_[A-Z0-9]+)*|BF16|F16|F32|MXFP4)(?![A-Za-z0-9])/i.exec(path.split("/").pop());
    return m ? m[1].toUpperCase() : "";
  }
  /* The files that really are to be downloaded for a model: [{path, size, parts, paths: [every piece]}].  By default the one to start
     with (the file of the usual quality for quantised models, the whole model for the others). */
  function filesOf(model) {
    return model.f.map(([path, size, parts]) => ({ path, size, parts: parts || 1, paths: shardPaths(path, parts || 1), quant: quantOf(path) }));
  }
  function recommended(model) {
    const files = filesOf(model);
    if (model.fmt.includes("gguf")) {
      const wanted = ["Q4_K_M", "Q4_K_S", "Q5_K_M", "Q4_0", "Q5_K_S", "Q8_0", "IQ4_XS", "Q3_K_M", "Q6_K"];
      for (const q of wanted) { const f = files.find((x) => x.quant === q && !/mmproj|imatrix/i.test(x.path)); if (f) return [f]; }
      const smallest = files.filter((x) => !/mmproj|imatrix/i.test(x.path)).sort((a, b) => a.size - b.size)[0];
      return smallest ? [smallest] : files.slice(0, 1);
    }
    const plain = files.filter((f) => /\.safetensors$/i.test(f.path));
    const base = plain.filter((f) => !/\.(fp16|bf16|fp32|fp8|int8|ema|non_ema|no_ema)\./i.test(f.path) && !/[-_.](fp16|bf16|fp8|ema)\b/i.test(f.path));
    const chosen = (base.length ? base : plain.length ? plain : files);
    return chosen;
  }

  // ------------------------------------------------------------------------------------------------ commands
  /* What to type to get a model with a program: Ollama (quantised chat models) and the Hugging Face tool (any model). */
  function commands(model) {
    const out = {};
    const gguf = model.fmt.includes("gguf");
    if (gguf && ["chat", "code", "vision"].includes(model.k)) {
      const main = recommended(model)[0];
      out.ollama = `ollama run hf.co/${model.id}${main && main.quant ? `:${main.quant}` : ""}`;
    }
    const picked = recommended(model);
    out.hf = `huggingface-cli download ${model.id}${gguf && picked.length === 1 && picked[0].parts === 1 ? ` ${picked[0].path}` : ""}`;
    return out;
  }

  // -------------------------------------------------------------------------------------------- the programs
  const TOOLS = {
    lmstudio: { name: "LM Studio", url: "https://lmstudio.ai", text: "Programm zum Chatten mit Modellen auf dem eigenen PC (Windows, Mac, Linux)." },
    ollama: { name: "Ollama", url: "https://ollama.com", text: "Startet Chat-Modelle mit einem Befehl und lädt sie selbst herunter." },
    llamacpp: { name: "llama.cpp", url: "https://github.com/ggml-org/llama.cpp", text: "Das Grundprogramm, das GGUF-Dateien ausführt (für alle, die es gern selbst machen)." },
    comfy: { name: "ComfyUI", url: "https://github.com/comfyanonymous/ComfyUI", text: "Programm für Bilder, Videos und mehr: Die Datei kommt in den passenden Ordner unter ComfyUI/models." },
    fooocus: { name: "Fooocus", url: "https://github.com/lllyasviel/Fooocus", text: "Einfaches Programm, um Bilder zu malen (Stable-Diffusion-Modelle in models/checkpoints)." },
    buzz: { name: "Buzz", url: "https://github.com/chidiwilliams/buzz", text: "Programm, das Gesprochenes mit Whisper-Modellen aufschreibt." },
    whispercpp: { name: "whisper.cpp", url: "https://github.com/ggml-org/whisper.cpp", text: "Schnelles Programm für Spracherkennung auf dem eigenen PC." },
    transformers: { name: "Hugging Face Transformers", url: "https://huggingface.co/docs/transformers", text: "Python-Bibliothek, mit der fast jedes Modell läuft (Anleitung auf der Modellseite)." },
    diffusers: { name: "Hugging Face Diffusers", url: "https://huggingface.co/docs/diffusers", text: "Python-Bibliothek für Bild-, Video- und Audio-Modelle." },
  };
  /* Which programs fit a model. */
  function toolsFor(model) {
    const gguf = model.fmt.includes("gguf");
    switch (model.k) {
      case "chat": case "code": case "vision": return gguf ? [TOOLS.lmstudio, TOOLS.ollama, TOOLS.llamacpp] : [TOOLS.transformers, TOOLS.lmstudio];
      case "image": case "image-edit": return [TOOLS.comfy, TOOLS.fooocus, TOOLS.diffusers];
      case "video": case "3d": return [TOOLS.comfy, TOOLS.diffusers];
      case "listen": return [TOOLS.buzz, TOOLS.whispercpp, TOOLS.transformers];
      case "music": case "speech": case "audio-edit": return [TOOLS.transformers, TOOLS.comfy];
      default: return [TOOLS.transformers];
    }
  }
  /* Where a file belongs in the usual programs (a hint, the programs differ). */
  function folderHint(model) {
    if (model.k === "chat" || model.k === "code" || model.k === "vision") return model.fmt.includes("gguf") ? "LM Studio: Ordner models (LM Studio zeigt ihn unter „Meine Modelle“), darin autor/modell/datei.gguf. Ollama lädt selbst: nimm den Befehl." : "Für Python-Programme: ein eigener Ordner, den du im Programm angibst.";
    if (model.k === "image" || model.k === "image-edit") return "ComfyUI: ComfyUI/models/checkpoints (ganze Modelle) oder diffusion_models, vae, loras, je nach Datei.";
    if (model.k === "video" || model.k === "3d") return "ComfyUI: ComfyUI/models/diffusion_models (oder checkpoints), dazu oft ein Text-Encoder und ein VAE.";
    return "Ein eigener Ordner, den du in deinem Programm angibst.";
  }

  // ------------------------------------------------------------------------------------- searching, sorting
  const norm = (s) => String(s).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss");
  function haystack(model) {
    if (!model._h) {
      const c = BY_KEY[model.k];
      model._h = norm([model.id, c ? c.label : "", c ? c.hint : "", model.task, model.lic, model.fmt.join(" "), model.lib, model.p ? `${Math.round(model.p / 1e8) / 10}b` : ""].join(" "));
    }
    return model._h;
  }
  /* The models that fit a search (words, all of which must be in it), a kind, a memory (GB; 0 for any), a licence wish, a format. */
  function filterModels(models, f = {}) {
    const words = norm(f.q || "").split(/\s+/).filter(Boolean);
    const limit = f.gb > 0 ? f.gb * 1e9 * 0.85 : 0;
    return models.filter((m) => {
      if (f.k && m.k !== f.k) return false;
      if (f.fmt && !m.fmt.includes(f.fmt)) return false;
      if (limit && m.s > limit) return false;
      if (f.commercial && !["yes", "conditions"].includes(licenseInfo(m.lic).commercial)) return false;
      if (f.fav && !f.fav.has(m.id)) return false;
      if (words.length) { const h = haystack(m); for (const w of words) if (!h.includes(w)) return false; }
      return true;
    });
  }
  function sortModels(models, how) {
    const list = models.slice();
    const by = {
      popular: (a, b) => b.d - a.d, likes: (a, b) => b.l - a.l, new: (a, b) => (b.c || "").localeCompare(a.c || "") || b.d - a.d,
      small: (a, b) => a.s - b.s, big: (a, b) => b.s - a.s, name: (a, b) => modelParts(a.id).name.localeCompare(modelParts(b.id).name, "de"),
    };
    return list.sort(by[how] || by.popular);
  }
  function countByKind(models) {
    const counts = {};
    for (const m of models) counts[m.k] = (counts[m.k] || 0) + 1;
    return counts;
  }

  // ------------------------------------------------------------------------------------------ the address
  /* The state of the page as the part after ? of the address (and back), so that a search can be shared. */
  const DEFAULTS = { q: "", k: "", sort: "popular", gb: 0, fmt: "", commercial: false, fav: false };
  function stateFromQuery(search) {
    const p = new URLSearchParams(search);
    const s = { ...DEFAULTS };
    s.q = (p.get("q") || "").slice(0, 80);
    s.k = BY_KEY[p.get("k")] ? p.get("k") : "";
    s.sort = SORTS.some(([k]) => k === p.get("sort")) ? p.get("sort") : "popular";
    s.gb = MEMORY.some(([g]) => String(g) === p.get("gb")) ? Number(p.get("gb")) : 0;
    s.fmt = ["gguf", "safetensors", "onnx"].includes(p.get("fmt")) ? p.get("fmt") : "";
    s.commercial = p.get("com") === "1";
    s.fav = p.get("fav") === "1";
    s.m = /^[\w.-]+\/[\w.-]+$/.test(p.get("m") || "") ? p.get("m") : "";
    return s;
  }
  function queryFromState(s) {
    const p = new URLSearchParams();
    if (s.q) p.set("q", s.q);
    if (s.k) p.set("k", s.k);
    if (s.sort && s.sort !== "popular") p.set("sort", s.sort);
    if (s.gb) p.set("gb", String(s.gb));
    if (s.fmt) p.set("fmt", s.fmt);
    if (s.commercial) p.set("com", "1");
    if (s.fav) p.set("fav", "1");
    if (s.m) p.set("m", s.m);
    const text = p.toString();
    return text ? `?${text}` : "";
  }

  return { CATEGORIES, BY_KEY, SORTS, MEMORY, PAGE, DEFAULTS, TOOLS, COMMERCIAL_TEXT, formatBytes, formatCount, formatParams, formatMonth, licenseInfo, modelParts, repoUrl, fileUrl, shardPaths, quantOf, filesOf, recommended, commands, toolsFor, folderHint, filterModels, sortModels, countByKind, stateFromQuery, queryFromState };
});
