/* Treff core: the small functions that do not touch the page -- what a message is made of (links, server addresses, bold, code, the
   numbers of other people), how a time is said, which colour somebody gets, what the addresses of the page mean.  They run in the
   browser and in Node (that is how they are tested, tests/treff_core.test.js). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.TreffCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const MONTHS = ["Jan.", "Feb.", "März", "Apr.", "Mai", "Juni", "Juli", "Aug.", "Sept.", "Okt.", "Nov.", "Dez."];
  const DAYS = ["So.", "Mo.", "Di.", "Mi.", "Do.", "Fr.", "Sa."];
  const REACTIONS = ["👍", "❤️", "😂", "😮", "🙏", "✅"];
  const KNOWN_TLD = "com|net|org|de|eu|io|gg|me|tv|xyz|fun|club|online|site|app|dev|co|uk|us|at|ch|info|biz|cc|ws|to|fm|ly|gl|pro|games|live|cloud|host|network|world|cz|pl|nl|fr|es|it|ru";

  // ------------------------------------------------------------------------------------------------- the names
  /* "user 482913" */
  const userName = (number) => `user ${number}`;
  const userNumber = (text) => { const m = /^\s*(?:user\s*|@)?(\d{6})\s*$/i.exec(String(text)); return m ? Number(m[1]) : null; };

  function hash(text) {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  /* A colour that stays the same for the same seed: {hue, background, ink}. */
  function colorFor(seed) {
    const hue = hash(String(seed)) % 360;
    return { hue, background: `hsl(${hue} 62% 46%)`, soft: `hsl(${hue} 70% 62%)`, ink: "#fff" };
  }
  /* One or two letters for a group's picture. */
  function initials(name) {
    const words = String(name).replace(/[^\p{L}\p{N} ]/gu, " ").trim().split(/\s+/).filter(Boolean);
    if (!words.length) return "?";
    const first = Array.from(words[0])[0].toUpperCase();
    return words.length > 1 ? first + Array.from(words[1])[0].toUpperCase() : first;
  }

  function slugify(name) {
    const base = String(name).toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss").normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return base.slice(0, 40) || "gruppe";
  }

  // ------------------------------------------------------------------------------------------- the addresses
  const groupPath = (group) => `/g/${group.id}/${group.slug || slugify(group.name)}`;
  /* What an address of the page means. */
  function parsePath(pathname) {
    let m;
    if (pathname === "/" || pathname === "") return { name: "home" };
    if (pathname === "/treff-admin") return { name: "admin" };
    if ((m = /^\/g\/(\d{1,9})(?:\/[^/]*)?\/?$/.exec(pathname))) return { name: "group", id: Number(m[1]) };
    return { name: "notfound" };
  }

  // ----------------------------------------------------------------------------------------------- times
  const pad = (n) => String(n).padStart(2, "0");
  const toDate = (iso) => (iso instanceof Date ? iso : new Date(iso));
  const clock = (iso) => { const d = toDate(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const dayStart = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

  /* "Heute", "Gestern", "Mi., 8. Okt." (and with the year when it is another one). */
  function dayLabel(iso, now = new Date()) {
    const d = toDate(iso);
    if (sameDay(d, now)) return "Heute";
    if (sameDay(d, new Date(dayStart(now).getTime() - 12 * 3600 * 1000))) return "Gestern";
    return `${DAYS[d.getDay()]}, ${d.getDate()}. ${MONTHS[d.getMonth()]}${d.getFullYear() === now.getFullYear() ? "" : ` ${d.getFullYear()}`}`;
  }

  /* For lists: "jetzt", "vor 5 Min.", "14:32", "Gestern", "Mi.", "8. Okt.". */
  function listTime(iso, now = new Date()) {
    if (!iso) return "";
    const d = toDate(iso);
    const seconds = (now - d) / 1000;
    if (seconds < 45) return "jetzt";
    if (seconds < 3600) return `vor ${Math.max(1, Math.round(seconds / 60))} Min.`;
    if (sameDay(d, now)) return clock(d);
    if (sameDay(d, new Date(dayStart(now).getTime() - 12 * 3600 * 1000))) return "Gestern";
    if (seconds < 6 * 86400) return DAYS[d.getDay()];
    return `${d.getDate()}. ${MONTHS[d.getMonth()]}${d.getFullYear() === now.getFullYear() ? "" : ` ${d.getFullYear()}`}`;
  }

  // ------------------------------------------------------------------------------------------ the text
  /* A message is made of parts.  Inline: {type: "text" | "bold" | "italic" | "code" | "link" | "address" | "user"} (+ value / href);
     blocks: {type: "codeblock", value}, {type: "quote", parts}, {type: "break"}.  Nothing is ever turned into HTML: the page makes
     elements of these parts. */
  const INLINE = new RegExp([
    "(?<code>`[^`\\n]+`)",
    "(?<bold>\\*\\*[^*\\n]+\\*\\*)",
    "(?<italic>(?<![\\w*])\\*[^*\\s][^*\\n]*[^*\\s]\\*(?![\\w*])|(?<![\\w*])\\*[^*\\s]\\*(?![\\w*]))",
    "(?<link>https?:\\/\\/[^\\s<>\"']+|www\\.[^\\s<>\"']+\\.[a-z]{2,}[^\\s<>\"']*)",
    "(?<user>\\buser\\s?\\d{6}\\b)",
    "(?<ip>(?<![\\w.])(?:\\d{1,3}\\.){3}\\d{1,3}(?::\\d{2,5})?(?![\\w.]*\\w))",
    `(?<host>(?<![\\w@./-])(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.)+(?:(?:${KNOWN_TLD})(?::\\d{2,5})?|[a-z]{2,}:\\d{2,5})(?![\\w.-]*\\w|\\.[a-z]))`,
  ].join("|"), "giu");

  function trimLink(raw) {
    let url = raw, trailing = "";
    while (url && /[.,;:!?)\]»”’…]$/.test(url)) {
      if (url.endsWith(")") && (url.match(/\(/g) || []).length >= (url.match(/\)/g) || []).length) break;     // a closing bracket that belongs to the address
      trailing = url.slice(-1) + trailing; url = url.slice(0, -1);
    }
    return [url, trailing];
  }

  /* The safe address behind a link text, or null (only http and https). */
  function safeUrl(text) {
    const raw = /^www\./i.test(text) ? `https://${text}` : text;
    try { const u = new URL(raw); return u.protocol === "http:" || u.protocol === "https:" ? u.href : null; } catch (error) { return null; }
  }
  /* "example.com/wiki/Seite" for showing. */
  function shortLink(text) {
    const url = safeUrl(text);
    if (!url) return text;
    const u = new URL(url);
    const rest = `${u.pathname === "/" ? "" : u.pathname}${u.search}`;
    const shown = `${u.host.replace(/^www\./, "")}${rest}`;
    return shown.length > 48 ? `${shown.slice(0, 47)}…` : shown;
  }

  function inline(text) {
    const parts = [];
    let at = 0;
    const push = (type, value, extra) => { if (value !== "") parts.push({ type, value, ...extra }); };
    for (const m of text.matchAll(INLINE)) {
      if (m.index > at) push("text", text.slice(at, m.index));
      const g = m.groups;
      if (g.code) push("code", g.code.slice(1, -1));
      else if (g.bold) push("bold", g.bold.slice(2, -2));
      else if (g.italic) push("italic", g.italic.slice(1, -1));
      else if (g.link) {
        const [url, trailing] = trimLink(g.link);
        const href = safeUrl(url);
        if (href) { push("link", url, { href }); push("text", trailing); } else push("text", g.link);
      } else if (g.user) push("user", g.user, { number: Number(g.user.replace(/\D/g, "")) });
      else push("address", m[0]);
      at = m.index + m[0].length;
    }
    if (at < text.length) push("text", text.slice(at));
    return parts.reduce((out, part) => {                                  // neighbouring pieces of text are one piece
      const last = out[out.length - 1];
      if (last && last.type === "text" && part.type === "text") last.value += part.value; else out.push(part);
      return out;
    }, []);
  }

  function parseMessage(text) {
    const blocks = [];
    const lines = String(text).split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (/^```/.test(lines[i])) {                                   // a block of code up to the next ``` (or the end)
        const body = [];
        let j = i + 1;
        while (j < lines.length && !/^```/.test(lines[j])) body.push(lines[j++]);
        blocks.push({ type: "codeblock", value: body.join("\n") });
        i = j;
        continue;
      }
      if (/^>\s?/.test(lines[i])) { blocks.push({ type: "quote", parts: inline(lines[i].replace(/^>\s?/, "")) }); continue; }
      if (blocks.length && !["codeblock", "quote"].includes(blocks[blocks.length - 1].type)) blocks.push({ type: "break" });
      if (lines[i] !== "") blocks.push(...inline(lines[i]));
    }
    return blocks;
  }

  /* What a fact is: a link, an address that is copied (server, IP) or plain text. */
  function factKind(value) {
    const v = String(value).trim();
    if (/^https?:\/\/\S+$/i.test(v) && safeUrl(v)) return "link";
    if (/^(?:(?:\d{1,3}\.){3}\d{1,3}|(?:[a-z0-9-]+\.)+[a-z]{2,})(?::\d{2,5})?$/i.test(v)) return "address";
    return "text";
  }

  /* Sorting of the list for the sidebar. */
  const SORTS = [["active", "Aktiv"], ["new", "Neu"], ["top", "Beliebt"]];

  return { MONTHS, DAYS, REACTIONS, SORTS, userName, userNumber, hash, colorFor, initials, slugify, groupPath, parsePath, clock, dayLabel, listTime, parseMessage, inline, safeUrl, shortLink, factKind, trimLink };
});
