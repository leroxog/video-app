/* yipi icons: the small pictures of the page and the logo, drawn in code (all original). `YipiIcons.icon(name)` gives
   an <svg> element that takes the colour of the text around it; `YipiIcons.logo()` the speech bubble with the "y". The only
   place in the page that uses innerHTML is here, for these fixed drawings. */
(function () {
  "use strict";

  const LINE = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
  const FILL = 'fill="currentColor"';
  const S = (inner, extra = LINE) => `<svg viewBox="0 0 24 24" ${extra} aria-hidden="true" focusable="false">${inner}</svg>`;

  const ICON = {
    home: S('<path d="M3 11.5L12 4l9 7.5V19a2 2 0 01-2 2h-3.5v-6h-7v6H5a2 2 0 01-2-2z"/>'),
    homeFill: S('<path d="M3 11.5L12 4l9 7.5V19a2 2 0 01-2 2h-3.5v-6h-7v6H5a2 2 0 01-2-2z"/>', `${FILL} stroke="currentColor" stroke-width="2" stroke-linejoin="round"`),
    search: S('<circle cx="11" cy="11" r="7"/><path d="M16.5 16.5L21 21"/>'),
    searchBold: S('<circle cx="11" cy="11" r="7"/><path d="M16.5 16.5L21 21"/>', LINE.replace('stroke-width="2"', 'stroke-width="2.8"')),
    bell: S('<path d="M6 9a6 6 0 0112 0c0 5 2 6.500 2 7.500H4C4 15.500 6 14 6 9z"/><path d="M10 20a2 2 0 004 0"/>'),
    bellFill: S('<path d="M6 9a6 6 0 0112 0c0 5 2 6.500 2 7.500H4C4 15.500 6 14 6 9z"/><path d="M10 20a2 2 0 004 0"/>', `${FILL} stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"`),
    mail: S('<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3.500 7.500L12 13l8.500-5.500"/>'),
    mailFill: S('<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3.500 7.500L12 13l8.500-5.500"/>', LINE.replace('stroke-width="2"', 'stroke-width="2.800"')),
    bookmark: S('<path d="M6 4h12v17l-6-4-6 4z"/>'),
    bookmarkFill: S('<path d="M6 4h12v17l-6-4-6 4z"/>', `${FILL} stroke="currentColor" stroke-width="2" stroke-linejoin="round"`),
    user: S('<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>'),
    userFill: S('<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6z"/>', `${FILL} stroke="currentColor" stroke-width="2" stroke-linejoin="round"`),
    more: S('<circle cx="5" cy="12" r="1.800"/><circle cx="12" cy="12" r="1.800"/><circle cx="19" cy="12" r="1.800"/>', FILL),
    settings: S('<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>'),
    reply: S('<path d="M5 5h14a2 2 0 012 2v8a2 2 0 01-2 2h-6.500L8 21v-4H5a2 2 0 01-2-2V7a2 2 0 012-2z"/>'),
    repost: S('<path d="M17 3l3 3-3 3"/><path d="M4 11V9a3 3 0 013-3h13"/><path d="M7 21l-3-3 3-3"/><path d="M20 13v2a3 3 0 01-3 3H4"/>'),
    heart: S('<path d="M12 20.500s-8-4.800-9.600-10C1.400 7 3.600 4 7 4c2 0 3.700 1 5 2.800C13.300 5 15 4 17 4c3.400 0 5.600 3 4.600 6.500-1.600 5.200-9.600 10-9.600 10z"/>'),
    heartFill: S('<path d="M12 20.500s-8-4.800-9.600-10C1.400 7 3.600 4 7 4c2 0 3.700 1 5 2.800C13.300 5 15 4 17 4c3.400 0 5.600 3 4.600 6.500-1.600 5.200-9.600 10-9.600 10z"/>', `${FILL} stroke="currentColor" stroke-width="2" stroke-linejoin="round"`),
    share: S('<path d="M12 15V3"/><path d="M7.500 7.500L12 3l4.500 4.500"/><path d="M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7"/>'),
    image: S('<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="1.600"/><path d="M3 17l5-5 4 4 3-3 6 5"/>'),
    emoji: S('<circle cx="12" cy="12" r="9"/><path d="M8 14c1 2 2.500 3 4 3s3-1 4-3"/><circle cx="9" cy="10" r=".9" fill="currentColor"/><circle cx="15" cy="10" r=".9" fill="currentColor"/>'),
    close: S('<path d="M6 6l12 12M18 6L6 18"/>'),
    back: S('<path d="M19 12H5M11 5l-7 7 7 7"/>'),
    check: S('<path d="M5 12.500l4.500 4.500L19 7"/>'),
    calendar: S('<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>'),
    pin: S('<path d="M12 21s7-6 7-11a7 7 0 10-14 0c0 5 7 11 7 11z"/><circle cx="12" cy="10" r="2.500"/>'),
    link: S('<path d="M10 14a4 4 0 005.700 0l3-3a4 4 0 00-5.700-5.700L11.500 6.800"/><path d="M14 10a4 4 0 00-5.700 0l-3 3a4 4 0 005.700 5.700l1.500-1.500"/>'),
    trash: S('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>'),
    flag: S('<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>'),
    block: S('<circle cx="12" cy="12" r="9"/><path d="M5.600 5.600l12.800 12.800"/>'),
    mute: S('<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 9l5 6M21 9l-5 6"/>'),
    plus: S('<path d="M12 5v14M5 12h14"/>'),
    feather: S('<path d="M4 20l1-5L16 4a2.100 2.100 0 013 3L8 18z"/><path d="M13.500 6.500l3 3"/>'),
    logout: S('<path d="M10 4H6a2 2 0 00-2 2v12a2 2 0 002 2h4M15 8l4 4-4 4M19 12H9"/>'),
    lock: S('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>'),
    sun: S('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.900 4.900l1.400 1.400M17.700 17.700l1.400 1.400M4.900 19.100l1.400-1.400M17.700 6.300l1.400-1.400"/>'),
    moon: S('<path d="M20 14a8 8 0 11-9-10 6.500 6.500 0 009 10z"/>'),
    shield: S('<path d="M12 3l8 3v6c0 5-3.500 8-8 9-4.500-1-8-4-8-9V6z"/><path d="M8.500 12l2.500 2.500 4.500-5"/>'),
    chevron: S('<path d="M9 5l7 7-7 7"/>'),
    send: S('<path d="M4 12l16-8-6 16-3-7z"/>'),
    trending: S('<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>'),
    pencil: S('<path d="M4 20h4L19 9a2.800 2.800 0 00-4-4L4 16z"/><path d="M13.500 6.500l4 4"/>'),
    users: S('<circle cx="9" cy="8" r="3.500"/><path d="M2.500 20c.8-3.500 3.200-5.500 6.500-5.500s5.700 2 6.500 5.500"/><path d="M16 4.800a3.500 3.500 0 010 6.400M18 14.800c2 .6 3.200 2.300 3.600 4.700"/>'),
  };

  function icon(name) {
    const holder = document.createElement("span");
    holder.innerHTML = ICON[name] || ICON.more;
    return holder.firstElementChild;
  }

  let counter = 0;

  /* The speech bubble with a "y", on a violet-to-pink gradient. */
  function logo() {
    const id = `yg${++counter}`;
    const holder = document.createElement("span");
    holder.innerHTML = `<svg viewBox="0 0 64 64" aria-hidden="true" focusable="false"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8b6cff"/><stop offset="1" stop-color="#ff4f9a"/></linearGradient></defs>
      <path d="M32 5C16.500 5 5 15.500 5 29.500c0 13.500 10.700 23.500 25.500 23.500 3.300 0 6.300-.5 9-1.500L53 59l-2.800-12C55.800 42.800 59 36.500 59 29.500 59 15.500 47.500 5 32 5z" fill="url(#${id})"/>
      <path d="M20 21l12 14 12-14M32 35l-7 13" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    return holder.firstElementChild;
  }

  window.YipiIcons = { icon, logo, names: Object.keys(ICON) };
})();
