/* Nex icons (the file keeps the name yipi-icons.js): the small pictures of the page and the logo, drawn in code (all original).
   `YipiIcons.icon(name)` gives an <svg> element that takes the colour of the text around it; `YipiIcons.logo()` the heartbeat on its
   black tile. The only place in the page that uses innerHTML is here, for these fixed drawings. */
(function () {
  "use strict";

  const LINE = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
  const FILL = 'fill="currentColor"';
  const S = (inner, extra = LINE) => `<svg viewBox="0 0 24 24" ${extra} aria-hidden="true" focusable="false">${inner}</svg>`;

  /* The five symbols of the bar (and every other place that shows a house, a plane, a camera or a play button): one thick round line, same weight, same size. */
  const BOLD = LINE.replace('stroke-width="2"', 'stroke-width="2.4"');
  const SOLID = `${FILL} stroke="currentColor" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"`;
  const HOUSE = '<path d="M12 3.5L3.3 11.3h1.8v7.3a2.2 2.2 0 002.2 2.2h9.4a2.2 2.2 0 002.2-2.2v-7.3h1.8z"/>';
  const PLANE = '<path d="M21.2 3L3.2 10.6l6.5 2.5 2.6 7.8z"/>';
  const CAMERA = '<path d="M7.3 7.4l1.1-1.8a1.5 1.5 0 011.3-.7h4.6a1.5 1.5 0 011.3.7l1.1 1.8h1.7a2.4 2.4 0 012.4 2.4v7.4a2.4 2.4 0 01-2.4 2.4H5.6a2.4 2.4 0 01-2.4-2.4V9.8a2.4 2.4 0 012.4-2.4z"/>';
  const ICON = {
    home: S(HOUSE, BOLD),
    homeFill: S(HOUSE, SOLID),
    plane: S(PLANE + '<path d="M21.2 3L9.7 13.1"/>', BOLD),
    planeFill: S(PLANE, SOLID),                                                       // filled all over: no line through it when the chats are open
    camera: S(CAMERA + '<circle cx="12" cy="13.4" r="3.5"/><circle cx="17.5" cy="10.6" r=".4" fill="currentColor"/>', BOLD),
    cameraFill: S(CAMERA + '<circle class="cut" cx="12" cy="13.4" r="3.5" fill="none"/>', SOLID),
    playCircle: S('<circle cx="12" cy="12" r="9.2"/><path d="M10 8.4l5.7 3.6-5.7 3.6z"/>', BOLD),
    videoFill: S('<circle cx="12" cy="12" r="9.2"/><path class="cut-fill" d="M10 8.4l5.7 3.6-5.7 3.6z" stroke="none"/>', SOLID),
    qr: S('<rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1.6"/><rect x="14" y="3.5" width="6.5" height="6.5" rx="1.6"/><rect x="3.5" y="14" width="6.5" height="6.5" rx="1.6"/><path d="M14 14h2.6v2.6H14zM20.5 14v2.6M14 20.5h2.6M18.6 18.6h1.9v1.9h-1.9z"/>', BOLD),
    plusCircle: S('<circle cx="12" cy="12" r="9.2"/><path d="M12 7.7v8.6M7.7 12h8.6"/>', BOLD),
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
    volume: S('<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.500 8.500a5 5 0 010 7M19 6a8.500 8.500 0 010 12"/>'),
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
    sparkle: S('<path d="M11 3l1.900 5.600L18.500 10.500l-5.600 1.900L11 18l-1.900-5.600L3.500 10.500l5.600-1.900z"/><path d="M19 15l.8 2.200 2.200.8-2.200.8L19 21l-.8-2.200-2.200-.8 2.200-.8z"/>'),
    sparkleFill: S('<path d="M11 3l1.900 5.600L18.500 10.500l-5.600 1.900L11 18l-1.900-5.600L3.500 10.500l5.600-1.900z"/><path d="M19 15l.8 2.200 2.200.8-2.200.8L19 21l-.8-2.200-2.200-.8 2.200-.8z"/>', `${FILL} stroke="currentColor" stroke-width="1.600" stroke-linejoin="round"`),
    gif: S('<rect x="2.500" y="6" width="19" height="12" rx="3.500"/><path d="M10.500 10.600A2 2 0 009 10c-1.100 0-2 .9-2 2s.9 2 2 2c.7 0 1.300-.3 1.500-.8V12H9M12.800 10v4M15.500 14v-4h2.500M15.500 12h1.800"/>'),
    star: S('<path d="M12 3.500l2.600 5.400 5.900.8-4.300 4.100 1 5.800L12 16.800 6.800 19.600l1-5.800-4.300-4.100 5.900-.8z"/>'),
    starFill: S('<path d="M12 3.500l2.600 5.400 5.900.8-4.300 4.100 1 5.800L12 16.800 6.800 19.600l1-5.800-4.300-4.100 5.900-.8z"/>', `${FILL} stroke="currentColor" stroke-width="2" stroke-linejoin="round"`),
    text: S('<path d="M5 6.500V5h14v1.500M12 5v14M9 19h6"/>'),
    stop: S('<rect x="6" y="6" width="12" height="12" rx="2.500"/>', `${FILL} stroke="currentColor" stroke-width="2" stroke-linejoin="round"`),
    refresh: S('<path d="M20 11a8 8 0 10-2.300 6.300"/><path d="M20 4v7h-7"/>'),
    views: S('<path d="M5 20v-8M12 20V5M19 20v-5"/>'),
    poll: S('<rect x="3" y="4" width="14" height="4" rx="2"/><rect x="3" y="10" width="18" height="4" rx="2"/><rect x="3" y="16" width="9" height="4" rx="2"/>'),
    moreCircle: S('<circle cx="12" cy="12" r="9"/><circle cx="8" cy="12" r="1.100" fill="currentColor"/><circle cx="12" cy="12" r="1.100" fill="currentColor"/><circle cx="16" cy="12" r="1.100" fill="currentColor"/>'),
    pushpin: S('<path d="M9 4h6l-1 5 3 3v2H7v-2l3-3z"/><path d="M12 14v6"/>'),
    list: S('<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r="1" fill="currentColor"/><circle cx="4" cy="12" r="1" fill="currentColor"/><circle cx="4" cy="18" r="1" fill="currentColor"/>'),
    help: S('<circle cx="12" cy="12" r="9"/><path d="M9.500 9.500a2.500 2.500 0 114 2c-.9.6-1.500 1.100-1.500 2.200"/><circle cx="12" cy="17" r=".9" fill="currentColor"/>'),
    nexmark: S('<path d="M3.500 3.500L6.310 11.830A6 6 0 0 0 17.690 11.830L20.500 3.500"/><path d="M3.500 20.500L6.310 12.170A6 6 0 0 1 17.690 12.170L20.500 20.500"/>'),
    gamepad: S('<rect x="2.500" y="7" width="19" height="11" rx="5.500"/><path d="M8 10.500v4M6 12.500h4"/><circle cx="15.500" cy="11.500" r="1" fill="currentColor"/><circle cx="18" cy="14" r="1" fill="currentColor"/>'),
    usersFill: S('<circle cx="9" cy="8" r="3.500"/><path d="M2.500 20c.8-3.500 3.200-5.500 6.500-5.500s5.700 2 6.500 5.500z"/><path d="M16 4.800a3.500 3.500 0 010 6.400M18 14.800c2 .6 3.200 2.300 3.600 4.700" fill="none"/>', `${FILL} stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"`),
    menuLines: S('<path d="M5 9h14M5 15h9"/>'),
    arrowUp: S('<path d="M12 19V6M6.500 11.500L12 6l5.500 5.500"/>', LINE.replace('stroke-width="2"', 'stroke-width="2.400"')),
    warn: S('<path d="M12 4l9.500 16.500h-19z"/><path d="M12 10v4.500M12 17.500v.1"/>'),
    vol0: S('<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M3.500 3.500l17 17"/>'),
    vol1: S('<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.500 9.500a3.500 3.500 0 010 5"/>'),
    vol2: S('<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.500 8.500a5 5 0 010 7"/>'),
    vol3: S('<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.500 8.500a5 5 0 010 7M19 6a8.500 8.500 0 010 12"/>'),
    file: S('<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h6"/>'),
    hash: S('<path d="M9 4L7 20M17 4l-2 16M4 9h16M3.500 15h16"/>'),
    phone: S('<rect x="7" y="2.500" width="10" height="19" rx="2.500"/><path d="M11 18.500h2"/>'),
    google: S('<path d="M19.200 7.500A8.500 8.500 0 1 0 20.500 12H12"/>'),
    at: S('<circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 006 0v-1a10 10 0 10-4 8"/>'),
    mic: S('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.500 11.500a6.500 6.500 0 0013 0M12 18v3M9 21h6"/>'),
    micOff: S('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.500 11.500a6.500 6.500 0 0013 0M12 18v3M9 21h6"/><path d="M4 20L20 4"/>'),
    cameraOff: S('<path d="M7.300 7.400l1.100-1.800a1.500 1.500 0 011.300-.7h4.600a1.500 1.500 0 011.300.7l1.100 1.800h1.700a2.400 2.400 0 012.400 2.400v7.400a2.400 2.400 0 01-2.400 2.400H5.600a2.400 2.400 0 01-2.400-2.400V9.800a2.400 2.400 0 012.400-2.400z"/><circle cx="12" cy="13.400" r="3.500"/><path d="M4 20L20 4"/>'),
    flip: S('<path d="M4 9a8 8 0 0114-3l2 2M20 4v4h-4M20 15a8 8 0 01-14 3l-2-2M4 20v-4h4"/>'),
    sponsor: S('<rect x="3.500" y="3.500" width="17" height="17" rx="5"/><circle cx="12" cy="8" r="1.200" fill="currentColor" stroke="none"/><path d="M12 11.500v5"/>'),
    flame: S('<path d="M12 2.500c0 3.500-5.500 6-5.500 11a5.500 5.500 0 0011 0c0-2.500-1.200-4-2.300-5.200-.2 1.800-1 2.700-2 3C13.300 8.500 12.500 5.500 12 2.500z"/>'),
    trophy: S('<path d="M8 4h8v5a4 4 0 01-8 0V4zM8 6H5v1.500A3 3 0 008 10.500M16 6h3v1.500a3 3 0 01-3 3M12 13v4M8.500 20h7M10 17h4"/>'),
    download: S('<path d="M12 4v11M7.500 10.500L12 15l4.500-4.500M5 20h14"/>'),
    film: S('<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M8 4v16M16 4v16M3 9h5M3 15h5M16 9h5M16 15h5"/>'),
    imageOff: S('<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="1.600"/><path d="M3 17l5-5 4 4"/><path d="M4 20L20 4"/>'),
    users: S('<circle cx="9" cy="8" r="3.500"/><path d="M2.500 20c.8-3.500 3.200-5.500 6.500-5.500s5.700 2 6.500 5.500"/><path d="M16 4.800a3.500 3.500 0 010 6.400M18 14.800c2 .6 3.200 2.300 3.600 4.700"/>'),
  };

  function icon(name) {
    const holder = document.createElement("span");
    holder.innerHTML = ICON[name] || ICON.more;
    return holder.firstElementChild;
  }

  /* The heartbeat of Nex, white on a black tile (the same drawing as static/img/pulse-icon.svg). */
  function logo() {
    const holder = document.createElement("span");
    holder.innerHTML = `<svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <rect x="2.500" y="2.500" width="59" height="59" rx="16" fill="#000" stroke="#767676" stroke-width="1.500"/>
      <path d="M11.800 33.700L22.800 33.700L27.800 19.400L36.200 46.300L41.200 30.300L45.400 33.700L52.200 33.700" fill="none" stroke="#fff" stroke-width="5.500" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    return holder.firstElementChild;
  }

  /* The lettering "Nex": three letters drawn with fat round strokes, leaning forward a little; it takes the colour of the text around it. */
  function wordmark() {
    const holder = document.createElement("span");
    holder.innerHTML = `<svg viewBox="0 0 92 40" role="img" aria-label="Nex" focusable="false"><g transform="skewX(-7) translate(4 0)" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round" stroke-linejoin="round">
      <path d="M8 33V7l19 26V7"/><path d="M36 21h19a9.500 9.500 0 10-2.800 6.700"/><path d="M62 12l19 21M81 12L62 33"/></g></svg>`;
    return holder.firstElementChild;
  }

  window.YipiIcons = { icon, logo, wordmark, names: Object.keys(ICON) };
})();
