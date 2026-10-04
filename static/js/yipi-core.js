/* yipi core: everything about the page that does not need a screen, as plain functions -- cutting a text into
   links, mentions and hashtags, counting characters the way the server does, German times and counts, the addresses of
   the pages, grouping notifications, and the arithmetic for picture sizes. It runs in the browser and in Node (that is
   how the tests run it). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.YipiCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const MAX_POST = 280;
  const MAX_MEDIA = 4;
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

  /* "Jetzt", "5 Sek.", "5 Min.", "3 Std.", then the date: "12. Okt." (with the year when it is another year). */
  function relativeTime(iso, now = Date.now()) {
    const then = new Date(iso);
    if (Number.isNaN(then.getTime())) return "";
    const seconds = Math.floor((now - then.getTime()) / 1000);
    if (seconds < 5) return "Jetzt";
    if (seconds < 60) return `${seconds} Sek.`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)} Min.`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} Std.`;
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

  /* The page for an address: {name: "home" | "explore" | "search" | "notifications" | "messages" | "thread" | "bookmarks" |
     "settings" | "moderation" | "login" | "signup" | "profile" | "post" | "followers" | "following" | "notfound", ...}. */
  function parsePath(pathname, search = "") {
    const path = String(pathname || "/").replace(/\/+$/, "") || "/";
    const params = new URLSearchParams(search);
    const fixed = { "/": "home", "/explore": "explore", "/notifications": "notifications", "/messages": "messages", "/bookmarks": "bookmarks", "/moderation": "moderation", "/i/login": "login", "/i/signup": "signup" };
    if (fixed[path]) return { name: fixed[path] };
    if (path === "/search") return { name: "search", q: params.get("q") || "", type: params.get("type") === "people" ? "people" : "posts" };
    if (path === "/settings") return { name: "settings", section: "" };
    let match = /^\/settings\/([a-z]+)$/.exec(path);
    if (match) return { name: "settings", section: match[1] };
    match = /^\/messages\/([A-Za-z0-9_]{3,15})$/.exec(path);
    if (match) return { name: "thread", handle: match[1] };
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
      case "home": return "/";
      case "explore": case "notifications": case "messages": case "bookmarks": case "moderation": return `/${route.name}`;
      case "login": return "/i/login";
      case "signup": return "/i/signup";
      case "search": return `/search?q=${encodeURIComponent(route.q || "")}${route.type === "people" ? "&type=people" : ""}`;
      case "settings": return route.section ? `/settings/${route.section}` : "/settings";
      case "thread": return `/messages/${route.handle}`;
      case "profile": return `/${route.handle}`;
      case "post": return `/${route.handle}/status/${route.id}`;
      case "followers": case "following": return `/${route.handle}/${route.name}`;
      default: return "/";
    }
  }

  // ------------------------------------------------------------------------------------- notifications
  /* Likes and reposts of the same Yip, and new followers, that follow each other become one line ("A, B und 3 weitere ..."). */
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

  return {
    MAX_POST, MAX_MEDIA, cleanText, charCount, counterState, tokenize, shortUrl, formatCount, relativeTime, fullTime, joinedLabel,
    isHandle, parsePath, buildPath, groupNotifications, fitSize, coverCrop, avatarHue, initials,
  };
});
