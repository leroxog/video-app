/* raumo ui: the small building blocks of the page -- elements, icons, dialogs, menus, messages.  Text that comes from people (the names
   of buildings and rooms) is only ever put on the page as text, never as HTML; the icons are fixed drawings parsed as SVG. */
(function () {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";
  const R = (window.Raumo = window.Raumo || {});

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

  /* A drawing from SVG text (no scripts run from a parsed SVG that is not inserted as HTML; the text is ours anyway). */
  function svgElement(text) {
    const doc = new DOMParser().parseFromString(text, "image/svg+xml");
    return document.importNode(doc.documentElement, true);
  }

  // -------------------------------------------------------------------------------------------------- icons
  const LINE = 'fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"';
  const ICONS = {
    cube: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/>',
    scan: '<path d="M4 8V6a2 2 0 012-2h2M16 4h2a2 2 0 012 2v2M20 16v2a2 2 0 01-2 2h-2M8 20H6a2 2 0 01-2-2v-2"/><path d="M4 12h16"/>',
    camera: '<path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 011 1v9a1 1 0 01-1 1H4a1 1 0 01-1-1V9a1 1 0 011-1z"/><circle cx="12" cy="13" r="3.5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    back: '<path d="M19 12H5M11 5l-7 7 7 7"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    more: '<circle cx="5" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="19" cy="12" r="1.6" fill="currentColor"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>',
    edit: '<path d="M4 20h4L19 9a2.8 2.8 0 00-4-4L4 16z"/><path d="M13.500 6.500l4 4"/>',
    download: '<path d="M12 4v11M7.500 10.500L12 15l4.500-4.500M5 19h14"/>',
    upload: '<path d="M12 16V5M7.500 9.500L12 5l4.500 4.500M5 19h14"/>',
    ruler: '<path d="M3 16L16 3l5 5L8 21z"/><path d="M7 12l2 2M10 9l2 2M13 6l2 2"/>',
    plan: '<path d="M4 4h16v16H4z"/><path d="M4 12h8V4M12 12v8M16 12h4"/>',
    walk: '<circle cx="12" cy="5" r="2"/><path d="M12 8v6M12 14l-3 6M12 14l3 6M8 11l4-2 4 2"/>',
    orbit: '<ellipse cx="12" cy="12" rx="9" ry="4"/><path d="M12 3c3 2.500 3 15.500 0 18M12 3c-3 2.500-3 15.500 0 18" opacity=".5"/>',
    rooms: '<rect x="3" y="3" width="8" height="8" rx="1.500"/><rect x="13" y="3" width="8" height="8" rx="1.500"/><rect x="3" y="13" width="8" height="8" rx="1.500"/><rect x="13" y="13" width="8" height="8" rx="1.500"/>',
    door: '<path d="M6 21V4a1 1 0 011-1h10a1 1 0 011 1v17M4 21h16"/><circle cx="15" cy="12.500" r=".9" fill="currentColor"/>',
    window: '<rect x="4" y="3" width="16" height="18" rx="1.500"/><path d="M12 3v18M4 12h16"/>',
    check: '<path d="M5 12.500l4.500 4.500L19 7"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    warn: '<path d="M12 4l9 16H3z"/><path d="M12 10v5M12 17.500h.01"/>',
    undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 010 12h-3"/>',
    share: '<path d="M12 15V3M7.500 7.500L12 3l4.500 4.500M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/>',
    link: '<path d="M10 14a4 4 0 005.700 0l3-3a4 4 0 00-5.700-5.700L11.500 6.800"/><path d="M14 10a4 4 0 00-5.700 0l-3 3a4 4 0 005.700 5.700l1.500-1.500"/>',
    layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.500 9.500a2.500 2.500 0 114 2c-.9.6-1.500 1.100-1.500 2.200M12 17h.01"/>',
    rotate: '<path d="M20 12a8 8 0 11-2.600-5.900M20 4v5h-5"/>',
    home: '<path d="M3 11.500L12 4l9 7.500V19a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>',
    up: '<path d="M12 19V5M5 12l7-7 7 7"/>',
    down: '<path d="M12 5v14M5 12l7 7 7-7"/>',
    chevron: '<path d="M9 5l7 7-7 7"/>',
    points: '<circle cx="6" cy="7" r="1.600" fill="currentColor"/><circle cx="12" cy="5" r="1.600" fill="currentColor"/><circle cx="18" cy="8" r="1.600" fill="currentColor"/><circle cx="8" cy="13" r="1.600" fill="currentColor"/><circle cx="15" cy="13" r="1.600" fill="currentColor"/><circle cx="5" cy="18" r="1.600" fill="currentColor"/><circle cx="11" cy="19" r="1.600" fill="currentColor"/><circle cx="18" cy="18" r="1.600" fill="currentColor"/>',
    palette: '<circle cx="12" cy="12" r="9"/><circle cx="8.500" cy="10" r="1.200" fill="currentColor"/><circle cx="12" cy="7.500" r="1.200" fill="currentColor"/><circle cx="15.500" cy="10" r="1.200" fill="currentColor"/>',
  };

  function icon(name) {
    return svgElement(`<svg xmlns="${SVG_NS}" viewBox="0 0 24 24" ${LINE} aria-hidden="true" focusable="false">${ICONS[name] || ICONS.info}</svg>`);
  }

  let logoCount = 0;
  /* The logo: a cube inside the corners of a viewfinder, orange to yellow. */
  function logo() {
    const id = `rg${++logoCount}`;
    return svgElement(`<svg xmlns="${SVG_NS}" viewBox="0 0 48 48" aria-hidden="true" focusable="false"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff8a1f"/><stop offset="1" stop-color="#ffcf3a"/></linearGradient></defs>
      <path d="M6 15V9a3 3 0 013-3h6M33 6h6a3 3 0 013 3v6M42 33v6a3 3 0 01-3 3h-6M15 42H9a3 3 0 01-3-3v-6" fill="none" stroke="url(#${id})" stroke-width="3.4" stroke-linecap="round"/>
      <path d="M24 13l9.500 5.300v10.600L24 34.300l-9.500-5.400V18.300z" fill="url(#${id})"/><path d="M24 23.600l9.500-5.300M24 23.600v10.700M24 23.600l-9.500-5.300" fill="none" stroke="#1a1204" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" opacity=".55"/></svg>`);
  }

  // ------------------------------------------------------------------------------------------------ messages
  let toastTimer = null;
  function toast(message, action) {
    document.querySelector(".toast")?.remove();
    const el = h("div", { class: "toast", role: "status" }, h("span", {}, message), action ? h("button", { class: "toast-action", type: "button", onclick: () => { el.remove(); action.run(); } }, action.label) : null);
    document.body.append(el);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.remove(), action ? 6500 : 3400);
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
     `sheet: true` makes it come up from the bottom on a phone. */
  function dialog({ title, body, actions = [], wide = false, sheet = true, label, onClose, initialFocus }) {
    const opener = document.activeElement;
    const back = h("div", { class: "dialog-back" });
    const box = h("div", { class: `dialog${wide ? " wide" : ""}${sheet ? " sheet" : ""}`, role: "dialog", "aria-modal": "true", "aria-label": label || title || "Dialog" });
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
    (initialFocus || box.querySelector("textarea, input:not([type=file]), .dialog-actions .btn.primary, .dialog-actions .btn"))?.focus();
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

  /* Asks for a text or a number; resolves to the answer or null. `check(value)` may return an error text. */
  function promptBox({ title, label, value = "", type = "text", unit, min, max, step, yes = "OK", help, check }) {
    return new Promise((resolve) => {
      let answered = false;
      const input = h("input", { class: "field", type: type === "number" ? "text" : "text", inputmode: type === "number" ? "decimal" : "text", "aria-label": label || title, autocomplete: "off", maxlength: type === "number" ? 12 : 80 });
      input.value = String(value);
      const error = h("p", { class: "form-error", role: "alert", hidden: true });
      const submit = () => {
        let result = input.value.trim();
        if (type === "number") {
          result = Number(result.replace(",", "."));
          if (!Number.isFinite(result) || (min != null && result < min) || (max != null && result > max)) { error.textContent = `Gib eine Zahl${min != null && max != null ? ` zwischen ${String(min).replace(".", ",")} und ${String(max).replace(".", ",")}` : ""} ein.`; error.hidden = false; return false; }
        } else if (!result) { error.textContent = "Das darf nicht leer sein."; error.hidden = false; return false; }
        const problem = check && check(result);
        if (problem) { error.textContent = problem; error.hidden = false; return false; }
        answered = true;
        resolve(result);
        return true;
      };
      const entry = dialog({ title, body: h("div", {}, label ? h("label", { class: "field-label" }, h("span", {}, label), h("div", { class: unit ? "with-unit" : "" }, input, unit ? h("span", { class: "unit" }, unit) : null)) : input, help ? h("p", { class: "muted small" }, help) : null, error),
        actions: [{ label: yes, kind: "primary", run: () => submit() }], onClose: () => { if (!answered) resolve(null); }, initialFocus: input });
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); if (submit()) entry.close(); } });
      input.select();
    });
  }

  // -------------------------------------------------------------------------------------------------- menus
  function menu(anchor, items) {
    document.querySelector(".menu")?.remove();
    let entry;
    const el = h("div", { class: "menu", role: "menu" }, items.filter(Boolean).map((item) => h("button", { class: `menu-item${item.danger ? " danger" : ""}`, type: "button", role: "menuitem", onclick: () => { entry.close(); item.run(); } }, item.icon ? icon(item.icon) : null, h("span", {}, item.label))));
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

  const num = (x, digits = 2) => (Math.round(x * 10 ** digits) / 10 ** digits).toFixed(digits).replace(".", ",");
  const metres = (x) => `${num(x)} m`;
  const area = (x) => `${num(x, 1)} m²`;
  const dateText = (t) => new Date(t).toLocaleDateString("de-DE", { day: "numeric", month: "short", year: "numeric" });

  /* Gives a file to the person: `data` is a Blob, bytes or text. */
  function saveFile(name, data, type = "application/octet-stream") {
    const blob = data instanceof Blob ? data : new Blob([data], { type });
    const url = URL.createObjectURL(blob);
    const a = h("a", { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  Object.assign(R, { h, put, fill, append, wait, nextFrame, svgElement, icon, logo, toast, dialog, confirmBox, promptBox, menu, segmented, num, metres, area, dateText, saveFile });
})();
