/* Nex Ai ui: the small building blocks of the page -- elements, icons, dialogs, menus, messages.  Text from the list is only ever put
   on the page as text, never as HTML; the icons are fixed drawings parsed as SVG. */
(function () {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";
  const T = (window.Regal = window.Regal || {});

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
    code: '<path d="M8 8l-5 4 5 4M16 8l5 4-5 4M14 5l-4 14"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2.500"/><circle cx="9" cy="10" r="1.800"/><path d="M4 18l5-5 4 4 3-3 4 4"/>',
    video: '<rect x="3" y="5" width="13" height="14" rx="2.500"/><path d="M16 10l5-3v10l-5-3z"/>',
    music: '<path d="M9 18V6l11-2v12"/><circle cx="6.500" cy="18" r="2.500"/><circle cx="17.500" cy="16" r="2.500"/>',
    voice: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v3"/>',
    ear: '<path d="M7 10a5 5 0 0110 0c0 3-3 3.500-3 6.500a2.500 2.500 0 01-5 0M10 10a2 2 0 014 0"/>',
    eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    wand: '<path d="M5 19L17 7M14 4l1-2 1 2 2 1-2 1-1 2-1-2-2-1zM18 12l.7-1.400L20 10l-1.300-.6L18 8l-.7 1.400L16 10l1.300.6z"/>',
    wave: '<path d="M3 12h2M7 8v8M11 5v14M15 9v6M19 11v2"/>',
    scan: '<path d="M4 8V6a2 2 0 012-2h2M16 4h2a2 2 0 012 2v2M20 16v2a2 2 0 01-2 2h-2M8 20H6a2 2 0 01-2-2v-2"/><path d="M4 12h16"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
    search: '<circle cx="11" cy="11" r="6.500"/><path d="M16 16l4.500 4.500"/>',
    cube: '<path d="M12 3l8 4.500v9L12 21l-8-4.500v-9z"/><path d="M12 12l8-4.500M12 12v9M12 12L4 7.500"/>',
    download: '<path d="M12 4v11M7.500 10.500L12 15l4.500-4.500M5 19h14"/>',
    folder: '<path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2"/>',
    external: '<path d="M14 4h6v6M20 4l-9 9M18 14v4a2 2 0 01-2 2H6a2 2 0 01-2-2V8a2 2 0 012-2h4"/>',
    heart: '<path d="M12 20s-8-5-8-11a4.500 4.500 0 018-2.700A4.500 4.500 0 0120 9c0 6-8 11-8 11z"/>',
    check: '<path d="M5 12.500l4.500 4.500L19 7"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    warn: '<path d="M12 4l9 16H3z"/><path d="M12 10v5M12 17.500h.01"/>',
    filter: '<path d="M4 6h16M7 12h10M10 18h4"/>',
    pc: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
    terminal: '<rect x="3" y="4" width="18" height="16" rx="2.500"/><path d="M7 9l3 3-3 3M13 15h4"/>',
    down: '<path d="M6 9l6 6 6-6"/>',
    shield: '<path d="M12 3l8 3v6c0 4.500-3.200 8-8 9-4.800-1-8-4.500-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
    send: '<path d="M12 19V5M5.500 11.500L12 5l6.500 6.500"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h10"/>',
    refresh: '<path d="M20 11a8 8 0 10-2.300 5.700M20 5v6h-6"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16zM13.500 6.500l4 4"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12M9 7V4h6v3"/>',
  };
  function icon(name) {
    return svgElement(`<svg xmlns="${SVG_NS}" viewBox="0 0 24 24" ${LINE} aria-hidden="true" focusable="false">${ICONS[name] || ICONS.info}</svg>`);
  }

  /* The mark of Nex Ai (the same as Nex had): a hexagon of six nodes round a seventh, white on a dark tile.  Fixed colours: a brand mark
     does not follow the light or dark setting. */
  function logo() {
    return svgElement(`<svg xmlns="${SVG_NS}" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <rect width="100" height="100" rx="20" fill="#2f2f2f"/>
      <g fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
        <path d="M50 19 L78.6 35.5 L78.6 68.5 L50 85 L21.4 68.5 L21.4 35.5 Z"/>
        <path d="M50 52 L50 19 M50 52 L78.6 35.5 M50 52 L78.6 68.5 M50 52 L50 85 M50 52 L21.4 68.5 M50 52 L21.4 35.5"/>
      </g>
      <g fill="#2f2f2f" stroke="#fff" stroke-width="3">
        <circle cx="50" cy="19" r="7.5"/><circle cx="78.6" cy="35.5" r="7.5"/><circle cx="78.6" cy="68.5" r="7.5"/>
        <circle cx="50" cy="85" r="7.5"/><circle cx="21.4" cy="68.5" r="7.5"/><circle cx="21.4" cy="35.5" r="7.5"/>
      </g>
      <circle cx="50" cy="52" r="4.6" fill="#fff"/></svg>`);
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

  const count = (n) => Number(n).toLocaleString("de-DE");

  Object.assign(T, { h, put, fill, append, wait, nextFrame, svgElement, icon, logo, copyText, toast, dialog, confirmBox, formDialog, menu, count });
})();
