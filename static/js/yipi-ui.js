/* yipi ui: the small building blocks of the page -- making elements, pictures of people, text with links, dialogs, menus,
   messages ("toasts"), lists that load more while you scroll, and the picture viewer. Text that comes from people is only
   ever put on the page as text (textContent or text nodes); links are built here, never taken over as HTML. */
(function () {
  "use strict";

  const Core = window.YipiCore;
  const Icons = window.YipiIcons;
  const Yipi = (window.Yipi = { me: null, HOME: Core.HOME, navigate() {}, requireLogin() {} });

  // ---------------------------------------------------------------------------------------- elements
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value == null || value === false) continue;
      if (key === "class") el.className = value;
      else if (key === "style") el.style.cssText = value;
      else if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
      else el.setAttribute(key, value === true ? "" : value);
    }
    append(el, children);
    return el;
  }

  function append(el, children) {
    for (const child of children) {
      if (child == null || child === false) continue;
      if (Array.isArray(child)) append(el, child);
      else el.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
  }

  /* Replace or add the children of an element. Unlike the browser's own append(), nothing (null, false) is skipped instead of
     written as the word "null", and lists of elements are flattened. */
  function fill(el, ...children) {
    el.replaceChildren();
    append(el, children);
    return el;
  }
  function put(el, ...children) {
    append(el, children);
    return el;
  }

  const icon = (name) => Icons.icon(name);
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /* An address that stays inside the page: a click goes through the router (a click with a modifier key still opens a new tab). */
  function link(href, attrs, ...children) {
    return h("a", { href, ...attrs, onclick: (event) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      Yipi.navigate(href);
    } }, ...children);
  }

  // ------------------------------------------------------------------------------------------ people
  /* A round picture; without a picture a coloured disc with the first letters. */
  function avatar(user, size = "md") {
    const wrap = h("span", { class: `avatar ${size}`, "aria-hidden": "true" });
    if (user && user.avatar) {
      wrap.append(h("img", { src: user.avatar, alt: "", loading: "lazy", decoding: "async" }));
    } else {
      wrap.classList.add("letters");
      wrap.style.setProperty("--hue", String(Core.avatarHue((user && user.handle) || "?")));
      wrap.append(Core.initials(user && user.name, user && user.handle));
    }
    return wrap;
  }

  // ---------------------------------------------------------------------------------------- text
  /* A text with its links, mentions and hashtags (line breaks are kept by the style, not by markup). */
  function richText(text) {
    const out = document.createDocumentFragment();
    for (const piece of Core.tokenize(text)) {
      if (piece.type === "text") out.append(piece.text);
      else if (piece.type === "mention") out.append(link(`/${piece.handle}`, { class: "tok" }, piece.text));
      else if (piece.type === "hashtag") out.append(link(`/search?q=${encodeURIComponent(`#${piece.tag}`)}`, { class: "tok" }, piece.text));
      else out.append(h("a", { class: "tok", href: piece.href, target: "_blank", rel: "noopener noreferrer nofollow ugc" }, piece.text));
    }
    return out;
  }

  /* A time that keeps itself up to date ("5 Min." becomes "6 Min."). */
  const clocks = new Set();
  function timeEl(iso, full) {
    const el = h("time", { datetime: iso, title: Core.fullTime(iso) });
    const draw = () => { el.textContent = full ? Core.fullTime(iso) : Core.relativeTime(iso); };
    draw();
    el._draw = draw;
    clocks.add(el);
    return el;
  }
  setInterval(() => {
    for (const el of clocks) {
      if (!el.isConnected) clocks.delete(el);
      else el._draw();
    }
  }, 30000);

  // ---------------------------------------------------------------------------------------- toast
  let toastTimer = null;
  function toast(message, action) {
    document.querySelector(".toast")?.remove();
    const el = h("div", { class: "toast", role: "status" }, h("span", {}, message), action ? h("button", { class: "toast-action", type: "button", onclick: () => { el.remove(); action.run(); } }, action.label) : null);
    document.body.append(el);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.remove(), action ? 6000 : 3200);
  }

  // --------------------------------------------------------------------------------------- dialogs
  const dialogs = [];

  function trapTab(box, event) {
    if (event.key !== "Tab") return;
    const items = [...box.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter((el) => el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  /* A dialog over the page. `body` is an element, `actions` are buttons: [{label, kind: "primary" | "danger" | "ghost", run}] (a run
     that returns false keeps the dialog open). Returns {close, box}. */
  function dialog({ title, body, actions = [], wide = false, bare = false, label, onClose, initialFocus }) {
    const opener = document.activeElement;
    const back = h("div", { class: "dialog-back" });
    const box = h("div", { class: `dialog${wide ? " wide" : ""}${bare ? " bare" : ""}`, role: "dialog", "aria-modal": "true", "aria-label": label || title || "Dialog" });
    let closed = false;
    const entry = { close() {
      if (closed) return;
      closed = true;
      dialogs.splice(dialogs.indexOf(entry), 1);
      back.remove();
      if (!dialogs.length) document.body.classList.remove("modal-open");
      if (opener && opener.isConnected) opener.focus();
      if (onClose) onClose();
    }, box };
    if (!bare) {
      box.append(h("div", { class: "dialog-top" },
        h("button", { class: "icon-btn", type: "button", "aria-label": "Schließen", onclick: () => entry.close() }, icon("close")),
        title ? h("h2", {}, title) : null));
    }
    box.append(h("div", { class: "dialog-body" }, body));
    if (actions.length) {
      box.append(h("div", { class: "dialog-actions" }, actions.map((a) => h("button", { class: `btn ${a.kind || "ghost"}`, type: "button", onclick: async (event) => {
        const button = event.currentTarget;
        button.disabled = true;
        const result = a.run ? await a.run() : undefined;
        button.disabled = false;
        if (result !== false) entry.close();
      } }, a.label))));
    }
    back.append(box);
    back.addEventListener("pointerdown", (event) => { back._down = event.target === back; });
    back.addEventListener("click", (event) => { if (event.target === back && back._down) entry.close(); });
    back.addEventListener("keydown", (event) => trapTab(box, event));
    document.body.append(back);
    document.body.classList.add("modal-open");
    dialogs.push(entry);
    (initialFocus || box.querySelector("textarea, input:not([type=file])") || box.querySelector(".dialog-actions .btn.primary, .dialog-actions .btn") || box.querySelector(".icon-btn"))?.focus();
    return entry;
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && dialogs.length && !document.querySelector(".menu")) {
      event.stopPropagation();
      dialogs[dialogs.length - 1].close();
    }
  });

  /* A question with two answers. Resolves to true or false. */
  function confirmBox({ title, text, yes = "OK", danger = false, no = "Abbrechen" }) {
    return new Promise((resolve) => {
      let answered = false;
      const done = (value) => { answered = true; resolve(value); };
      dialog({ title, label: title, body: h("p", { class: "dialog-text" }, text), actions: [
        { label: yes, kind: danger ? "danger" : "primary", run: () => done(true) },
        { label: no, kind: "ghost", run: () => done(false) },
      ], onClose: () => { if (!answered) resolve(false); } });
    });
  }

  // ------------------------------------------------------------------------------------------ menus
  /* Puts `el` (already classed "menu") next to a button; it closes on a click outside, Escape, scrolling and resizing. */
  function floating(anchor, el, { arrows = true } = {}) {
    document.querySelector(".menu")?.remove();
    document.body.append(el);
    const box = anchor.getBoundingClientRect();
    const width = el.offsetWidth;
    const height = el.offsetHeight;
    const left = Math.max(8, Math.min(window.innerWidth - width - 8, box.right - width));
    const top = box.bottom + height + 8 > window.innerHeight ? Math.max(8, box.top - height - 4) : box.bottom + 4;
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    const close = () => {
      el.remove();
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", keys, true);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      if (anchor.isConnected) anchor.focus();
    };
    const outside = (event) => { if (!el.contains(event.target)) close(); };
    const keys = (event) => {
      if (event.key === "Escape") { event.stopPropagation(); close(); }
      if (!arrows) return;
      const buttons = [...el.querySelectorAll("button")];
      const at = buttons.indexOf(document.activeElement);
      if (event.key === "ArrowDown") { event.preventDefault(); buttons[(at + 1) % buttons.length].focus(); }
      if (event.key === "ArrowUp") { event.preventDefault(); buttons[(at - 1 + buttons.length) % buttons.length].focus(); }
    };
    setTimeout(() => {
      document.addEventListener("pointerdown", outside, true);
      document.addEventListener("keydown", keys, true);
      window.addEventListener("scroll", close, true);
      window.addEventListener("resize", close);
    }, 0);
    el.querySelector("button")?.focus();
    return { close, element: el };
  }

  /* A little menu next to a button. Items: [{label, icon, danger, run}] (null entries are skipped). */
  function menu(anchor, items) {
    let entry;
    const el = h("div", { class: "menu", role: "menu" }, items.filter(Boolean).map((item) => h("button", { class: `menu-item${item.danger ? " danger" : ""}`, type: "button", role: "menuitem", onclick: () => { entry.close(); item.run(); } }, item.icon ? icon(item.icon) : null, h("span", {}, item.label))));
    entry = floating(anchor, el);
    return entry;
  }

  // ------------------------------------------------------------------------------------------ tabs
  function tabs(entries, active, onSelect, label) {
    const bar = h("div", { class: "tabs", role: "tablist", "aria-label": label || "Ansicht" });
    for (const [id, text] of entries) {
      bar.append(h("button", { class: `tab${id === active ? " on" : ""}`, type: "button", role: "tab", "aria-selected": String(id === active), onclick: () => onSelect(id) }, h("span", {}, text)));
    }
    bar.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
      const buttons = [...bar.querySelectorAll(".tab")];
      const at = buttons.indexOf(document.activeElement);
      if (at < 0) return;
      buttons[(at + (event.key === "ArrowRight" ? 1 : buttons.length - 1)) % buttons.length].focus();
    });
    return bar;
  }

  // ------------------------------------------------------------------------------------------ lists
  function skeleton(count = 3) {
    return h("div", { class: "skeletons", "aria-hidden": "true" }, Array.from({ length: count }, () => h("div", { class: "skeleton" },
      h("span", { class: "sk-av" }), h("div", { class: "sk-lines" }, h("i", { style: "width:40%" }), h("i", { style: "width:92%" }), h("i", { style: "width:70%" })))));
  }

  /* A list that loads a page, and the next one when the end comes near.
       load(cursor) -> {ok, items, next, data}; render(item) -> element; empty: element for "nothing here".
     Returns {reload(), prepend(el), destroy(), element}. */
  function pager({ load, render, empty, errorText = "Das konnte nicht geladen werden.", first }) {
    const list = h("div", { class: "list" });
    const foot = h("div", { class: "list-foot" });
    const element = h("div", { class: "pager" }, list, foot);
    let next = null;
    let busy = false;
    let finished = false;
    let dead = false;
    let observer = null;
    let count = 0;
    let shownEmpty = null;

    async function more(reset) {
      if (busy || dead || (finished && !reset)) return;
      busy = true;
      if (reset) { list.replaceChildren(); next = null; finished = false; count = 0; shownEmpty = null; }
      foot.replaceChildren(skeleton(count ? 1 : 3));
      const reply = await load(next);
      busy = false;
      if (dead) return;
      foot.replaceChildren();
      if (!reply.ok) {
        foot.append(h("div", { class: "list-error" }, h("p", {}, reply.offline ? window.YipiApi.MESSAGES.network : errorText),
          h("button", { class: "btn ghost", type: "button", onclick: () => more(false) }, "Noch einmal versuchen")));
        return;
      }
      if (first && !count) first(reply);
      for (const item of reply.items) {
        const node = render(item);
        if (node) { list.append(node); count += 1; }
      }
      next = reply.next;
      finished = !next;
      if (!count && empty) { shownEmpty = empty; foot.append(empty); }
      if (!finished) watch();
    }

    function watch() {
      observer?.disconnect();
      if (!("IntersectionObserver" in window)) { foot.append(h("button", { class: "btn ghost", type: "button", onclick: () => more(false) }, "Mehr laden")); return; }
      observer = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) more(false); }, { rootMargin: "700px 0px" });
      const marker = h("div", { class: "sentinel" });
      foot.append(marker);
      observer.observe(marker);
    }

    more(true);
    return {
      element, list,
      reload: () => more(true),
      prepend: (node) => { list.prepend(node); count += 1; shownEmpty?.remove(); shownEmpty = null; },
      destroy: () => { dead = true; observer?.disconnect(); },
    };
  }

  // ---------------------------------------------------------------------------------------- viewer
  /* The pictures of a Yip, big. Arrow keys or the buttons go from one to the next. */
  function viewer(media, start = 0) {
    let at = start;
    const image = h("img", { class: "viewer-img", alt: "" });
    const caption = h("p", { class: "viewer-alt" });
    const prev = h("button", { class: "icon-btn viewer-nav prev", type: "button", "aria-label": "Voriges Bild", onclick: () => show(at - 1) }, icon("back"));
    const nextButton = h("button", { class: "icon-btn viewer-nav next", type: "button", "aria-label": "Nächstes Bild", onclick: () => show(at + 1) }, icon("chevron"));
    function show(index) {
      at = (index + media.length) % media.length;
      image.src = media[at].url;
      image.alt = media[at].alt || "Bild";
      caption.textContent = media[at].alt || "";
      caption.hidden = !media[at].alt;
    }
    show(start);
    const body = h("div", { class: "viewer" }, image, caption, media.length > 1 ? [prev, nextButton] : null);
    const entry = dialog({ bare: true, label: "Bildansicht", body: h("div", { class: "viewer-wrap" }, h("button", { class: "icon-btn viewer-close", type: "button", "aria-label": "Schließen", onclick: () => entry.close() }, icon("close")), body) });
    entry.box.classList.add("viewing");
    entry.box.addEventListener("keydown", (event) => {
      if (event.key === "ArrowRight" && media.length > 1) show(at + 1);
      if (event.key === "ArrowLeft" && media.length > 1) show(at - 1);
    });
    return entry;
  }

  Object.assign(Yipi, { h, append, fill, put, icon, link, avatar, richText, timeEl, toast, dialog, confirmBox, menu, floating, tabs, skeleton, pager, viewer, wait });
})();
