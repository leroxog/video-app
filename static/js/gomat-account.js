/* gomat account: talks to the account routes of the server (/api/gomat/...): sign up, sign in, sign out, saving the
   progress, changing the password, deleting the account. Every call answers {ok, status, data}; when there is no
   connection it answers {ok: false, offline: true, data: {error: "network"}} instead of throwing.
   Also keeps a small note in the browser (key gomat.sync) of what this device last knew about the account:
   {email, rev, dirty} -- that is what decides, when the page opens, whether the account's or the device's progress wins. */
(function () {
  "use strict";

  const META_KEY = "gomat.sync";

  async function call(method, path, body, keepalive) {
    try {
      const response = await fetch(path, {
        method, credentials: "same-origin", keepalive: !!keepalive,
        headers: body === undefined ? { Accept: "application/json" } : { Accept: "application/json", "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      let data = {};
      try { data = await response.json(); } catch (error) { data = {}; }
      return { ok: response.ok && data.ok === true, status: response.status, data };
    } catch (error) {
      return { ok: false, status: 0, offline: true, data: { error: "network" } };
    }
  }

  function readMeta(storage) {
    try {
      const raw = JSON.parse(storage.getItem(META_KEY));
      if (raw && typeof raw.email === "string" && Number.isInteger(raw.rev)) return { email: raw.email, rev: raw.rev, dirty: raw.dirty === true };
    } catch (error) { /* nothing stored, or broken: no note */ }
    return null;
  }

  function writeMeta(storage, meta) {
    try {
      if (meta) storage.setItem(META_KEY, JSON.stringify(meta));
      else storage.removeItem(META_KEY);
    } catch (error) { /* a full or blocked storage: the note is only a help */ }
  }

  window.GomatAccount = {
    me: () => call("GET", "/api/gomat/me"),
    signup: (name, email, password, state) => call("POST", "/api/gomat/signup", { name, email, password, state }),
    login: (email, password) => call("POST", "/api/gomat/login", { email, password }),
    logout: () => call("POST", "/api/gomat/logout", {}),
    save: (state, baseRev, keepalive) => call("PUT", "/api/gomat/save", { state, baseRev }, keepalive),
    changePassword: (oldPassword, newPassword) => call("POST", "/api/gomat/password", { oldPassword, newPassword }),
    remove: (password) => call("POST", "/api/gomat/delete", { password }),
    readMeta, writeMeta,
    META_KEY,
  };
})();
