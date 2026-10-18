/* Pulse core (the file keeps the name yipi-core.js): everything about the page that does not need a screen, as plain functions -- cutting a text into
   links, mentions and hashtags, counting characters the way the server does, German times and counts, the addresses of
   the pages, grouping notifications, and the arithmetic for picture sizes. It runs in the browser and in Node (that is
   how the tests run it). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.YipiCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const MAX_POST = 280;
  const HOME = "/";                                      // the home page of Pulse is the home page of the site
  const MAX_MEDIA = 3;                                  // photos per post (yipi.py: MAX_MEDIA)
  const MAX_VIDEO_BYTES = 25 * 1024 * 1024;             // a video (yipi.py: MAX_VIDEO_BYTES)
  const MAX_VIDEO_SECONDS = 90;                         // and how long it may be (only the browser can measure that)
  const MONTHS = ["Jan.", "Feb.", "März", "Apr.", "Mai", "Juni", "Juli", "Aug.", "Sept.", "Okt.", "Nov.", "Dez."];
  const MONTHS_LONG = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
  const HANDLE = /^[A-Za-z0-9_]{3,15}$/;
  // the same characters the server throws away (control and direction-changing characters; the joiner of emoji stays)
  const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f​‎‏‪-‮⁠-⁤﻿]/g;

  // ------------------------------------------------------------------------------------------------ text
  /* The text as the server will keep it: one Unicode form, no control characters, no runs of blank lines, trimmed. */
  function cleanText(text) {
    return String(text == null ? "" : text).normalize("NFC").replace(/\r\n?/g, "\n").replace(CONTROL, "").replace(/\n{3,}/g, "\n\n").trim();
  }

  /* Characters, not bytes and not UTF-16 units: an emoji is one. */
  function charCount(text) {
    return Array.from(cleanText(text)).length;
  }

  /* "ok", "warn" (20 or fewer left) or "over" -- for the ring of the composer. */
  function counterState(text, limit = MAX_POST) {
    const left = limit - charCount(text);
    return left < 0 ? "over" : left <= 20 ? "warn" : "ok";
  }

  const PATTERN = /(https?:\/\/[^\s<>"']+)|(?<![\p{L}\p{N}_@])@([A-Za-z0-9_]{3,15})(?![\p{L}\p{N}_@])|(?<![\p{L}\p{N}_#&/])#([\p{L}\p{N}_]{2,50})/giu;
  const PAIRS = { ")": "(", "]": "[", "}": "{" };

  /* The address ends before the punctuation of the sentence around it; a closing bracket belongs to it only if it has
     its opening bracket inside the address. */
  function splitUrl(raw) {
    let url = raw;
    let tail = "";
    while (url.length) {
      const last = url[url.length - 1];
      if (".,;:!?'\"”’»".includes(last)) { tail = last + tail; url = url.slice(0, -1); continue; }
      if (PAIRS[last] && url.split(last).length > url.split(PAIRS[last]).length) { tail = last + tail; url = url.slice(0, -1); continue; }
      break;
    }
    return [url, tail];
  }

  function shortUrl(url) {
    const bare = url.replace(/^https?:\/\//i, "").replace(/^www\./i, "");
    return bare.length > 30 ? `${bare.slice(0, 29)}…` : bare;
  }

  /* Cuts a text into pieces: {type: "text" | "url" | "mention" | "hashtag", ...}. Nothing here is HTML: the page puts every
     piece on the page as text or as a link it builds itself. */
  function tokenize(text) {
    const source = String(text == null ? "" : text);
    const tokens = [];
    let last = 0;
    const push = (piece) => {
      if (!piece.text) return;
      const before = tokens[tokens.length - 1];
      if (piece.type === "text" && before && before.type === "text") before.text += piece.text;
      else tokens.push(piece);
    };
    for (const match of source.matchAll(PATTERN)) {
      push({ type: "text", text: source.slice(last, match.index) });
      last = match.index + match[0].length;
      if (match[1]) {
        const [url, tail] = splitUrl(match[1]);
        let valid = false;
        try { valid = /^https?:$/.test(new URL(url).protocol) && url.length > 8; } catch (error) { valid = false; }
        if (valid) push({ type: "url", text: shortUrl(url), href: url });
        else push({ type: "text", text: url });
        push({ type: "text", text: tail });
      } else if (match[2]) {
        push({ type: "mention", text: `@${match[2]}`, handle: match[2] });
      } else if (/\p{L}/u.test(match[3])) {
        push({ type: "hashtag", text: `#${match[3]}`, tag: match[3] });
      } else {
        push({ type: "text", text: match[0] });
      }
    }
    push({ type: "text", text: source.slice(last) });
    return tokens;
  }

  // ------------------------------------------------------------------------------------------ numbers, times
  /* 999 -> "999", 1234 -> "1,2 Tsd.", 12000 -> "12 Tsd.", 2500000 -> "2,5 Mio." */
  function formatCount(n) {
    const value = Math.max(0, Math.floor(Number(n) || 0));
    const one = (x) => x.toFixed(1).replace(".", ",").replace(/,0$/, "");
    if (value < 1000) return String(value);
    if (value < 10000) return `${one(Math.floor(value / 100) / 10)} Tsd.`;
    if (value < 1000000) return `${Math.floor(value / 1000)} Tsd.`;
    if (value < 10000000) return `${one(Math.floor(value / 100000) / 10)} Mio.`;
    return `${Math.floor(value / 1000000)} Mio.`;
  }

  const pad2 = (n) => String(n).padStart(2, "0");

  /* "Jetzt", "5 Sek.", "5 Min.", "3 Std.", "2 Tg.", then the date: "12. Okt." (with the year when it is another year). */
  function relativeTime(iso, now = Date.now()) {
    const then = new Date(iso);
    if (Number.isNaN(then.getTime())) return "";
    const seconds = Math.floor((now - then.getTime()) / 1000);
    if (seconds < 5) return "Jetzt";
    if (seconds < 60) return `${seconds} Sek.`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)} Min.`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} Std.`;
    if (seconds < 7 * 86400) return `${Math.floor(seconds / 86400)} Tg.`;
    const sameYear = then.getFullYear() === new Date(now).getFullYear();
    return `${then.getDate()}. ${MONTHS[then.getMonth()]}${sameYear ? "" : ` ${then.getFullYear()}`}`;
  }

  /* "14:35 · 12. Okt. 2026" */
  function fullTime(iso) {
    const then = new Date(iso);
    if (Number.isNaN(then.getTime())) return "";
    return `${pad2(then.getHours())}:${pad2(then.getMinutes())} · ${then.getDate()}. ${MONTHS[then.getMonth()]} ${then.getFullYear()}`;
  }

  /* "Beigetreten Oktober 2026" */
  function joinedLabel(iso) {
    const then = new Date(iso);
    return Number.isNaN(then.getTime()) ? "" : `Beigetreten ${MONTHS_LONG[then.getMonth()]} ${then.getFullYear()}`;
  }

  // ----------------------------------------------------------------------------------------- addresses
  const isHandle = (value) => typeof value === "string" && HANDLE.test(value);

  /* The page for an address: {name: "home" | "explore" | "search" | "nex" | "notifications" | "messages" | "thread" | "bookmarks" |
     "settings" | "moderation" | "login" | "signup" | "profile" | "post" | "followers" | "following" | "notfound", ...}. */
  function parsePath(pathname, search = "") {
    const path = String(pathname || "/").replace(/\/+$/, "") || "/";
    const params = new URLSearchParams(search);
    const fixed = { "/": "home", "/explore": "explore", "/notifications": "notifications", "/messages": "messages", "/bookmarks": "bookmarks", "/moderation": "moderation", "/games": "games", "/videos": "videos", "/i/login": "login", "/i/signup": "signup" };
    if (path === "/explore") return { name: "explore", tab: ["trends", "media", "people"].includes(params.get("tab")) ? params.get("tab") : "" };
    if (fixed[path]) return { name: fixed[path] };
    if (path === "/i/nex") return { name: "nex", q: (params.get("q") || "").slice(0, 500), post: /^\d{1,18}$/.test(params.get("post") || "") ? Number(params.get("post")) : 0 };
    if (path === "/search") return { name: "search", q: params.get("q") || "", type: ["people", "media"].includes(params.get("type")) ? params.get("type") : "posts", sort: params.get("sort") === "new" ? "new" : "top" };
    if (path === "/settings") return { name: "settings", section: "" };
    let match = /^\/settings\/([a-z]+)$/.exec(path);
    if (match) return { name: "settings", section: match[1] };
    match = /^\/messages\/([A-Za-z0-9_]{3,15})$/.exec(path);
    if (match) return { name: "thread", handle: match[1] };
    match = /^\/games\/([a-z0-9-]{1,40})$/.exec(path);
    if (match) return { name: "game", slug: match[1] };
    match = /^\/g\/(\d{1,10})$/.exec(path);
    if (match && Number(match[1]) > 0) return { name: "group", id: Number(match[1]) };
    match = /^\/([A-Za-z0-9_]{3,15})\/status\/(\d{1,18})$/.exec(path);
    if (match) return { name: "post", handle: match[1], id: Number(match[2]) };
    match = /^\/([A-Za-z0-9_]{3,15})\/(followers|following)$/.exec(path);
    if (match) return { name: match[2], handle: match[1] };
    match = /^\/([A-Za-z0-9_]{3,15})$/.exec(path);
    if (match) return { name: "profile", handle: match[1] };
    return { name: "notfound" };
  }

  function buildPath(route) {
    switch (route.name) {
      case "home": return HOME;
      case "explore": return route.tab ? `/explore?tab=${route.tab}` : "/explore";
      case "notifications": case "messages": case "bookmarks": case "moderation": return `/${route.name}`;
      case "games": case "videos": return `/${route.name}`;
      case "game": return `/games/${route.slug}`;
      case "group": return `/g/${route.id}`;
      case "nex": return route.post ? `/i/nex?post=${route.post}` : route.q ? `/i/nex?q=${encodeURIComponent(route.q)}` : "/i/nex";
      case "login": return "/i/login";
      case "signup": return "/i/signup";
      case "search": return `/search?q=${encodeURIComponent(route.q || "")}${route.type === "people" ? "&type=people" : route.type === "media" ? "&type=media" : ""}${route.sort === "new" && route.type !== "people" ? "&sort=new" : ""}`;
      case "settings": return route.section ? `/settings/${route.section}` : "/settings";
      case "thread": return `/messages/${route.handle}`;
      case "profile": return `/${route.handle}`;
      case "post": return `/${route.handle}/status/${route.id}`;
      case "followers": case "following": return `/${route.handle}/${route.name}`;
      default: return HOME;
    }
  }

  // ------------------------------------------------------------------------------------- notifications
  /* Likes and reposts of the same post, and new followers, that follow each other become one line ("A, B und 3 weitere ..."). */
  function groupNotifications(items) {
    const groups = [];
    for (const item of items) {
      const last = groups[groups.length - 1];
      const same = last && last.kind === item.kind && (item.kind === "follow" || (item.post && last.post && last.post.id === item.post.id)) && ["like", "repost", "follow"].includes(item.kind);
      if (same) {
        if (!last.actors.some((actor) => actor.handle === item.actor.handle)) last.actors.push(item.actor);
        last.ids.push(item.id);
        last.read = last.read && item.read;
      } else {
        groups.push({ kind: item.kind, actors: [item.actor], post: item.post || null, createdAt: item.createdAt, read: item.read, ids: [item.id] });
      }
    }
    return groups;
  }

  // ----------------------------------------------------------------------------------------- pictures
  /* The size a picture gets when its longest side may be `max` (never larger than it is). */
  function fitSize(width, height, max) {
    const scale = Math.min(1, max / Math.max(width, height));
    return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
  }

  /* The part of a picture that is cut out so it fills a box of a given shape (centered, like "object-fit: cover"). */
  function coverCrop(width, height, targetWidth, targetHeight) {
    const wanted = targetWidth / targetHeight;
    const actual = width / height;
    if (actual > wanted) {
      const cropWidth = Math.round(height * wanted);
      return { x: Math.round((width - cropWidth) / 2), y: 0, width: cropWidth, height };
    }
    const cropHeight = Math.round(width / wanted);
    return { x: 0, y: Math.round((height - cropHeight) / 2), width, height: cropHeight };
  }

  // ------------------------------------------------------------------------------------------ people
  /* A colour for somebody without a picture: always the same one for the same handle. */
  function avatarHue(handle) {
    let hash = 7;
    for (const ch of String(handle).toLowerCase()) hash = (hash * 31 + ch.charCodeAt(0)) % 360;
    return hash;
  }

  function initials(name, handle) {
    const words = String(name || "").trim().split(/\s+/).filter(Boolean);
    const letters = words.length > 1 ? Array.from(words[0])[0] + Array.from(words[1])[0] : Array.from(words[0] || String(handle || "?"))[0];
    return letters.toUpperCase();
  }

  // ------------------------------------------------------------------------------------------------ polls
  const MAX_POLL_OPTION = 25;                           // characters of an answer (yipi.py: MAX_POLL_OPTION)
  const POLL_OPTIONS = [2, 4];                          // fewest and most answers
  const POLL_LENGTHS = [[30, "30 Minuten"], [60, "1 Stunde"], [360, "6 Stunden"], [1440, "1 Tag"], [4320, "3 Tage"], [10080, "7 Tage"]];

  /* What is left of a poll: {ended, text}: "noch 5 Min.", "noch 3 Std.", "noch 2 Tage", "Beendet". */
  function pollTimeLeft(endsAt, now = Date.now()) {
    const ends = new Date(endsAt).getTime();
    if (Number.isNaN(ends) || ends <= now) return { ended: true, text: "Beendet" };
    const seconds = Math.ceil((ends - now) / 1000);
    if (seconds < 60) return { ended: false, text: "noch weniger als 1 Min." };
    if (seconds < 3600) return { ended: false, text: `noch ${Math.ceil(seconds / 60)} Min.` };
    if (seconds < 86400) return { ended: false, text: `noch ${Math.ceil(seconds / 3600)} Std.` };
    const days = Math.ceil(seconds / 86400);
    return { ended: false, text: `noch ${days} ${days === 1 ? "Tag" : "Tage"}` };
  }

  /* The share of an answer in percent (whole numbers, 0 when nobody voted). */
  function pollPercent(votes, total) {
    return total > 0 ? Math.round((Math.max(0, votes) / total) * 100) : 0;
  }

  /* "3 Stimmen", "1 Stimme" */
  const pollVotes = (total) => `${formatCount(total)} ${total === 1 ? "Stimme" : "Stimmen"}`;

  /* The answers the person typed, cleaned and without the empty ones: {options, valid, problem}. A poll needs 2 to 4 different answers. */
  function pollAnswers(inputs) {
    const options = (Array.isArray(inputs) ? inputs : []).map((entry) => cleanText(entry).replace(/\s+/g, " ")).filter(Boolean);
    const unique = new Set(options.map((option) => option.toLowerCase()));
    let problem = "";
    if (options.length < POLL_OPTIONS[0]) problem = "Eine Umfrage braucht mindestens zwei Antworten.";
    else if (unique.size !== options.length) problem = "Die Antworten müssen verschieden sein.";
    else if (options.some((option) => Array.from(option).length > MAX_POLL_OPTION)) problem = `Eine Antwort darf höchstens ${MAX_POLL_OPTION} Zeichen haben.`;
    return { options, valid: !problem, problem };
  }

  // --------------------------------------------------------------------------------------------- Nex
  const NEX_CHATS = 30;                                 // how many conversations with Nex are kept in this browser

  /* The name of a conversation: its first question, cut to fit. */
  function nexTitle(text) {
    const clean = cleanText(text).replace(/\s+/g, " ");
    const letters = Array.from(clean);
    if (!letters.length) return "Neues Gespräch";
    return letters.length > 38 ? `${letters.slice(0, 37).join("").trimEnd()}…` : clean;
  }

  const newChatId = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

  /* The conversations of one person as they are kept in the browser: {handle, chats: [{id, title, at, messages}], current}. Anything of
     somebody else, broken or too much is dropped; the older format (a single list of messages) becomes one conversation. */
  function nexStore(raw, handle) {
    const empty = { handle, chats: [], current: "" };
    if (!raw || typeof raw !== "object" || raw.handle !== handle) return empty;
    let chats = [];
    if (Array.isArray(raw.chats)) {
      for (const entry of raw.chats) {
        if (!entry || typeof entry !== "object" || typeof entry.id !== "string" || !/^[\w-]{1,40}$/.test(entry.id)) continue;
        const messages = nexMessages(entry.messages, 30);
        if (!messages.length) continue;
        const first = messages.find((message) => message.role === "user");
        chats.push({ id: entry.id, title: typeof entry.title === "string" && entry.title.trim() ? Array.from(entry.title.trim()).slice(0, 60).join("") : nexTitle(first ? first.content : ""), at: Number.isFinite(entry.at) ? entry.at : 0, messages });
      }
    } else if (Array.isArray(raw.messages)) {
      const messages = nexMessages(raw.messages, 30);
      const first = messages.find((message) => message.role === "user");
      if (messages.length) chats = [{ id: newChatId(), title: nexTitle(first ? first.content : ""), at: Date.now(), messages }];
    }
    const seen = new Set();
    chats = chats.filter((chat) => (seen.has(chat.id) ? false : seen.add(chat.id))).sort((a, b) => b.at - a.at).slice(0, NEX_CHATS);
    return { handle, chats, current: chats.some((chat) => chat.id === raw.current) ? raw.current : "" };
  }

  /* The store with one conversation added or replaced (the newest first, never more than NEX_CHATS). */
  function nexUpsert(store, chat) {
    const rest = store.chats.filter((entry) => entry.id !== chat.id);
    return { ...store, chats: [chat, ...rest].sort((a, b) => b.at - a.at).slice(0, NEX_CHATS), current: chat.id };
  }

  function nexRemove(store, id) {
    return { ...store, chats: store.chats.filter((chat) => chat.id !== id), current: store.current === id ? "" : store.current };
  }

  const NEX_TURNS = 12;                                 // how many of the last messages go to the server (yipi.py: NEX_TURNS)
  const NEX_KEEP = 30;                                  // how many stay in the browser

  /* The conversation as it is kept and sent: only real turns, the last ones, each at most 1500 characters. */
  function nexMessages(list, keep = NEX_TURNS) {
    const clean = [];
    for (const item of Array.isArray(list) ? list : []) {
      if (!item || (item.role !== "user" && item.role !== "assistant") || typeof item.content !== "string") continue;
      const content = cleanText(item.content).slice(0, 1500);
      if (content) clean.push({ role: item.role, content });
    }
    return clean.slice(-keep);
  }

  /* An answer of Nex cut into paragraphs and lists: [{type: "p", text} | {type: "list", items: [text]}]. A blank line starts a new
     paragraph; lines that begin with "- ", "* ", "• " or "1. " are the items of a list. */
  function nexBlocks(text) {
    const blocks = [];
    for (const part of String(text == null ? "" : text).replace(/\r\n?/g, "\n").split(/\n{2,}/)) {
      let paragraph = null;
      let list = null;
      for (const raw of part.split("\n")) {
        const line = raw.trim();
        if (!line) continue;
        const bullet = /^(?:[-*•]|\d+[.)])\s+(.*)$/.exec(line);
        if (bullet) {
          paragraph = null;
          if (!list) { list = { type: "list", items: [] }; blocks.push(list); }
          list.items.push(bullet[1]);
        } else {
          list = null;
          if (!paragraph) { paragraph = { type: "p", text: line }; blocks.push(paragraph); }
          else paragraph.text += `\n${line}`;
        }
      }
    }
    return blocks;
  }


  // ------------------------------------------------------------------------------------------------- GIFs
  /* What a search for a GIF may be: tidy, one line, at most 40 characters. */
  function gifQuery(text) {
    return Array.from(String(text == null ? "" : text).normalize("NFC").replace(CONTROL, "").replace(/\s+/g, " ").trim()).slice(0, 40).join("");
  }

  /* The columns of the GIF grid: each GIF goes to the shortest column, so tall and wide ones fit together without holes. */
  function gifColumns(items, count) {
    const columns = Array.from({ length: Math.max(1, count) }, () => ({ height: 0, items: [] }));
    for (const item of items) {
      const target = columns.reduce((best, column) => (column.height < best.height ? column : best));
      target.items.push(item);
      target.height += (item.height || 1) / (item.width || 1);
    }
    return columns.map((column) => column.items);
  }

  return {
    HOME, MAX_POST, MAX_MEDIA, MAX_VIDEO_BYTES, MAX_VIDEO_SECONDS, NEX_CHATS, nexTitle, newChatId, nexStore, nexUpsert, nexRemove, MAX_POLL_OPTION, POLL_OPTIONS, POLL_LENGTHS, pollTimeLeft, pollPercent, pollVotes, pollAnswers, NEX_TURNS, NEX_KEEP, nexMessages, nexBlocks, gifQuery, gifColumns, cleanText, charCount, counterState, tokenize, shortUrl, formatCount, relativeTime, fullTime, joinedLabel,
    isHandle, parsePath, buildPath, groupNotifications, fitSize, coverCrop, avatarHue, initials,
  };
});
