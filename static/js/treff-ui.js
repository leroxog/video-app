/* Treff ui: the small building blocks of the page -- elements, icons, pictures of people and groups, dialogs, menus, messages.  Text that
   comes from people is only ever put on the page as text, never as HTML; the icons are fixed drawings parsed as SVG. */
(function () {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";
  const Core = window.TreffCore;
  const T = (window.Treff = window.Treff || {});

  // -------------------------------------------------------------------------------------------- elements
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value == null || value === false) continue;
      if (key === "class") el.className = value;
      else if (key === "style") el.style.cssText = value;
      else if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
      else el.setAttribute(key, value === true ? "" : value);
    }
    put(el, ...children);
    return el;
  }
  function append(el, children) {
    for (const child of children) {
      if (child == null || child === false) continue;
      if (Array.isArray(child)) append(el, child);
      else el.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
  }
  function put(el, ...children) { append(el, children); return el; }
  function fill(el, ...children) { el.replaceChildren(); append(el, children); return el; }
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const nextFrame = () => new Promise((resolve) => { let done = false; const go = () => { if (!done) { done = true; resolve(); } }; requestAnimationFrame(go); setTimeout(go, 50); });

  /* A drawing from SVG text (it is ours, and a parsed SVG that is not inserted as HTML runs no scripts). */
  function svgElement(text) {
    const doc = new DOMParser().parseFromString(text, "image/svg+xml");
    return document.importNode(doc.documentElement, true);
  }

  // -------------------------------------------------------------------------------------------------- icons
  const LINE = 'fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"';
  const ICONS = {
    chat: '<path d="M5 5h14a2 2 0 012 2v8a2 2 0 01-2 2h-7l-5 4v-4H5a2 2 0 01-2-2V7a2 2 0 012-2z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="11" cy="11" r="6.500"/><path d="M16 16l4.500 4.500"/>',
    send: '<path d="M4 12L20 4l-5 16-3.500-6.500z"/><path d="M11.500 13.500L20 4"/>',
    back: '<path d="M19 12H5M11 5l-7 7 7 7"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    more: '<circle cx="5" cy="12" r="1.600" fill="currentColor"/><circle cx="12" cy="12" r="1.600" fill="currentColor"/><circle cx="19" cy="12" r="1.600" fill="currentColor"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2"/>',
    external: '<path d="M14 4h6v6M20 4l-9 9M18 14v4a2 2 0 01-2 2H6a2 2 0 01-2-2V8a2 2 0 012-2h4"/>',
    reply: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 010 12h-3"/>',
    smile: '<circle cx="12" cy="12" r="9"/><path d="M8.500 14a4 4 0 007 0M9 9.500h.01M15 9.500h.01"/>',
    flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
    idea: '<path d="M9 18h6M10 21h4M12 3a6 6 0 00-3.500 10.900c.6.500 1 1.200 1 2.100h5c0-.9.4-1.600 1-2.100A6 6 0 0012 3z"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>',
    edit: '<path d="M4 20h4L19 9a2.800 2.800 0 00-4-4L4 16z"/><path d="M13.500 6.500l4 4"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    share: '<path d="M12 15V3M7.500 7.500L12 3l4.500 4.500M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7"/>',
    users: '<circle cx="9" cy="8" r="3.500"/><path d="M2.500 20c.6-3.600 3.200-5.500 6.500-5.500s5.900 1.900 6.500 5.500"/><path d="M16 4.700a3.500 3.500 0 010 6.600M18.500 14.800c1.600.8 2.700 2.400 3 5.200"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.500M12 18.500V21M3 12h2.500M18.500 12H21M5.600 5.600l1.800 1.800M16.600 16.600l1.800 1.800M5.600 18.400l1.800-1.800M16.600 7.400l1.800-1.800"/>',
    check: '<path d="M5 12.500l4.500 4.500L19 7"/>',
    warn: '<path d="M12 4l9 16H3z"/><path d="M12 10v5M12 17.500h.01"/>',
    down: '<path d="M12 5v14M5 12l7 7 7-7"/>',
    chevron: '<path d="M9 5l7 7-7 7"/>',
    quote: '<path d="M7 17c-2 0-3-1.300-3-3.500 0-3.500 2-6 5-6.500M17 17c-2 0-3-1.300-3-3.500 0-3.500 2-6 5-6.500"/>',
    pin: '<path d="M9 4h6l-1 6 3 3v2H7v-2l3-3zM12 15v6"/>',
    flame: '<path d="M12 3c1 3.500 5 5.500 5 10a5 5 0 01-10 0c0-2 1-3 2-4 .3 1.200 1 2 2 2 0-3-.5-5 1-8z"/>',
  };
  function icon(name) {
    return svgElement(`<svg xmlns="${SVG_NS}" viewBox="0 0 24 24" ${LINE} aria-hidden="true" focusable="false">${ICONS[name] || ICONS.info}</svg>`);
  }

  let logoCount = 0;
  /* The logo: a speech bubble with an exclamation mark ("Fakten!") on a blue tile. */
  function logo() {
    const id = `tg${++logoCount}`;
    return svgElement(`<svg xmlns="${SVG_NS}" viewBox="0 0 48 48" aria-hidden="true" focusable="false"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3b82f6"/><stop offset="1" stop-color="#22d3ee"/></linearGradient></defs>
      <rect x="2" y="2" width="44" height="44" rx="12" fill="url(#${id})"/>
      <path d="M13 12h22a3 3 0 013 3v12a3 3 0 01-3 3H25l-7 6v-6h-5a3 3 0 01-3-3V15a3 3 0 013-3z" fill="#fff"/>
      <path d="M24 17.500v6" stroke="#0b0f17" stroke-width="3" stroke-linecap="round"/><circle cx="24" cy="27.200" r="1.900" fill="#0b0f17"/></svg>`);
  }

  // -------------------------------------------------------------------------------------- pictures of people
  /* The round picture of a group (its first letters) or of a person: always the same colour for the same name. */
  function avatar(seed, label, size = "") {
    const c = Core.colorFor(seed);
    return h("span", { class: `avatar${size ? ` ${size}` : ""}`, "aria-hidden": "true", style: `background: linear-gradient(135deg, ${c.background}, hsl(${(c.hue + 40) % 360} 62% 38%))` }, label);
  }
  /* "user 482913" in the colour of that person. */
  function person(number, extra) {
    const c = Core.colorFor(`user ${number}`);
    return h("span", { class: `person${extra ? ` ${extra}` : ""}`, style: `color: ${c.soft}` }, Core.userName(number));
  }

  /* Copies a text to the clipboard (resolves to whether it worked). */
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (error) { /* an older browser, or not allowed: the old way */ }
    const area = h("textarea", { class: "offscreen", "aria-hidden": "true", readonly: true });
    area.value = text;
    document.body.append(area);
    area.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch (error) { ok = false; }
    area.remove();
    return ok;
  }

  // ------------------------------------------------------------------------------------------------ messages
  let toastTimer = null;
  function toast(message, action) {
    document.querySelector(".toast")?.remove();
    const el = h("div", { class: "toast", role: "status" }, h("span", {}, message), action ? h("button", { class: "toast-action", type: "button", onclick: () => { el.remove(); action.run(); } }, action.label) : null);
    document.body.append(el);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.remove(), action ? 6500 : 3000);
  }

  // ------------------------------------------------------------------------------------------------ dialogs
  const dialogs = [];

  function trapTab(box, event) {
    if (event.key !== "Tab") return;
    const items = [...box.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter((el) => el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  /* A dialog.  `actions`: [{label, kind: "primary" | "danger" | "ghost", run}] -- a run that returns false keeps the dialog open.
     On a phone it comes up from the bottom. */
  function dialog({ title, body, actions = [], wide = false, onClose, initialFocus }) {
    const opener = document.activeElement;
    const back = h("div", { class: "dialog-back" });
    const box = h("div", { class: `dialog${wide ? " wide" : ""}`, role: "dialog", "aria-modal": "true", "aria-label": title || "Dialog" });
    let closed = false;
    const entry = { box, close() {
      if (closed) return;
      closed = true;
      dialogs.splice(dialogs.indexOf(entry), 1);
      back.remove();
      if (!dialogs.length) document.body.classList.remove("modal-open");
      if (opener && opener.isConnected) opener.focus();
      onClose?.();
    } };
    put(box, h("div", { class: "dialog-top" }, title ? h("h2", {}, title) : null, h("button", { class: "icon-btn", type: "button", "aria-label": "Schließen", onclick: () => entry.close() }, icon("close"))));
    put(box, h("div", { class: "dialog-body" }, body));
    if (actions.length) {
      put(box, h("div", { class: "dialog-actions" }, actions.map((a) => h("button", { class: `btn ${a.kind || "ghost"}`, type: "button", onclick: async (event) => {
        const button = event.currentTarget;
        button.disabled = true;
        let result;
        try { result = a.run ? await a.run() : undefined; } finally { button.disabled = false; }
        if (result !== false) entry.close();
      } }, a.label))));
    }
    back.append(box);
    back.addEventListener("pointerdown", (e) => { back._down = e.target === back; });
    back.addEventListener("click", (e) => { if (e.target === back && back._down) entry.close(); });
    back.addEventListener("keydown", (e) => trapTab(box, e));
    document.body.append(back);
    document.body.classList.add("modal-open");
    dialogs.push(entry);
    (initialFocus || box.querySelector("textarea, input:not([type=checkbox]), .dialog-actions .btn.primary, .dialog-actions .btn"))?.focus();
    return entry;
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && dialogs.length && !document.querySelector(".menu")) { event.stopPropagation(); dialogs[dialogs.length - 1].close(); }
  });

  function confirmBox({ title, text, yes = "OK", danger = false, no = "Abbrechen" }) {
    return new Promise((resolve) => {
      let answered = false;
      const done = (value) => { answered = true; resolve(value); };
      dialog({ title, body: h("p", { class: "dialog-text" }, text), actions: [
        { label: yes, kind: danger ? "danger" : "primary", run: () => done(true) },
        { label: no, kind: "ghost", run: () => done(false) },
      ], onClose: () => { if (!answered) resolve(false); } });
    });
  }

  /* A dialog with a small form.  fields: [{name, label, type: "text" | "area" | "check", value, max, rows, help, placeholder}].
     `run(values)` does the work and throws an Error with a sentence for the person when it did not work (then the dialog stays open).
     Resolves to what `run` gave, or null when the dialog was closed. */
  function formDialog({ title, text, fields, yes = "OK", danger = false, run }) {
    return new Promise((resolve) => {
      let result = null;
      const inputs = {};
      const error = h("p", { class: "form-error", role: "alert", hidden: true });
      const rows = fields.map((f) => {
        const input = f.type === "area"
          ? h("textarea", { class: "field", rows: f.rows || 3, maxlength: f.max, placeholder: f.placeholder || "", "aria-label": f.label })
          : h("input", { class: f.type === "check" ? "" : "field", type: f.type === "check" ? "checkbox" : "text", maxlength: f.max, placeholder: f.placeholder || "", autocomplete: "off", "aria-label": f.label });
        if (f.type === "check") input.checked = !!f.value; else input.value = f.value || "";
        inputs[f.name] = input;
        if (f.type === "check") return h("label", { class: "check-row" }, input, h("span", {}, h("b", {}, f.label), f.help ? h("small", {}, f.help) : null));
        return h("label", { class: "field-label" }, h("span", {}, f.label), input, f.help ? h("small", { class: "muted" }, f.help) : null);
      });
      const submit = async () => {
        error.hidden = true;
        const values = {};
        for (const f of fields) values[f.name] = f.type === "check" ? inputs[f.name].checked : inputs[f.name].value;
        try { result = await run(values); return true; } catch (e) { error.textContent = e.message || "Das hat nicht geklappt."; error.hidden = false; return false; }
      };
      const entry = dialog({ title, body: h("div", { class: "form-body" }, text ? h("p", { class: "dialog-text" }, text) : null, rows, error), actions: [{ label: yes, kind: danger ? "danger" : "primary", run: submit }], onClose: () => resolve(result) });
      for (const f of fields) if (f.type !== "area" && f.type !== "check") inputs[f.name].addEventListener("keydown", async (e) => { if (e.key === "Enter") { e.preventDefault(); if (await submit()) entry.close(); } });
    });
  }

  // -------------------------------------------------------------------------------------------------- menus
  /* A menu next to `anchor`.  items: [{label, icon, run, danger}], {emojis: [...], run(emoji), marked: [...]} (a row of reactions) or {node} (anything). */
  function menu(anchor, items) {
    document.querySelector(".menu")?.remove();
    let entry;
    const el = h("div", { class: "menu", role: "menu" }, items.filter(Boolean).map((item) => item.node ? item.node : item.emojis
      ? h("div", { class: "menu-emojis", role: "group", "aria-label": "Reagieren" }, item.emojis.map((e) => h("button", { class: `menu-emoji${(item.marked || []).includes(e) ? " on" : ""}`, type: "button", "aria-label": e, onclick: () => { entry.close(); item.run(e); } }, e)))
      : h("button", { class: `menu-item${item.danger ? " danger" : ""}`, type: "button", role: "menuitem", onclick: () => { entry.close(); item.run(); } }, item.icon ? icon(item.icon) : null, h("span", {}, item.label))));
    document.body.append(el);
    const box = anchor.getBoundingClientRect();
    const width = el.offsetWidth, height = el.offsetHeight;
    el.style.left = `${Math.max(8, Math.min(window.innerWidth - width - 8, box.right - width))}px`;
    el.style.top = `${box.bottom + height + 8 > window.innerHeight ? Math.max(8, box.top - height - 4) : box.bottom + 4}px`;
    const close = () => {
      el.remove();
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", keys, true);
      window.removeEventListener("resize", close);
      if (anchor.isConnected) anchor.focus();
    };
    const outside = (e) => { if (!el.contains(e.target)) close(); };
    const keys = (e) => {
      if (e.key === "Escape") { e.stopPropagation(); close(); }
      const buttons = [...el.querySelectorAll("button")];
      const at = buttons.indexOf(document.activeElement);
      if (e.key === "ArrowDown") { e.preventDefault(); buttons[(at + 1) % buttons.length].focus(); }
      if (e.key === "ArrowUp") { e.preventDefault(); buttons[(at - 1 + buttons.length) % buttons.length].focus(); }
    };
    setTimeout(() => { document.addEventListener("pointerdown", outside, true); document.addEventListener("keydown", keys, true); window.addEventListener("resize", close); }, 0);
    el.querySelector("button")?.focus();
    entry = { close };
    return entry;
  }

  // ----------------------------------------------------------------------------------------------- controls
  /* A row of buttons of which one is on. options: [[value, label]] */
  function segmented(options, value, onChange, label) {
    const bar = h("div", { class: "segmented", role: "group", "aria-label": label || "Auswahl" });
    const draw = (v) => { for (const b of bar.querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.value === String(v))); };
    for (const [v, text] of options) bar.append(h("button", { type: "button", "data-value": String(v), onclick: () => { draw(v); onChange(v); } }, text));
    draw(value);
    bar.set = draw;
    return bar;
  }

  const count = (n) => Number(n).toLocaleString("de-DE");

  Object.assign(T, { h, put, fill, append, wait, nextFrame, svgElement, icon, logo, avatar, person, copyText, toast, dialog, confirmBox, formDialog, menu, segmented, count });
})();
