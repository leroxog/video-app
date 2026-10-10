/* Treff api: talking to the server (/api/treff/) and being "user 482913".  Nobody signs up: the first time somebody writes, the server
   gives the browser a number of six digits and a secret key; the browser keeps the key (localStorage) and shows it to the server in
   every request that changes something, which is how the server knows it is the same person again. */
(function () {
  "use strict";

  const T = (window.Treff = window.Treff || {});
  const KEY = "treff.key";

  const MESSAGES = {
    bad_name: "Der Name braucht 2 bis 40 Zeichen.",
    bad_description: "Die Beschreibung darf höchstens 300 Zeichen haben.",
    name_taken: "Eine Gruppe mit diesem Namen gibt es schon.",
    bad_text: "Schreibe etwas (höchstens 2000 Zeichen).",
    too_many_links: "Das sind zu viele Links in einer Nachricht (höchstens 6).",
    bad_reply: "Die Nachricht, auf die du antwortest, gibt es nicht mehr.",
    bad_title: "Der Titel braucht 1 bis 60 Zeichen.",
    bad_value: "Der Inhalt braucht 1 bis 600 Zeichen.",
    facts_closed: "In dieser Gruppe darf nur die Person, die sie gemacht hat, Fakten hinzufügen.",
    too_many_facts: "Mehr als 60 Fakten passen nicht in eine Gruppe. Lösche alte.",
    too_many: "Nicht so schnell. Warte einen Moment und versuche es noch einmal.",
    forbidden: "Das darfst du nicht.",
    need_identity: "Dafür brauchst du eine Nummer. Schreibe zuerst etwas.",
    not_found: "Das gibt es nicht (mehr).",
    bad_emoji: "Dieses Emoji gibt es nicht.",
    full: "Es sind gerade keine Nummern mehr frei.",
    busy: "Gerade ist viel los. Versuche es gleich noch einmal.",
    bad_reason: "Der Grund darf höchstens 200 Zeichen haben.",
  };

  const store = {
    get(key) { try { return window.localStorage.getItem(key); } catch (error) { return null; } },
    set(key, value) { try { window.localStorage.setItem(key, value); } catch (error) { /* not allowed: the number only lives until the page is closed */ } },
    remove(key) { try { window.localStorage.removeItem(key); } catch (error) { /* nothing to do */ } },
  };

  const identity = { key: store.get(KEY), number: null, loaded: false };

  async function request(method, path, body, extra = {}) {
    const headers = { Accept: "application/json", ...extra };
    if (identity.key) headers["X-Treff-Key"] = identity.key;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    let response;
    try {
      response = await fetch(`/api/treff${path}`, { method, headers, credentials: "omit", body: body === undefined ? undefined : JSON.stringify(body) });
    } catch (error) { throw Object.assign(new Error("Es gibt gerade keine Verbindung zum Server."), { code: "offline" }); }
    let data = null;
    try { data = await response.json(); } catch (error) { /* not JSON */ }
    if (!response.ok || !data || data.ok === false) {
      const code = (data && data.error) || `http_${response.status}`;
      throw Object.assign(new Error(MESSAGES[code] || "Das hat nicht geklappt. Bitte versuche es noch einmal."), { code, status: response.status });
    }
    return data;
  }

  const api = {
    get: (path) => request("GET", path),
    post: (path, body = {}) => request("POST", path, body),
    patch: (path, body = {}) => request("PATCH", path, body),
    del: (path) => request("DELETE", path),
    admin: (method, path, token, body) => request(method, path, body, { "X-Treff-Admin": token }),
  };

  /* Who am I?  The number if this browser has one (asks the server once; a key the server does not know any more is thrown away). */
  async function load() {
    if (identity.loaded) return identity.number;
    identity.loaded = true;
    if (!identity.key) return null;
    try {
      const data = await api.get("/me");
      identity.number = data.number;
      if (data.number == null) { identity.key = null; store.remove(KEY); }
    } catch (error) { identity.loaded = false; }
    return identity.number;
  }

  /* A number for this browser, made now if it has none (before the first thing somebody writes). */
  async function ensure() {
    await load();
    if (identity.number != null) return identity.number;
    const data = await api.post("/identity");
    if (data.key) { identity.key = data.key; store.set(KEY, data.key); }
    identity.number = data.number;
    identity.loaded = true;
    return identity.number;
  }

  Object.assign(T, { api, identity, ensure, loadIdentity: load, store });
})();
