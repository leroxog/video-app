/* Nex Ai chat core: the functions of the chat page that do not touch the page -- which way a model can run on this computer, what
   is sent to the model, how the answer is cut into paragraphs and code, and what to say when something goes wrong.  They run in the
   browser and in Node (that is how they are tested, tests/regal_chat_core.test.js). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./regal-core.js"));
  else root.RegalChatCore = factory(root.RegalCore);
})(typeof self !== "undefined" ? self : this, function (Core) {
  "use strict";

  const SYSTEM_PROMPT = "Du bist Nex Ai, ein freundlicher, hilfreicher Assistent. Antworte kurz und klar. Antworte auf Deutsch, außer die Frage ist in einer anderen Sprache. "
    + "Wenn du etwas nicht sicher weißt, sag das ehrlich, statt etwas zu erfinden.";
  // What the model may read at most (letters, not tokens: a token is about three and a half letters).  The small models forget the
  // beginning of a long talk anyway, and a longer text makes every answer slower.
  const HISTORY_CHARS = 7000;
  const MAX_INPUT = 4000;
  const MAX_NEW_TOKENS = 700;

  const SUGGESTIONS = [
    "Erkläre mir in drei Sätzen, wie ein Kühlschrank funktioniert.",
    "Schreibe eine freundliche E-Mail, die einen Termin absagt.",
    "Gib mir drei Ideen für ein Geschenk unter 20 Euro.",
    "Was ist der Unterschied zwischen Wetter und Klima?",
  ];

  /* How a model runs on this computer.  `gpu`: {webgpu, f16} from the browser.  The small variant of a model (q4f16) needs a graphics
     card that can do 16-bit numbers; without it the plain 4-bit variant (q4) runs, on the graphics card if there is one, else on the
     processor, which is much slower.  A model that only has the small variant cannot run without that card. */
  function chooseRuntime(gpu, model) {
    const sizes = model.dtypes || {};
    const webgpu = !!(gpu && gpu.webgpu), f16 = !!(gpu && gpu.f16);
    if (webgpu && f16 && sizes.q4f16) return { ok: true, device: "webgpu", dtype: "q4f16", bytes: sizes.q4f16, speed: "fast", reason: "" };
    if (webgpu && sizes.q4) return { ok: true, device: "webgpu", dtype: "q4", bytes: sizes.q4, speed: "fast", reason: "" };
    if (!webgpu && model.cpu === false) return { ok: false, device: "", dtype: "", bytes: sizes.q4 || sizes.q4f16 || 0, speed: "none", reason: "Diese Version braucht eine Grafikkarte mit WebGPU." };
    if (sizes.q4) return { ok: true, device: "wasm", dtype: "q4", bytes: sizes.q4, speed: "slow", reason: "Dein Browser hat keine Grafikkarten-Beschleunigung (WebGPU). Das Modell läuft dann auf dem Prozessor und ist deutlich langsamer." };
    return { ok: false, device: "", dtype: "", bytes: sizes.q4f16 || 0, speed: "none", reason: "Dieses Modell braucht eine Grafikkarte mit WebGPU (zum Beispiel in aktuellem Chrome oder Edge am Computer). Hier ist keine verfügbar." };
  }

  /* The messages for the model: the instruction, then as much of the talk as fits, newest last.  The newest question is always
     kept (cut at the front if it alone is too long).  `history`: [{role: "user" | "assistant", content}]. */
  function buildMessages(history, limit = HISTORY_CHARS) {
    const talk = history.filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim());
    const kept = [];
    let used = SYSTEM_PROMPT.length;
    for (let i = talk.length - 1; i >= 0; i--) {
      let content = talk[i].content;
      if (kept.length && used + content.length > limit) break;
      if (!kept.length && used + content.length > limit) content = content.slice(-Math.max(200, limit - used));
      kept.unshift({ role: talk[i].role, content });
      used += content.length;
    }
    while (kept.length && kept[0].role !== "user") kept.shift();             // the model's template wants a question first
    return [{ role: "system", content: SYSTEM_PROMPT }, ...kept];
  }

  // ------------------------------------------------------------------------------------------ the answer as text blocks
  /* Inline: `code` and **bold**; everything else is text.  Returns [{t: "text" | "code" | "bold", s}]. */
  function parseInline(text) {
    const out = [];
    const re = /`([^`\n]+)`|\*\*([^*\n]+)\*\*/g;
    let last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) out.push({ t: "text", s: text.slice(last, m.index) });
      out.push(m[1] != null ? { t: "code", s: m[1] } : { t: "bold", s: m[2] });
      last = re.lastIndex;
    }
    if (last < text.length) out.push({ t: "text", s: text.slice(last) });
    return out;
  }

  /* The answer cut into blocks: {type: "p", text} | {type: "h", level, text} | {type: "ul", items} | {type: "ol", items, start} |
     {type: "code", lang, text}.  Works on an answer that is still being written (an open code block is shown as far as it goes). */
  function parseBlocks(text) {
    const blocks = [];
    const lines = String(text).replace(/\r\n?/g, "\n").split("\n");
    let paragraph = [], list = null, code = null;
    const endParagraph = () => { if (paragraph.length) blocks.push({ type: "p", text: paragraph.join("\n") }); paragraph = []; };
    const endList = () => { if (list) blocks.push(list); list = null; };
    for (const line of lines) {
      if (code) {
        if (/^\s*```\s*$/.test(line)) { blocks.push(code); code = null; } else code.lines.push(line);
        continue;
      }
      let m = /^\s*```\s*([\w+#.-]*)\s*$/.exec(line);
      if (m) { endParagraph(); endList(); code = { type: "code", lang: m[1] || "", lines: [] }; continue; }
      if ((m = /^(#{1,4})\s+(.+?)\s*#*$/.exec(line))) { endParagraph(); endList(); blocks.push({ type: "h", level: m[1].length, text: m[2] }); continue; }
      if ((m = /^\s*[-*•]\s+(.*)$/.exec(line))) {
        endParagraph();
        if (!list || list.type !== "ul") { endList(); list = { type: "ul", items: [] }; }
        list.items.push(m[1]);
        continue;
      }
      if ((m = /^\s*(\d{1,3})[.)]\s+(.*)$/.exec(line))) {
        endParagraph();
        if (!list || list.type !== "ol") { endList(); list = { type: "ol", items: [], start: Number(m[1]) }; }
        list.items.push(m[2]);
        continue;
      }
      if (!line.trim()) { endParagraph(); endList(); continue; }
      if (list && /^\s{2,}\S/.test(line)) { list.items[list.items.length - 1] += `\n${line.trim()}`; continue; }
      endList();
      paragraph.push(line);
    }
    if (code) blocks.push(code);
    endParagraph(); endList();
    return blocks.map((b) => (b.type === "code" ? { type: "code", lang: b.lang, text: b.lines.join("\n") } : b));
  }

  // ------------------------------------------------------------------------------------------------- loading
  /* The files being loaded: {name: {loaded, total}} -> how far all together are.  `expected` is what the whole download should be
     (the list says so): files that have not started yet are not in the map, so the total from the map alone would be too small. */
  function progressOf(files, expected) {
    let loaded = 0, total = 0;
    for (const f of Object.values(files || {})) { loaded += Math.min(f.loaded || 0, f.total || f.loaded || 0); total += f.total || 0; }
    const whole = Math.max(total, expected > 0 ? expected : 0);
    return { loaded, total: whole, fraction: whole > 0 ? Math.max(0, Math.min(1, loaded / whole)) : 0 };
  }

  /* "noch etwa 2 Min." from the speed so far; "" while it is too early to know. */
  function remaining(loaded, total, seconds) {
    if (!(seconds >= 3) || !(loaded > 0) || !(total > loaded)) return "";
    const left = (total - loaded) / (loaded / seconds);
    if (!isFinite(left)) return "";
    if (left < 60) return "noch unter einer Minute";
    if (left < 3600) return `noch etwa ${Math.round(left / 60)} Min.`;
    return `noch etwa ${Math.round(left / 360) / 10} Std.`.replace(".", ",");
  }

  /* What to tell a person when the model could not be loaded or did not answer. */
  function friendlyError(message) {
    const text = String(message || "");
    if (/out of memory|oom\b|allocate|alloc|memory|buffer.*size|exceeds.*(limit|maximum)|mapAsync/i.test(text)) return "Dem Gerät ist der Arbeitsspeicher ausgegangen. Schließe andere Programme und Tabs und versuche es noch einmal.";
    if (/quota|storage|disk/i.test(text)) return "Auf deinem Gerät ist nicht genug Platz, um die KI zu speichern. Gib Speicher frei und versuche es noch einmal.";
    if (/webgpu|adapter|gpu/i.test(text)) return "Die Grafikkarte konnte nicht benutzt werden. Versuche es in Chrome oder Edge am Computer, oder nach einem Neustart des Browsers.";
    if (/network|fetch|load failed|failed to load|timeout|abort|offline|http|40\d|50\d/i.test(text)) return "Die KI konnte nicht geladen werden. Prüfe deine Verbindung und versuche es noch einmal; schon geladene Teile bleiben erhalten.";
    return "Das hat nicht geklappt. Lade die Seite neu und versuche es noch einmal.";
  }

  /* "12,3 Wörter pro Sekunde" is not what people know: say it in words per second, roughly (a word is about 1.5 tokens in German). */
  function speedText(tokens, seconds) {
    if (!(seconds > 0.5) || !(tokens >= 3)) return "";
    const words = tokens / 1.5 / seconds;
    return `${words >= 10 ? Math.round(words) : (Math.round(words * 10) / 10).toString().replace(".", ",")} Wörter pro Sekunde`;
  }

  /* The addresses, in the browser's cache, of the big files of a variant of a model (the model and its data files).  The model is in the
     browser when all of them are: the small model file arrives first and would otherwise make an unfinished download look finished. */
  function cacheUrls(model, dtype) {
    const names = (model.files && model.files[dtype]) || [`onnx/model_${dtype}.onnx`];
    return names.map((name) => `https://huggingface.co/${model.id}/resolve/main/${name}`);
  }

  /* The model to use: the first of the list (best first) that this computer can run and that did not fail here before (`skip`: their ids),
     or null when there is none. */
  function bestModel(models, gpu, skip = []) {
    return models.find((m) => !skip.includes(m.id) && chooseRuntime(gpu, m).ok) || null;
  }

  /* Models that did not load on this computer are remembered for two weeks ({id: time}), so that the next visit starts with the one that works. */
  const SKIP_DAYS = 14;
  function activeSkips(raw, now = Date.now()) {
    let data = raw;
    if (typeof raw === "string") { try { data = JSON.parse(raw); } catch (error) { data = null; } }
    if (!data || typeof data !== "object" || Array.isArray(data)) return {};
    const out = {};
    for (const [id, time] of Object.entries(data)) {
      if (typeof id === "string" && Number.isFinite(time) && now - time < SKIP_DAYS * 86400000 && now - time > -86400000) out[id] = time;
    }
    return out;
  }

  /* Is this error one of a computer that cannot do it (memory, graphics card), and not one of the connection? */
  function isDeviceTrouble(message) {
    return /out of memory|oom\b|alloc|memory|buffer|webgpu|\bgpu\b|device|adapter|mapAsync|RangeError|Aborted|unreachable|RuntimeError|wasm|exceeds/i.test(String(message || ""));
  }

  /* The address of the note that the worker writes after the last part of a big file (regal-chat-worker.js, PartsCache). */
  function chunkMetaUrl(url) { return `${url}?nex-meta`; }

  // ------------------------------------------------------------------------------------- the saved chats (only on this device)
  const MAX_CHATS = 40, MAX_MESSAGES = 80, MAX_MESSAGE_CHARS = 20000, MAX_STORE_CHARS = 1200000;

  function titleFrom(text) {
    const line = String(text || "").replace(/\s+/g, " ").trim();
    if (!line) return "Neuer Chat";
    return line.length > 44 ? `${line.slice(0, 43).trimEnd()}…` : line;
  }

  function newChatId(random = Math.random, now = Date.now) {
    return `${now().toString(36)}${random().toString(36).slice(2, 8)}`;
  }

  /* What was read back from the browser's storage, as a clean list: wrong or damaged entries are left out, nothing is trusted. */
  function sanitizeStore(raw) {
    let data = raw;
    if (typeof raw === "string") { try { data = JSON.parse(raw); } catch (error) { data = null; } }
    const out = { chats: [], active: "" };
    if (!data || typeof data !== "object" || !Array.isArray(data.chats)) return out;
    const seen = new Set();
    for (const chat of data.chats) {
      if (!chat || typeof chat !== "object" || typeof chat.id !== "string" || !/^[\w-]{1,40}$/.test(chat.id) || seen.has(chat.id) || !Array.isArray(chat.messages)) continue;
      const messages = [];
      for (const m of chat.messages) {
        if (m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim()) messages.push({ role: m.role, content: m.content.slice(0, MAX_MESSAGE_CHARS) });
      }
      if (!messages.length) continue;
      seen.add(chat.id);
      out.chats.push({ id: chat.id, title: titleFrom(typeof chat.title === "string" ? chat.title : messages[0].content), updated: Number.isFinite(chat.updated) ? chat.updated : 0, messages: messages.slice(-MAX_MESSAGES) });
    }
    out.chats = trimChats(out.chats);
    out.active = typeof data.active === "string" && seen.has(data.active) ? data.active : "";
    return out;
  }

  /* The newest chats that fit: at most MAX_CHATS, and not more text than the storage of a browser should be asked to keep. */
  function trimChats(chats) {
    const sorted = [...chats].sort((a, b) => b.updated - a.updated).slice(0, MAX_CHATS);
    let total = 0;
    const kept = [];
    for (const chat of sorted) {
      const size = chat.messages.reduce((sum, m) => sum + m.content.length, 0);
      if (kept.length && total + size > MAX_STORE_CHARS) break;
      total += size;
      kept.push(chat);
    }
    return kept;
  }

  /* The chats in groups for the side bar: Heute, Gestern, Letzte 7 Tage, Älter; newest first. */
  function groupChats(chats, now = Date.now()) {
    const day = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
    const today = day(now);
    const groups = [["Heute", []], ["Gestern", []], ["Letzte 7 Tage", []], ["Älter", []]];
    for (const chat of [...chats].sort((a, b) => b.updated - a.updated)) {
      const age = Math.round((today - day(chat.updated)) / 86400000);
      groups[age <= 0 ? 0 : age === 1 ? 1 : age <= 7 ? 2 : 3][1].push(chat);
    }
    return groups.filter(([, list]) => list.length).map(([label, list]) => ({ label, chats: list }));
  }

  return { MAX_CHATS, MAX_MESSAGES, titleFrom, newChatId, sanitizeStore, trimChats, groupChats, SYSTEM_PROMPT, HISTORY_CHARS, MAX_INPUT, MAX_NEW_TOKENS, SUGGESTIONS, chooseRuntime, buildMessages, parseInline, parseBlocks, progressOf, remaining, friendlyError, speedText, cacheUrls, bestModel, activeSkips, isDeviceTrouble, chunkMetaUrl, SKIP_DAYS, formatBytes: Core.formatBytes };
});
