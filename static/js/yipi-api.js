/* yipi api: the calls to the server (/api/yipi/...). Every call answers {ok, status, data}; with no connection it answers
   {ok: false, offline: true, data: {error: "network"}} instead of throwing. `YipiApi.message(reply)` is the German sentence
   for what went wrong. */
(function () {
  "use strict";

  const MESSAGES = {
    network: "Keine Verbindung. Prüfe dein Internet und versuche es noch einmal.",
    not_logged_in: "Bitte melde dich an.",
    too_many: "Zu viele Versuche. Bitte warte einen Moment.",
    forbidden: "Das ist nicht erlaubt.",
    not_found: "Das gibt es nicht (mehr).",
    blocked: "Das geht nicht, weil eine Blockierung besteht.",
    self: "Das geht bei dir selbst nicht.",
    bad_request: "Das hat nicht geklappt.",
    too_long: "Das ist zu lang.",
    empty: "Schreib etwas oder füge ein Bild hinzu.",
    bad_text: "Das ist kein gültiger Text.",
    duplicate: "Das hast du gerade schon geyippt.",
    bad_media: "Mit den Bildern stimmt etwas nicht.",
    bad_image: "Das ist kein Bild, das yipi kennt (JPEG, PNG, GIF oder WebP).",
    too_big: "Das Bild ist zu groß (höchstens 5 MB).",
    no_file: "Es wurde keine Datei gesendet.",
    reply_gone: "Der Yip, auf den du antworten willst, ist nicht mehr da.",
    quote_gone: "Der Yip, den du zitieren willst, ist nicht mehr da.",
    bad_handle: "Der Nutzername darf 3 bis 15 Zeichen haben: Buchstaben, Zahlen und _.",
    reserved_handle: "Diesen Nutzernamen kannst du nicht nehmen.",
    handle_taken: "Diesen Nutzernamen gibt es schon.",
    bad_password: "Das Passwort braucht mindestens 8 Zeichen.",
    need_age: "Du musst bestätigen, dass du mindestens 16 Jahre alt bist (oder die Erlaubnis deiner Eltern hast).",
    bad_email: "Das sieht nicht wie eine E-Mail-Adresse aus.",
    email_taken: "Mit dieser E-Mail gibt es schon ein Konto.",
    wrong_login: "Nutzername oder Passwort stimmt nicht.",
    wrong_password: "Das Passwort stimmt nicht.",
    suspended: "Dieses Konto ist gesperrt.",
    bad_name: "Der Name darf 1 bis 50 Zeichen haben.",
    bad_bio: "Die Beschreibung darf höchstens 160 Zeichen haben.",
    bad_location: "Der Ort darf höchstens 30 Zeichen haben.",
    bad_website: "Die Webseite muss mit http:// oder https:// beginnen.",
    dm_closed: "Diese Person nimmt nur Nachrichten von Leuten an, denen sie folgt.",
    bad_reason: "Bitte wähle einen Grund.",
    bad_action: "Das kennt yipi nicht.",
  };

  async function call(method, path, body, form) {
    try {
      const options = { method, credentials: "same-origin", headers: { Accept: "application/json" } };
      if (form) options.body = form;
      else if (body !== undefined) { options.headers["Content-Type"] = "application/json"; options.body = JSON.stringify(body); }
      const response = await fetch(`/api/yipi${path}`, options);
      let data = {};
      try { data = await response.json(); } catch (error) { data = {}; }
      return { ok: response.ok && data.ok === true, status: response.status, data };
    } catch (error) {
      return { ok: false, status: 0, offline: true, data: { error: "network" } };
    }
  }

  window.YipiApi = {
    get: (path) => call("GET", path),
    post: (path, body) => call("POST", path, body === undefined ? {} : body),
    patch: (path, body) => call("PATCH", path, body),
    del: (path) => call("DELETE", path),
    /* A picture upload: `file` is a File or Blob, `fields` more form fields (alt text). */
    upload(file, fields = {}) {
      const form = new FormData();
      form.append("file", file, file.name || "bild");
      for (const [key, value] of Object.entries(fields)) form.append(key, value);
      return call("POST", "/media", undefined, form);
    },
    message: (reply) => MESSAGES[reply && reply.data && reply.data.error] || "Das hat nicht geklappt. Bitte versuche es noch einmal.",
    MESSAGES,
  };
})();
