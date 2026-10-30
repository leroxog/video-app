/* Nex api (the file keeps the name yipi-api.js): the calls to the server (/api/yipi/...). Every call answers {ok, status, data}; with no connection it answers
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
    ai_account: "Dieses Konto wird von einer KI betrieben und liest keine Nachrichten.",
    ai_failed: "Die KI hat gerade kein gutes Ergebnis hinbekommen. Probier es noch einmal.",
    official_account: "Das ist ein offizielles Konto von Nex. Es liest keine Nachrichten.",
    bad_link: "Das ist kein Link, den Nex zeigen kann.",
    link_blocked: "Diesen Link kann Nex nicht öffnen.",
    link_unreachable: "Diese Seite antwortet gerade nicht.",
    not_allowed: "Das passt hier nicht. Probier etwas anderes.",
    bad_level: "Mit deinem Level stimmt etwas nicht. Probier es noch einmal.",
    bad_code: "Mit dem Code stimmt etwas nicht.",
    self: "Das geht bei dir selbst nicht.",
    bad_request: "Das hat nicht geklappt.",
    too_long: "Das ist zu lang.",
    empty: "Schreib etwas oder füge ein Foto oder GIF hinzu.",
    bad_text: "Das ist kein gültiger Text.",
    duplicate: "Das hast du gerade schon gepostet.",
    bad_media: "Mit den Bildern stimmt etwas nicht.",
    too_many_stories: "Du hast schon 30 Stories. Lösche eine oder warte, bis eine abläuft.",
    bad_image: "Das ist kein Foto, das Nex kennt (JPEG, PNG, GIF oder WebP).",
    too_big: "Das Foto ist zu groß (höchstens 5 MB).",
    no_file: "Es wurde keine Datei gesendet.",
    no_video: "In ein GIF der Bibliothek gehört kein Video.",
    bad_video: "Dieses Video kann nicht abgespielt werden. Nex nimmt MP4-, MOV- und WebM-Videos.",
    video_too_big: "Das Video ist zu groß (höchstens 25 MB).",
    video_too_long: "Das Video ist zu lang (höchstens 30 Sekunden).",
    bad_attachment: "Diese Datei kann nicht gesendet werden (Foto, Video, PDF, Text oder Office-Dokument).",
    attachment_too_big: "Die Datei ist zu groß (höchstens 15 MB, Fotos 8 MB, Videos 25 MB).",
    doc_empty: "In diesem Dokument steht kein Text, den Nex lesen kann.",
    doc_too_big: "Das Dokument ist zu groß.",
    doc_encrypted: "Das PDF ist geschützt, Nex kann es nicht öffnen.",
    doc_no_pdf_reader: "PDFs kann Nex gerade nicht lesen.",
    doc_bad: "Dieses Dokument kann Nex nicht lesen (PDF, Text, Word, Excel, PowerPoint oder OpenDocument).",
    video_alone: "Ein Video steht allein: ohne Fotos oder GIFs im selben Beitrag.",
    video_top: "Ein Video gehört in einen eigenen Beitrag, nicht in eine Antwort oder ein Zitat.",
    gif_alone: "Ein GIF steht allein: entweder ein GIF, ein Video oder bis zu 3 Fotos.",
    bad_gif: "Das ist kein gültiges GIF (oder es hat zu viele Bilder oder Pixel).",
    gif_too_big: "Das GIF ist zu groß (höchstens 3 MB).",
    gif_title_long: "Der Name eines GIFs darf höchstens 40 Zeichen haben.",
    gif_gone: "Dieses GIF gibt es nicht mehr.",
    r2_off: "R2 ist noch nicht eingerichtet: die vier R2-Variablen fehlen bei Railway.",
    not_postgres: "Aufräumen geht nur mit der PostgreSQL-Datenbank von Railway.",
    reply_gone: "Der Beitrag, auf den du antworten willst, ist nicht mehr da.",
    quote_gone: "Der Beitrag, den du zitieren willst, ist nicht mehr da.",
    bad_handle: "Der Nutzername darf 3 bis 15 Zeichen haben: Buchstaben, Zahlen und _.",
    reserved_handle: "Diesen Nutzernamen kannst du nicht nehmen.",
    handle_taken: "Diesen Nutzernamen gibt es schon.",
    bad_password: "Das Passwort braucht mindestens 8 Zeichen.",
    need_age: "Du musst bestätigen, dass du mindestens 16 Jahre alt bist (oder die Erlaubnis deiner Eltern hast).",
    bad_birthday: "Dieses Datum gibt es nicht. Prüfe Tag, Monat und Jahr.",
    too_young: "Nex ist erst ab 13 Jahren. Komm gern später wieder.",
    need_parents: "Unter 16 geht Nex nur mit der Erlaubnis deiner Eltern.",
    bad_phone: "Das sieht nicht wie eine Telefonnummer aus. Schreib sie mit Vorwahl, zum Beispiel 151 12345678.",
    phone_taken: "Mit dieser Telefonnummer gibt es schon ein Konto.",
    google_expired: "Die Anmeldung mit Google ist abgelaufen. Tippe noch einmal auf „Mit Google“.",
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
    bad_action: "Das kennt Nex nicht.",
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

  /* The same call as `call("POST", ...)` with a form, made with XMLHttpRequest because only that reports how far the upload has come. */
  function sendWithProgress(path, form, onProgress) {
    return new Promise((resolve) => {
      const request = new XMLHttpRequest();
      request.open("POST", `/api/yipi${path}`);
      request.withCredentials = true;
      request.setRequestHeader("Accept", "application/json");
      request.upload.addEventListener("progress", (event) => { if (event.lengthComputable && event.total) onProgress(event.loaded / event.total); });
      request.addEventListener("load", () => {
        let data = {};
        try { data = JSON.parse(request.responseText); } catch (error) { data = {}; }
        resolve({ ok: request.status >= 200 && request.status < 300 && data.ok === true, status: request.status, data });
      });
      request.addEventListener("error", () => resolve({ ok: false, status: 0, offline: true, data: { error: "network" } }));
      request.addEventListener("abort", () => resolve({ ok: false, status: 0, offline: true, data: { error: "network" } }));
      request.send(form);
    });
  }

  window.YipiApi = {
    get: (path) => call("GET", path),
    post: (path, body) => call("POST", path, body === undefined ? {} : body),
    patch: (path, body) => call("PATCH", path, body),
    put: (path, body) => call("PUT", path, body),
    del: (path) => call("DELETE", path),
    /* A picture or video upload: `file` is a File or Blob, `fields` more form fields (alt text), `onProgress(fraction)` is called while the bytes go
       out (a video can take a while). */
    upload(file, fields = {}, onProgress = null) {
      const form = new FormData();
      form.append("file", file, file.name || "bild");
      for (const [key, value] of Object.entries(fields)) form.append(key, value);
      if (!onProgress || typeof XMLHttpRequest === "undefined") return call("POST", "/media", undefined, form);
      return sendWithProgress("/media", form, onProgress);
    },
    /* A document for Nex to read: answers {ok, data: {name, text, cut}} (nothing is stored). */
    readDocument(file) {
      const form = new FormData();
      form.append("file", file, file.name || "dokument");
      return call("POST", "/nex/read", undefined, form);
    },
    /* Any other private file (a document, a photo or video in a chat): same as upload, answers {ok, data: {media}}. */
    attach(file, onProgress = null) {
      const form = new FormData();
      form.append("file", file, file.name || "datei");
      if (!onProgress || typeof XMLHttpRequest === "undefined") return call("POST", "/attachments", undefined, form);
      return sendWithProgress("/attachments", form, onProgress);
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
