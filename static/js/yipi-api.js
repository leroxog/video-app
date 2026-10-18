/* Pulse api (the file keeps the name yipi-api.js): the calls to the server (/api/yipi/...). Every call answers {ok, status, data}; with no connection it answers
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
    empty: "Schreib etwas oder füge ein Foto oder GIF hinzu.",
    bad_text: "Das ist kein gültiger Text.",
    duplicate: "Das hast du gerade schon gepostet.",
    bad_media: "Mit den Bildern stimmt etwas nicht.",
    bad_image: "Das ist kein Foto, das Pulse kennt (JPEG, PNG, GIF oder WebP).",
    too_big: "Das Foto ist zu groß (höchstens 5 MB).",
    no_file: "Es wurde keine Datei gesendet.",
    no_video: "In ein GIF der Bibliothek gehört kein Video.",
    bad_video: "Dieses Video kann nicht abgespielt werden. Pulse nimmt MP4-, MOV- und WebM-Videos.",
    video_too_big: "Das Video ist zu groß (höchstens 25 MB).",
    video_alone: "Ein Video steht allein: ohne Fotos oder GIFs im selben Beitrag.",
    video_top: "Ein Video gehört in einen eigenen Beitrag, nicht in eine Antwort oder ein Zitat.",
    gif_alone: "Ein GIF steht allein: entweder ein GIF, ein Video oder bis zu 3 Fotos.",
    bad_gif: "Das ist kein gültiges GIF (oder es hat zu viele Bilder oder Pixel).",
    gif_too_big: "Das GIF ist zu groß (höchstens 3 MB).",
    gif_title_long: "Der Name eines GIFs darf höchstens 40 Zeichen haben.",
    gif_gone: "Dieses GIF gibt es nicht mehr.",
    reply_gone: "Der Beitrag, auf den du antworten willst, ist nicht mehr da.",
    quote_gone: "Der Beitrag, den du zitieren willst, ist nicht mehr da.",
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
    accept_first: "Nimm die Anfrage zuerst an, dann kannst du antworten.",
    request_pending: "Deine Nachricht ist eine Anfrage. Du kannst weiterschreiben, sobald die Person sie annimmt.",
    bad_reason: "Bitte wähle einen Grund.",
    bad_action: "Das kennt Pulse nicht.",
    bad_poll: "Mit der Umfrage stimmt etwas nicht: sie braucht zwei bis vier verschiedene Antworten.",
    poll_text: "Schreib zur Umfrage eine Frage.",
    poll_closed: "Diese Umfrage ist schon beendet.",
    already_voted: "Du hast bei dieser Umfrage schon abgestimmt.",
    bad_option: "Diese Antwort gibt es nicht.",
    not_friends: "Das geht nur mit Freunden: ihr müsst euch gegenseitig folgen.",
    bad_group_name: "Der Name der Gruppe darf 1 bis 40 Zeichen haben.",
    group_full: "Die Gruppe ist voll (höchstens 20 Personen).",
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
    /* A GIF for the library: `file` is a Blob of type image/gif, `fields` more form fields (the title). */
    uploadGif(file, fields = {}) {
      const form = new FormData();
      form.append("file", file, file.name || "pulse.gif");
      for (const [key, value] of Object.entries(fields)) form.append(key, value);
      return call("POST", "/gifs", undefined, form);
    },
    message: (reply) => MESSAGES[reply && reply.data && reply.data.error] || "Das hat nicht geklappt. Bitte versuche es noch einmal.",
    MESSAGES,
  };
})();
