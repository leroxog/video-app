/* Satürn sign-in and sign-up (yipi-auth.js), made like the start of YouTube and of Duolingo:
   * Somebody who is new first sees the page behind (the shape of Satürn, blurred) and in front of it the terms in short (`consent`), with two buttons: "Akzeptieren" (the terms are
     accepted, the account is made next) and "Anmelden". What was chosen is remembered in the browser (`nex.start`), so the screen comes once.
   * Signing in is two white pages in the round font of Duolingo (Nunito): "Willkommen zurück!" asks for the name (and offers a phone number, e-mail or Google instead), then
     "Bitte gib nun dein Passwort ein!" asks for the password.
   * Signing up is five pages, each with one question: the name, the password (twice), the age (a slider), and "Style verbessern?" with a look at the new account and the choice
     "Ja, gerne!" (a picture and a banner) or "Nein, danke". The account is made after the age; the age itself is not kept.
   Everybody without a picture gets a colour for the picture (with the first letter) and another one for the banner (with the whole name): the same one every time, see `Core.defaultColors`. */
(function () {
  "use strict";

  const Y = window.Yipi;
  const Api = window.YipiApi;
  const Core = window.YipiCore;
  const { h, fill, put, icon, link, toast, avatar } = Y;
  const { passwordField, phoneField, googleStart, GOOGLE_NOTES, formError, showError } = Y.authParts;
  const views = Y.views;

  const START = "nex.start";                                    // "accepted" (the terms) or "login" (somebody who only wants to sign in)
  const startState = () => { try { return localStorage.getItem(START); } catch (error) { return null; } };
  const setStart = (value) => { try { localStorage.setItem(START, value); } catch (error) { /* the screen then comes again, nothing else */ } };

  /* Where a successful sign-in goes: to the address that was asked for (the page to sign in is shown in place of it), or to Home. */
  const afterSignIn = (route) => (route && route.name !== "login" && route.name !== "signup" ? location.pathname + location.search : Y.HOME);

  // ------------------------------------------------------------------------------------------------ the frame of a page
  function legalLinks() {
    return h("p", { class: "au-legal" }, h("a", { href: "/nutzungsbedingungen" }, "Nutzungsbedingungen"), h("a", { href: "/datenschutz" }, "Datenschutz"), h("a", { href: "/impressum" }, "Impressum"));
  }

  /* One white page: a back arrow (and a bar that shows how far the person has come) at the top, the content in the middle. */
  function page(content, { back, progress } = {}) {
    const top = h("div", { class: "au-top" },
      back ? h("button", { class: "au-back", type: "button", "aria-label": "Zurück", onclick: back }, icon("back")) : h("span", { class: "au-back-gap", "aria-hidden": "true" }),
      progress == null ? null : h("div", { class: "au-progress", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(Math.round(progress * 100)), "aria-label": "Fortschritt" },
        h("i", { style: `width:${Math.round(progress * 100)}%` })));
    return [top, h("main", { class: "au-main" }, h("div", { class: "au-column" }, ...content)), legalLinks()];
  }

  const bigField = (input) => h("label", { class: "au-field" }, input);
  const textInput = (attrs) => h("input", { class: "au-input", maxlength: 254, autocapitalize: "none", spellcheck: "false", ...attrs });
  const button = (label, attrs = {}) => h("button", { class: attrs.kind ? "au-btn " + attrs.kind : "au-btn", type: attrs.type || "button", ...(attrs.disabled ? { disabled: true } : {}), ...(attrs.onclick ? { onclick: attrs.onclick } : {}) }, label);

  // ------------------------------------------------------------------------------------------------ the terms in short (and the page behind)
  const TERMS = [
    ["Willkommen bei Satürn", "Satürn ist ein soziales Netzwerk für kurze Beiträge, Fotos, Sticker und Videos, für Chats und Gruppen, für Spiele und Linsen mit der Kamera und für Nex AI, eine KI, die dir weiterhilft. Satürn ist kostenlos, zeigt keine Werbung anderer Firmen und folgt dir nicht durchs Internet."],
    ["Wer Satürn benutzen darf", "Du musst mindestens 13 Jahre alt sein; bis 15 brauchst du die Erlaubnis deiner Eltern. Du hast ein Konto für dich allein und bist für dein Passwort verantwortlich. Ein vergessenes Passwort kann nicht zurückgesetzt werden, weil Satürn keine E-Mails verschickt."],
    ["Was du schreibst und zeigst", "Beiträge, Antworten, Likes, Videos und dein Profil sind öffentlich. Nachrichten sehen nur die Leute im Chat, sie sind aber nicht Ende-zu-Ende verschlüsselt. Deine Inhalte gehören dir; du erlaubst Satürn, sie zu speichern und anderen zu zeigen. Poste nur, was du selbst gemacht hast oder verwenden darfst."],
    ["Die Regeln", "Kein Hass, keine Drohungen, keine Gewalt, nichts Sexuelles mit oder über Kinder, kein Spam, keine Fälschungen und nichts Rechtswidriges. Du kannst Beiträge und Konten melden, Leute blockieren oder stummschalten. Wer die Regeln bricht, kann gesperrt werden."],
    ["Deine Daten", "Satürn speichert nur, was für dein Konto nötig ist: Nutzername, Name, dein Passwort (nur als Prüfwert, nicht lesbar), Beiträge, Nachrichten und Bilder. Dazu kommen ein Cookie, damit du angemeldet bleibst, und Einstellungen in deinem Browser. Dein Alter wird nur geprüft und nicht gespeichert. Es gibt kein Tracking und keine Werbe-Cookies."],
    ["KI, Kamera und Links", "Fragst du Nex AI etwas, geht deine Frage an einen KI-Dienst (Groq, USA). Unter manchen Beiträgen kann ein Fact Check stehen. Kamera und Mikrofon nutzt Satürn nur, wenn du sie erlaubst; Gesichts-Linsen laufen auf deinem Gerät. Zeigt ein Beitrag einen Link, ruft Satürn die Seite ab, um eine Vorschau zu zeigen, und die Seite öffnet sich in einem Fenster von Satürn. Diese Seiten gehören nicht zu Satürn."],
    ["Offizielle Konten", "Satürn-Web und Nex-AI sind die offiziellen Konten von Satürn. Nur dort stehen die Neuigkeiten der Webseite und der KI. Diese Konten lesen keine Nachrichten, und niemand sonst kann so ein Konto bekommen."],
    ["Dein Konto gehört dir", "Du kannst es jederzeit in den Einstellungen löschen. Dann werden deine Beiträge, Nachrichten und Bilder entfernt. Die vollständigen Nutzungsbedingungen und die Datenschutzerklärung findest du unten."],
  ];

  /* What stands behind the question, like the page of YouTube behind its question: the shape of Satürn with its feed, blurred (nothing of it is real). */
  function backdrop() {
    const post = (k) => h("div", { class: "wb-post" },
      h("span", { class: "wb-av", style: `background:${Core.defaultColors(`x${k}`).avatar}` }),
      h("div", { class: "wb-lines" }, h("i", { style: "width:34%" }), h("i", { style: "width:92%" }), h("i", { style: `width:${58 + (k * 13) % 30}%` }),
        k % 2 ? h("b", { class: "wb-pic", style: `background:linear-gradient(135deg, ${Core.defaultColors(`p${k}`).banner}, ${Core.defaultColors(`q${k}`).avatar})` }) : null));
    return h("div", { class: "wb-bg", "aria-hidden": "true" },
      h("div", { class: "wb-bar" }, h("span", { class: "wb-word" }, window.YipiIcons.wordmark ? window.YipiIcons.wordmark() : "Satürn"), h("span", { class: "wb-search" })),
      h("div", { class: "wb-body" },
        h("div", { class: "wb-side" }, ...[1, 2, 3, 4].map(() => h("i"))),
        h("div", { class: "wb-feed" }, post(1), post(2),
          h("div", { class: "wb-shorts" }, ...[1, 2, 3, 4, 5].map((k) => h("b", { style: `background:linear-gradient(160deg, ${Core.defaultColors(`s${k}`).banner}, ${Core.defaultColors(`t${k}`).avatar})` }))),
          post(3), post(4))));
  }

  function consent({ onAccept, onLogin }) {
    const scroll = h("div", { class: "wb-scroll", tabindex: "0", role: "region", "aria-label": "Nutzungsbedingungen in Kurzform" },
      ...TERMS.map(([title, text]) => h("section", {}, h("h2", {}, title), h("p", {}, text))),
      h("p", { class: "wb-end" }, "Mit „Akzeptieren“ stimmst du den ", h("a", { href: "/nutzungsbedingungen", target: "_blank", rel: "noopener" }, "Nutzungsbedingungen"), " und der ",
        h("a", { href: "/datenschutz", target: "_blank", rel: "noopener" }, "Datenschutzerklärung"), " zu und legst danach dein Konto an. Hast du schon eins, tippe auf „Anmelden“."));
    const dialog = h("section", { class: "wb-dialog", role: "dialog", "aria-modal": "true", "aria-labelledby": "wb-title" },
      h("span", { class: "wb-logo" }, window.YipiIcons.wordmark ? window.YipiIcons.wordmark() : "Satürn"),
      h("h1", { id: "wb-title" }, "Bevor du zu Satürn weitergehst"),
      scroll,
      h("div", { class: "wb-actions" }, button("Anmelden", { kind: "plain", onclick: onLogin }), button("Akzeptieren", { kind: "solid", onclick: onAccept })));
    return h("div", { class: "welcome auth-white" }, backdrop(), h("div", { class: "wb-scrim" }), dialog);
  }

  // ------------------------------------------------------------------------------------------------ sign in
  function loginView(route) {
    const target = afterSignIn(route);
    const note = GOOGLE_NOTES[new URLSearchParams(location.search).get("google")] || "";
    const host = h("div", { class: "au auth-white" });
    let method = "name";                                         // "name", "phone" or "email"
    let who = { method: "name", value: "" };
    let shownNote = false;
    const LABELS = { name: ["Nutzername", "Mit Nutzername anmelden", "at"], phone: ["Telefonnummer", "Mit Telefonnummer anmelden", "phone"], email: ["E-Mail", "Mit E-Mail anmelden", "mail"] };
    const show = (content, options) => fill(host, ...page(content, options));

    function nameStep() {
      const error = formError();
      if (note && !shownNote) { showError(error, note); shownNote = true; }
      const phone = method === "phone" ? phoneField() : null;
      const name = method === "phone" ? null : textInput({ type: method === "email" ? "email" : "text", autocomplete: method === "email" ? "email" : "username", "aria-label": method === "email" ? "E-Mail-Adresse" : "Name",
        placeholder: method === "email" ? "du@beispiel.de" : "Name", required: true });
      if (name) name.value = method === who.method ? who.value : "";                    // (back from the password: what was typed is still there)
      const next = () => {
        const value = phone ? phone.value() : name.value.trim();
        if (!value) { showError(error, method === "phone" ? "Gib deine Telefonnummer ein." : method === "email" ? "Gib deine E-Mail ein." : "Gib deinen Namen ein."); return; }
        who = { method, value };
        showError(error, "");
        passwordStep();
      };
      const form = h("form", { class: "au-form", novalidate: true, onsubmit: (event) => { event.preventDefault(); next(); } }, phone ? phone.element : bigField(name), error, button("Weiter", { type: "submit", kind: "solid" }));
      const others = Object.keys(LABELS).filter((key) => key !== method).map((key) => h("button", { class: "au-alt", type: "button", onclick: () => { method = key; nameStep(); } }, icon(LABELS[key][2]), h("span", {}, LABELS[key][1])));
      show([h("h1", { class: "au-title" }, "Willkommen zurück!"), h("p", { class: "au-sub" }, "Bitte gib deinen Namen ein"), form,
        h("div", { class: "au-or" }, h("span", {}, "oder")),
        h("div", { class: "au-alts" }, ...others, h("button", { class: "au-alt", type: "button", onclick: googleStart }, icon("google"), h("span", {}, "Mit Google anmelden"))),
        h("p", { class: "au-switch" }, "Noch kein Konto? ", link("/i/signup", {}, "Registrieren"))]);
      setTimeout(() => (phone ? phone.input : name).focus(), 0);
    }

    function passwordStep() {
      const error = formError();
      const password = passwordField("Passwort", "current-password");
      const submit = button("Anmelden", { type: "submit", kind: "solid" });
      const form = h("form", { class: "au-form", novalidate: true, onsubmit: async (event) => {
        event.preventDefault();
        showError(error, "");
        if (!password.input.value) { showError(error, "Gib dein Passwort ein."); return; }
        submit.disabled = true;
        const reply = await Api.post("/login", { login: who.value, password: password.input.value });
        submit.disabled = false;
        if (!reply.ok) { showError(error, Api.message(reply)); return; }
        Y.setMe(reply.data.me);
        Y.navigate(target, { replace: true });
      } }, password.element, error, submit);
      show([h("h1", { class: "au-title" }, "Bitte gib nun dein Passwort ein!"), h("p", { class: "au-sub" }, who.method === "name" ? `@${who.value.replace(/^@/, "")}` : who.value), form], { back: nameStep });
      setTimeout(() => password.input.focus(), 0);
    }

    nameStep();
    return { element: host, title: "Anmelden", bare: true };
  }

  // ------------------------------------------------------------------------------------------------ sign up
  /* A look at the new account: banner (with the whole name when there is no picture), picture and name. */
  function accountPreview(user) {
    const colors = Core.defaultColors(user.handle);
    return h("div", { class: "acc-preview" },
      h("div", { class: "ap-banner", style: `--banner:${colors.banner}` }, user.banner ? h("img", { src: user.banner, alt: "" }) : h("span", { class: "ap-name" }, user.name)),
      h("div", { class: "ap-face" }, avatar(user, "xl")),
      h("div", { class: "ap-text" }, h("b", {}, user.name), h("span", {}, `@${user.handle}`)));
  }

  function signupView(route) {
    const google = !!route.google;
    const host = h("div", { class: "au auth-white" });
    const answers = { handle: "", password: "", age: 18, parents: false, name: "" };
    const flow = google ? ["name", "age", "style"] : ["name", "password", "age", "style"];
    const show = (step, content, options = {}) => fill(host, ...page(content, { progress: (flow.indexOf(step) + 1) / (flow.length + 1), ...options }));
    const before = (step) => { const at = flow.indexOf(step); return at > 0 ? () => steps[flow[at - 1]]() : () => Y.navigate("/i/login"); };

    function nameStep() {
      const handle = textInput({ autocomplete: "username", "aria-label": "Name", maxlength: 15, placeholder: "Name", required: true, "aria-describedby": "au-handle-state" });
      handle.value = answers.handle;
      const state = h("small", { class: "au-hint", id: "au-handle-state", "aria-live": "polite" }, "3 bis 15 Zeichen: Buchstaben, Zahlen und _.");
      const next = button("Weiter", { type: "submit", kind: "solid", disabled: true });
      let timer = null;
      let token = 0;
      let free = false;
      if (google) Api.get("/google/pending").then((reply) => { if (!reply.ok) { toast(Api.message(reply)); Y.navigate("/i/login", { replace: true }); return; } answers.name = reply.data.name || ""; });
      function check() {
        clearTimeout(timer);
        free = false;
        next.disabled = true;
        const value = handle.value;
        state.className = "au-hint";
        if (!value) { state.textContent = "3 bis 15 Zeichen: Buchstaben, Zahlen und _."; return; }
        if (!/^[A-Za-z0-9_]{3,15}$/.test(value)) { state.textContent = "3 bis 15 Zeichen: Buchstaben, Zahlen und _."; state.classList.add("bad"); return; }
        const mine = ++token;
        state.textContent = "Wird geprüft …";
        timer = setTimeout(async () => {
          const reply = await Api.get(Y.qs("/handle", { handle: value }));
          if (mine !== token || !reply.ok) return;
          free = !!reply.data.available;
          next.disabled = !free;
          state.className = `au-hint ${free ? "good" : "bad"}`;
          state.textContent = free ? `@${value} ist frei.` : reply.data.reason === "reserved" ? "Diesen Namen kannst du nicht nehmen." : "Diesen Namen gibt es schon.";
        }, 350);
      }
      handle.addEventListener("input", check);
      const form = h("form", { class: "au-form", novalidate: true, onsubmit: (event) => {
        event.preventDefault();
        if (!free) return;
        answers.handle = handle.value.trim();
        steps[flow[flow.indexOf("name") + 1]]();
      } }, bigField(handle), state, next);
      show("name", [h("h1", { class: "au-title" }, "Wie willst du heißen?"), form, h("p", { class: "au-switch" }, "Schon dabei? ", link("/i/login", {}, "Anmelden"))], { back: before("name") });
      setTimeout(() => { handle.focus(); if (handle.value) check(); }, 0);
    }

    function passwordStep() {
      const first = passwordField("Passwort", "new-password");
      const second = passwordField("Passwort noch einmal", "new-password");
      first.input.value = answers.password;
      const error = formError();
      const next = button("Weiter", { type: "submit", kind: "solid", disabled: true });
      const update = () => {
        const ok = first.input.value.length >= 8 && first.input.value === second.input.value;
        next.disabled = !ok;
        showError(error, first.input.value.length >= 8 && second.input.value && first.input.value !== second.input.value ? "Die beiden Passwörter sind nicht gleich." : "");
      };
      first.input.addEventListener("input", update);
      second.input.addEventListener("input", update);
      const form = h("form", { class: "au-form", novalidate: true, onsubmit: (event) => {
        event.preventDefault();
        update();
        if (next.disabled) return;
        answers.password = first.input.value;
        ageStep();
      } }, first.element, h("small", { class: "au-hint" }, "Mindestens 8 Zeichen."),
      h("p", { class: "au-small" }, "Wir bitten dich für deine eigene Account Sicherheit dein Passwort erneut einzugeben"),
      second.element, error, next);
      show("password", [h("h1", { class: "au-title" }, "Gib bitte dein zukünftiges Passwort ein!"), form, h("p", { class: "au-note" }, "Ein vergessenes Passwort kann nicht zurückgesetzt werden.")], { back: before("password") });
      setTimeout(() => first.input.focus(), 0);
    }

    function ageStep() {
      const number = h("div", { class: "au-age", "aria-live": "polite" }, String(answers.age));
      const range = h("input", { class: "au-range", type: "range", min: "5", max: "100", step: "1", value: String(answers.age), "aria-label": "Dein Alter in Jahren" });
      const line = h("p", { class: "au-small", "aria-live": "polite" });
      const parents = h("input", { type: "checkbox", id: "au-parents" });
      parents.checked = answers.parents;
      const parentsBox = h("label", { class: "au-check", hidden: true }, parents, h("span", {}, "Meine Eltern erlauben mir, Satürn zu benutzen."));
      const error = formError();
      const submit = button("Konto erstellen", { type: "submit", kind: "solid" });
      function update() {
        answers.age = Number(range.value);
        answers.parents = parents.checked;
        number.textContent = String(answers.age);
        range.style.setProperty("--fill", `${((answers.age - 5) / 95) * 100}%`);
        parentsBox.hidden = !(answers.age >= 13 && answers.age < 16);
        line.textContent = answers.age < 13 ? "Satürn gibt es erst ab 13 Jahren." : "";
        line.className = `au-small${answers.age < 13 ? " bad" : ""}`;
        submit.disabled = answers.age < 13 || (answers.age < 16 && !parents.checked);
      }
      range.addEventListener("input", update);
      parents.addEventListener("change", update);
      const form = h("form", { class: "au-form", novalidate: true, onsubmit: async (event) => {
        event.preventDefault();
        update();
        if (submit.disabled) return;
        showError(error, "");
        submit.disabled = true;
        const body = { handle: answers.handle, name: google && answers.name ? answers.name : answers.handle, age: answers.age, parents: answers.parents };
        if (google) body.google = true; else body.password = answers.password;
        const reply = await Api.post("/signup", body);
        if (!reply.ok) { submit.disabled = false; showError(error, Api.message(reply)); return; }
        Y.setMe(reply.data.me);
        toast("Willkommen bei Satürn!");
        styleStep();
      } }, number, range, line, parentsBox, error, submit);
      show("age", [h("h1", { class: "au-title" }, "Wie alt bist du???"), form], { back: before("age") });
      update();
    }

    /* "Style verbessern?": a look at the account, and the choice between a picture and a banner of one's own or leaving it as it is. */
    function styleStep() {
      const me = Y.me;
      const yes = h("button", { class: "try-btn au-yes", type: "button", onclick: picturesStep }, "Ja, gerne!");
      const no = button("Nein, danke", { kind: "plain", onclick: () => Y.navigate(Y.HOME, { replace: true }) });
      show("style", [h("h1", { class: "au-title" }, "Style verbessern?"), h("p", { class: "au-sub small" }, "Dein Account sieht noch etwas leer aus willst du ihn verbessern?"), accountPreview(me), h("div", { class: "au-choice" }, no, yes)]);
    }

    /* The picture and the banner of one's own (both optional). */
    function picturesStep() {
      const me = Y.me;
      const draft = { avatar: null, banner: null };
      const banner = h("div", { class: "edit-banner" });
      const face = h("div", { class: "edit-avatar" });
      const picker = h("input", { type: "file", accept: "image/jpeg,image/png,image/gif,image/webp", hidden: true, "aria-hidden": "true", tabindex: "-1" });
      const error = formError();
      const next = button("Speichern und loslegen", { kind: "solid", disabled: true });
      let picking = null;
      const finish = () => { for (const kind of ["avatar", "banner"]) if (draft[kind]) URL.revokeObjectURL(draft[kind].url); Y.navigate(Y.HOME, { replace: true }); };
      function drawPics() {
        banner.style.setProperty("--banner", Core.defaultColors(me.handle).banner);
        fill(banner, draft.banner ? h("img", { src: draft.banner.url, alt: "" }) : h("span", { class: "edit-hint" }, "Titelbild"),
          h("div", { class: "edit-tools" }, h("button", { class: "icon-btn glass", type: "button", "aria-label": "Titelbild wählen", onclick: () => { picking = "banner"; picker.click(); } }, icon("image"))));
        fill(face, avatar({ ...me, avatar: draft.avatar ? draft.avatar.url : null }, "xl"),
          h("button", { class: "icon-btn glass", type: "button", "aria-label": "Profilbild wählen", onclick: () => { picking = "avatar"; picker.click(); } }, icon("camera")));
        next.disabled = !draft.avatar && !draft.banner;
      }
      picker.addEventListener("change", async () => {
        const file = picker.files[0];
        picker.value = "";
        if (!file || !picking) return;
        if (!/^image\/(jpeg|png|gif|webp)$/.test(file.type)) { showError(error, "Das ist kein Foto, das Satürn kennt (JPEG, PNG, GIF oder WebP)."); return; }
        showError(error, "");
        try {
          const blob = await Y.prepareImage(file, { crop: picking === "avatar" ? { width: 400, height: 400 } : { width: 1500, height: 500 } });
          if (draft[picking]) URL.revokeObjectURL(draft[picking].url);
          draft[picking] = { blob, url: URL.createObjectURL(blob) };
          drawPics();
        } catch (problem) { showError(error, "Dieses Bild konnte nicht gelesen werden."); }
      });
      next.addEventListener("click", async () => {
        next.disabled = true;
        const payload = {};
        for (const kind of ["avatar", "banner"]) {
          if (!draft[kind]) continue;
          const up = await Api.upload(draft[kind].blob, { alt: "" });
          if (!up.ok) { showError(error, Api.message(up)); next.disabled = false; return; }
          payload[kind] = up.data.media.id;
        }
        const reply = await Api.patch("/profile", payload);
        if (!reply.ok) { showError(error, Api.message(reply)); next.disabled = false; return; }
        Y.setMe({ ...Y.me, ...reply.data.me });
        finish();
      });
      drawPics();
      fill(host, ...page([h("h1", { class: "au-title" }, "Zeig dich"), h("p", { class: "au-sub small" }, "Ein Titelbild und ein Profilbild machen dein Profil persönlicher. Das geht auch später."),
        h("div", { class: "edit-profile signup-pics" }, banner, face), picker, error, next, button("Überspringen", { kind: "plain", onclick: finish })], { progress: 1, back: styleStep }));
    }

    const steps = { name: nameStep, password: passwordStep, age: ageStep, style: styleStep };
    nameStep();
    return { element: host, title: "Registrieren", bare: true };
  }

  // ------------------------------------------------------------------------------------------------ the two views
  /* A page that only changes its content in place (so that "Akzeptieren" and "Anmelden" do not need an address of their own). */
  function swapper(make) {
    const holder = h("div", { class: "au-holder" });
    const draw = () => fill(holder, make(draw));
    draw();
    return holder;
  }

  views.login = function login(route) {
    if (Y.me) { setTimeout(() => Y.navigate(Y.HOME, { replace: true }), 0); return { element: h("div"), title: "Satürn" }; }
    const holder = swapper((redraw) => (startState() ? loginView(route).element : consent({
      onAccept: () => { setStart("accepted"); Y.navigate("/i/signup"); },
      onLogin: () => { setStart("login"); redraw(); },
    })));
    return { element: holder, title: "Anmelden", bare: true };
  };

  views.signup = function signup(route) {
    if (Y.me) { setTimeout(() => Y.navigate(Y.HOME, { replace: true }), 0); return { element: h("div"), title: "Satürn" }; }
    const holder = swapper((redraw) => (startState() === "accepted" || route.google ? signupView(route).element : consent({
      onAccept: () => { setStart("accepted"); redraw(); },
      onLogin: () => { setStart("login"); Y.navigate("/i/login"); },
    })));
    return { element: holder, title: "Registrieren", bare: true };
  };
})();
