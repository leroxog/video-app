/* gomat art: the icons and the four characters (Gomi the monkey, Onkel Otto, Bruder Ben and the robot Robi).
   All of it is original artwork drawn in code: shaded with gradients and highlights so they look rounded, almost
   like little 3D figures. The characters carry class names (ch-bob, ch-blink, ch-look, ...) that gomat.css animates
   (the pupils follow the pointer through the custom properties --lx and --ly); moods are happy, cheer and sad;
   a scene gives a character something to do next to the path. */
(function () {
  "use strict";

  // ------------------------------------------------------------------ icons
  const S = (inner, extra = "") => `<svg viewBox="0 0 24 24" ${extra} aria-hidden="true">${inner}</svg>`;
  const LINE = 'fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"';
  const BOLD = LINE.replace("2.6", "3.4");
  const FILL = 'fill="currentColor"';
  const ICON = {
    star: S('<path d="M12 2.6l2.8 5.9 6.4.9-4.7 4.5 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4-4.7-4.5 6.4-.9z"/>', 'fill="currentColor" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"'),
    check: S('<path d="M5 12.5l4.6 4.6L19 7.4"/>', LINE.replace("2.6", "3.6")),
    close: S('<path d="M6 6l12 12M18 6L6 18"/>', LINE.replace("2.6", "3")),
    lock: S('<rect x="5" y="10.5" width="14" height="10" rx="3" fill="currentColor"/><path d="M8.2 10.5V8a3.8 3.8 0 017.6 0v2.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>'),
    trophy: S('<path d="M7.5 3.5h9v5.5a4.5 4.5 0 01-9 0z" fill="currentColor"/><path d="M7.5 5.5H4.5V7c0 2 1.3 3.3 3 3.5M16.5 5.5h3V7c0 2-1.3 3.3-3 3.5M12 13.5v4M9.5 17.5h5M8.5 20.5h7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>'),
    flame: S('<path d="M12 2.5c.4 3-1.6 4.4-3.1 6.2C7.5 10.4 6.5 12 6.5 14.3a5.5 5.5 0 0011 0c0-2-.9-3.4-1.8-4.4-.3 1.1-1 1.9-1.9 2.2.4-3-.2-6.6-1.9-9.6z"/>', FILL),
    heart: S('<path d="M12 20.6s-7.6-4.6-9.7-9.3C.8 7.9 3 4.2 6.6 4.2c2 0 3.5 1 5.4 3 1.9-2 3.4-3 5.4-3 3.6 0 5.8 3.700 4.300 7.100-2.100 4.700-9.700 9.300-9.700 9.300z"/>', FILL),
    gem: S('<path d="M12 2.4l8.2 4.700v9.800L12 21.600l-8.200-4.700V7.100z"/><path d="M12 2.400v9.300M3.800 7.100L12 11.700l8.200-4.600M12 11.700v9.900" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="1.400" stroke-linejoin="round"/>', FILL),
    bolt: S('<path d="M13.5 2L4.5 13.5H10L9 22l9.500-12H13z"/>', FILL),
    plus: S('<path d="M12 5v14M5 12h14"/>', BOLD),
    minus: S('<path d="M5 12h14"/>', BOLD),
    plusminus: S('<path d="M12 4v9M7.500 8.500h9M7 20h10"/>', LINE.replace("2.6", "3.2")),
    times: S('<path d="M6 6l12 12M18 6L6 18"/>', BOLD),
    divide: S('<path d="M5 12h14"/><circle cx="12" cy="5.600" r="1.800" fill="currentColor" stroke="none"/><circle cx="12" cy="18.400" r="1.800" fill="currentColor" stroke="none"/>', LINE.replace("2.6", "3.2")),
    pie: S('<circle cx="12" cy="12" r="8.500" fill="none" stroke="currentColor" stroke-width="2.600"/><path d="M12 12V3.500A8.500 8.500 0 0120.500 12z"/>', FILL),
    decimal: S('<text x="12" y="17" font-size="13" font-weight="900" text-anchor="middle" fill="currentColor" font-family="Nunito, sans-serif">0,5</text>'),
    percent: S('<path d="M18.500 5.500l-13 13" fill="none" stroke="currentColor" stroke-width="2.800" stroke-linecap="round"/><circle cx="7" cy="7" r="2.800" fill="currentColor"/><circle cx="17" cy="17" r="2.800" fill="currentColor"/>'),
    x: S('<text x="12" y="18" font-size="19" font-weight="900" text-anchor="middle" fill="currentColor" font-family="Nunito, sans-serif">x</text>'),
    ruler: S('<rect x="2.500" y="8" width="19" height="8" rx="2" transform="rotate(-35 12 12)" fill="currentColor"/><path d="M8 10.600l1.500 1.200M11 8.500l1 1.400M14 6.400l1.500 1.200" stroke="#fff" stroke-width="1.300" stroke-linecap="round" opacity=".8"/>'),
    book: S('<path d="M12 6.500C10.500 5 8 4.500 4.500 4.800V18c3.500-.3 6 .2 7.500 1.700 1.500-1.500 4-2 7.500-1.700V4.800C16 4.500 13.500 5 12 6.500z"/><path d="M12 6.500v13"/>', LINE),
    home: S('<path d="M3.500 11.200L12 3.800l8.500 7.400M5.800 9.800V20h12.400V9.800"/><path d="M10 20v-5h4v5"/>', LINE),
    dumbbell: S('<path d="M6.500 8v8M17.500 8v8M3.500 10v4M20.500 10v4M6.500 12h11"/>', LINE),
    medal: S('<circle cx="12" cy="14.500" r="5.500"/><path d="M8.500 3l3.500 6 3.500-6" fill="none" stroke="currentColor" stroke-width="2.600" stroke-linecap="round" stroke-linejoin="round"/>', FILL),
    crown: S('<path d="M3.500 8.500l4.500 4 4-7 4 7 4.500-4-1.600 10H5.100z"/>', FILL),
    shield: S('<path d="M12 3l7.500 2.800v5.700c0 4.600-3.100 8.100-7.500 9.700-4.400-1.600-7.500-5.100-7.500-9.700V5.800z"/><path d="M8.500 12l2.600 2.600 4.600-5"/>', LINE),
    user: S('<circle cx="12" cy="8" r="4"/><path d="M4.500 20.500c.8-4 3.700-6 7.500-6s6.700 2 7.500 6"/>', LINE),
    sound: S('<path d="M4 9.500h3.500L12 5.500v13l-4.500-4H4z" fill="currentColor"/><path d="M15.500 9a4 4 0 010 6M18 6.500a7.500 7.500 0 010 11" fill="none" stroke="currentColor" stroke-width="2.200" stroke-linecap="round"/>'),
    mute: S('<path d="M4 9.500h3.500L12 5.500v13l-4.500-4H4z" fill="currentColor"/><path d="M16 9.500l5 5M21 9.500l-5 5" fill="none" stroke="currentColor" stroke-width="2.200" stroke-linecap="round"/>'),
    target: S('<circle cx="12" cy="12" r="8.500" fill="none" stroke="currentColor" stroke-width="2.600"/><circle cx="12" cy="12" r="4.500" fill="none" stroke="currentColor" stroke-width="2.600"/><circle cx="12" cy="12" r="1.500" fill="currentColor"/>'),
    clock: S('<circle cx="12" cy="12" r="8.500" fill="none" stroke="currentColor" stroke-width="2.600"/><path d="M12 7v5.500l3.500 2" fill="none" stroke="currentColor" stroke-width="2.600" stroke-linecap="round"/>'),
    arrow: S('<path d="M12 5v13M6.500 12.500L12 18l5.500-5.500"/>', LINE),
    mic: S('<rect x="8.700" y="2.800" width="6.600" height="11.500" rx="3.300" fill="currentColor"/><path d="M5.500 11.500a6.500 6.500 0 0013 0M12 18v3.200M8.500 21.200h7" fill="none" stroke="currentColor" stroke-width="2.400" stroke-linecap="round"/>'),
    bag: S('<path d="M5.200 8.200h13.600l-1.300 12.100H6.500z" fill="currentColor"/><path d="M8.800 10V7.200a3.200 3.200 0 016.400 0V10" fill="none" stroke="currentColor" stroke-width="2.200" stroke-linecap="round"/>'),
    cap: S('<path d="M12 4L2 9l10 5 10-5z" fill="currentColor"/><path d="M6 12v4.200c0 1.500 2.700 3 6 3s6-1.500 6-3V12M22 9v6" fill="none" stroke="currentColor" stroke-width="2.200" stroke-linecap="round"/>'),
    snow: S('<path d="M12 3v18M4.200 7.500l15.600 9M19.800 7.500L4.200 16.500M9 4.800l3 2.200 3-2.200M9 19.200l3-2.200 3 2.200"/>', LINE.replace("2.6", "2.300")),
    skip: S('<path d="M5 6l7 6-7 6zM13 6l7 6-7 6z"/>', 'fill="currentColor" stroke="currentColor" stroke-width="1.600" stroke-linejoin="round"'),
    eye: S('<path d="M2.500 12S6 5.500 12 5.500 21.500 12 21.500 12 18 18.500 12 18.500 2.500 12 2.500 12z" fill="none" stroke="currentColor" stroke-width="2.400" stroke-linejoin="round"/><circle cx="12" cy="12" r="3.200" fill="currentColor"/>'),
    eyeoff: S('<path d="M3.500 12S6.500 6.500 12 6.500c1.300 0 2.500.3 3.600.9M20.500 12s-3 5.500-8.500 5.500c-1.300 0-2.500-.3-3.600-.9M4 4l16 16" fill="none" stroke="currentColor" stroke-width="2.400" stroke-linecap="round" stroke-linejoin="round"/>'),
    back: S('<path d="M15 5l-7 7 7 7"/>', BOLD),
    cloud: S('<path d="M7 18.500a4.500 4.500 0 01-.6-8.900A6 6 0 0117.800 8.400 5 5 0 0117.500 18.500z"/>', FILL),
    mail: S('<rect x="3" y="5.500" width="18" height="13" rx="3" fill="none" stroke="currentColor" stroke-width="2.400"/><path d="M4 8l8 5.500L20 8" fill="none" stroke="currentColor" stroke-width="2.400" stroke-linecap="round" stroke-linejoin="round"/>'),
    logout: S('<path d="M10 4.500H6.500A2 2 0 004.500 6.500v11a2 2 0 002 2H10M15 8l4 4-4 4M19 12H9.500"/>', LINE),
    trash: S('<path d="M5 7h14M9.500 7V4.500h5V7M7 7l.8 12.500h8.400L17 7M10 11v5.500M14 11v5.500"/>', LINE),
    gift: S('<rect x="3.500" y="9" width="17" height="11" rx="2" fill="currentColor"/><path d="M12 9v11M3.500 13h17" stroke="#fff" stroke-width="2" opacity=".55"/><path d="M12 9C9.500 9 8 7.800 8 6.500S9 4.500 10.200 4.500C11.500 4.500 12 7 12 9zM12 9c2.500 0 4-1.200 4-2.500s-1-2-2.200-2C12.500 4.500 12 7 12 9z" fill="none" stroke="currentColor" stroke-width="2"/>'),
    /* The app's emblem: a monkey face on a blue tile (the same drawing as the app icons). */
    logo: S('<rect x="1.500" y="1.500" width="21" height="21" rx="6.500" fill="#1cb0f6"/><circle cx="6" cy="11.200" r="2.700" fill="#fff"/><circle cx="18" cy="11.200" r="2.700" fill="#fff"/><circle cx="12" cy="12.400" r="6.400" fill="#fff"/><ellipse cx="12" cy="14.200" rx="4.200" ry="3.600" fill="#cdeeff"/><circle cx="9.900" cy="11.200" r="1" fill="#1f3a4d"/><circle cx="14.100" cy="11.200" r="1" fill="#1f3a4d"/><path d="M10.200 15.700q1.800 1.500 3.600 0" fill="none" stroke="#1f3a4d" stroke-width="1" stroke-linecap="round"/>'),
  };

  function icon(name) {
    const holder = document.createElement("span");
    holder.style.display = "contents";
    holder.innerHTML = ICON[name] || ICON.star;
    return holder.firstElementChild;
  }

  // ------------------------------------------------------------- characters
  /* The drawings share a small kit: gradients that make flat shapes look round, a glossy eye whose pupil follows the
     pointer, and a soft shadow on the ground. Every drawing gets its own gradient names (u), because the same page
     shows many characters at once. */
  let counter = 0;
  const SHADOW = '<ellipse cx="60" cy="116" rx="30" ry="4.2" fill="#0b2a44" opacity=".16"/>';
  const radial = (id, light, base, dark, fx = ".35", fy = ".28") =>
    `<radialGradient id="${id}" cx="${fx}" cy="${fy}" r=".95"><stop offset="0" stop-color="${light}"/><stop offset=".55" stop-color="${base}"/><stop offset="1" stop-color="${dark}"/></radialGradient>`;
  const linear = (id, top, bottom, sideways = false) =>
    `<linearGradient id="${id}" x1="0" y1="0" x2="${sideways ? 1 : 0}" y2="${sideways ? 0 : 1}"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient>`;
  const gloss = (d, opacity = ".35", width = 3) => `<path d="${d}" fill="none" stroke="#fff" stroke-opacity="${opacity}" stroke-width="${width}" stroke-linecap="round"/>`;
  const url = (u, name) => `url(#${u}${name})`;

  /* A big glossy eye: white, iris, pupil and two sparkles. The part inside the white (ch-look) moves with the pointer. */
  function eye(cx, cy, r, iris) {
    const ry = r * 1.1;
    return `<g class="ch-blink"><ellipse cx="${cx}" cy="${cy}" rx="${r}" ry="${ry}" fill="#fff"/><ellipse cx="${cx}" cy="${cy}" rx="${r}" ry="${ry}" fill="none" stroke="#000" stroke-opacity=".14"/>
      <g class="ch-look"><circle cx="${cx}" cy="${cy + r * 0.05}" r="${r * 0.68}" fill="${iris}"/><circle cx="${cx}" cy="${cy + r * 0.05}" r="${r * 0.4}" fill="#1a110c"/>
      <circle cx="${cx + r * 0.26}" cy="${cy - r * 0.27}" r="${r * 0.22}" fill="#fff"/><circle cx="${cx - r * 0.22}" cy="${cy + r * 0.28}" r="${r * 0.1}" fill="#fff" opacity=".85"/></g></g>`;
  }

  const happyEyes = (cx1, cx2, y, width, stroke = "#2b1d14", lift = 7) =>
    `<path d="M${cx1 - width} ${y}q${width} -${lift} ${width * 2} 0M${cx2 - width} ${y}q${width} -${lift} ${width * 2} 0" fill="none" stroke="${stroke}" stroke-width="3.6" stroke-linecap="round"/>`;

  // ---- Gomi, the maths monkey: brown fur, a lighter face, a blue shirt with a plus.
  function gomi(mood, scene, u) {
    const cheer = mood === "cheer";
    const sad = mood === "sad";
    const defs = radial(`${u}fur`, "#c28a5e", "#8a5a3b", "#50301b") + radial(`${u}skin`, "#fff2e2", "#f6d2ad", "#dba980") + radial(`${u}ear`, "#f8c8ae", "#e8997c", "#c37760")
      + linear(`${u}shirt`, "#66d2ff", "#1286c4") + linear(`${u}hem`, "#1899d6", "#0d6a9c") + radial(`${u}badge`, "#ffffff", "#e9f7ff", "#b2d9f0") + linear(`${u}arm`, "#a5724c", "#6a4026", true)
      + linear(`${u}ban`, "#ffe36e", "#f2b705");
    const hand = (x, y) => `<circle cx="${x}" cy="${y}" r="7" fill="${url(u, "skin")}"/><path d="M${x - 3} ${y + 3}q3 2.5 6 0" fill="none" stroke="#c4946c" stroke-width="1.4" stroke-linecap="round"/>`;
    const arms = cheer
      ? `<ellipse cx="25" cy="70" rx="8.5" ry="14.5" transform="rotate(-32 25 70)" fill="${url(u, "arm")}"/><ellipse cx="95" cy="70" rx="8.5" ry="14.5" transform="rotate(32 95 70)" fill="${url(u, "arm")}"/>${hand(17, 57)}${hand(103, 57)}`
      : `<ellipse cx="31" cy="95" rx="8.5" ry="14" transform="rotate(14 31 95)" fill="${url(u, "arm")}"/>${hand(27, 107)}
         <g class="ch-wave"><ellipse cx="89" cy="95" rx="8.5" ry="14" transform="rotate(-14 89 95)" fill="${url(u, "arm")}"/>${hand(93, 107)}</g>`;
    const brows = sad ? '<path d="M41 45l13-5M79 45l-13-5" stroke="#3f2616" stroke-width="3.4" stroke-linecap="round"/>'
      : cheer ? '<path d="M42 41q6-5 12-1M66 40q6-4 12 1" fill="none" stroke="#3f2616" stroke-width="3.2" stroke-linecap="round"/>'
        : '<path d="M42 43q6-4 12-1M66 42q6-3 12 1" fill="none" stroke="#3f2616" stroke-width="3.2" stroke-linecap="round"/>';
    const eyes = cheer ? happyEyes(49, 71, 54, 6) : eye(49, 53, 6.4, "#6a4126") + eye(71, 53, 6.4, "#6a4126");
    const mouth = {
      happy: '<path d="M51 73q9 8 18 0" fill="none" stroke="#3f2616" stroke-width="3.2" stroke-linecap="round"/>',
      cheer: `<path d="M49 71q11 17 22 0z" fill="#5a1f1f"/><path d="M52 80q8-5 16 0q-8 5-16 0z" fill="#ff7a8a"/><path d="M52 71.5h16q-2 3.500-8 3.500t-8-3.500z" fill="#fff"/>`,
      sad: '<path d="M52 79q8-7 16 0" fill="none" stroke="#3f2616" stroke-width="3.2" stroke-linecap="round"/>',
    }[mood] || "";
    const tear = sad ? '<path class="ch-tear" d="M39 59c-3 4.500-3 8 0 9 3-1 3-4.500 0-9z" fill="#8fdcff" stroke="#4fb8ea" stroke-width=".8"/>' : "";
    const banana = scene === "banana"
      ? `<g class="ch-banana"><path d="M95 107q17-3 20-19q-7 13-23 11z" fill="${url(u, "ban")}" stroke="#c99200" stroke-width="1.5" stroke-linejoin="round"/><path d="M98 102q9-2 13-9" stroke="#fff" stroke-opacity=".55" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M113 88l2-3" stroke="#6e4a14" stroke-width="2.4" stroke-linecap="round"/></g>` : "";
    return `<defs>${defs}</defs>${SHADOW}<g class="ch-bob">
      <path class="ch-tail" d="M84 105c25 5 29-21 15-28" fill="none" stroke="${url(u, "fur")}" stroke-width="7.5" stroke-linecap="round"/>
      <ellipse cx="47" cy="113" rx="11" ry="5.5" fill="${url(u, "skin")}"/><ellipse cx="73" cy="113" rx="11" ry="5.5" fill="${url(u, "skin")}"/>
      <path d="M41 114.500q1-2 2.500-1M47 115q.5-2.500 2-1.500M53 114.500q.5-2 2-1M67 114.500q-1-2-2.500-1M73 115q-.5-2.500-2-1.500M79 114.500q-.5-2-2-1" stroke="#c4946c" stroke-width="1.2" fill="none" stroke-linecap="round"/>
      ${arms}
      <path d="M34 93q0-13 13-13h26q13 0 13 13v13q0 6-6 6H40q-6 0-6-6z" fill="${url(u, "shirt")}"/>
      <path d="M34 104h52v2q0 6-6 6H40q-6 0-6-6z" fill="${url(u, "hem")}"/>
      <path d="M82 84q6 4 6 14v8q0 6-6 6" fill="#000" opacity=".08"/>
      ${gloss("M39 93q1-8 10-10", ".5", 3.4)}
      <circle cx="60" cy="98" r="8.600" fill="#0b4a73" opacity=".18"/><circle cx="60" cy="96.500" r="8.200" fill="${url(u, "badge")}"/>
      <path d="M60 91.500v10M55 96.500h10" stroke="#1cb0f6" stroke-width="3.400" stroke-linecap="round"/>
      <ellipse cx="60" cy="83" rx="15" ry="5" fill="#2b150a" opacity=".22"/>
      <g class="ch-ear"><circle cx="27" cy="50" r="12.500" fill="${url(u, "fur")}"/><circle cx="27" cy="50" r="7.400" fill="${url(u, "ear")}"/><ellipse cx="24.500" cy="46.500" rx="2.600" ry="1.600" fill="#fff" opacity=".4"/></g>
      <g class="ch-ear"><circle cx="93" cy="50" r="12.500" fill="${url(u, "fur")}"/><circle cx="93" cy="50" r="7.400" fill="${url(u, "ear")}"/><ellipse cx="90.500" cy="46.500" rx="2.600" ry="1.600" fill="#fff" opacity=".4"/></g>
      <circle cx="60" cy="50" r="33" fill="${url(u, "fur")}"/>
      <ellipse cx="46" cy="27" rx="13" ry="6" fill="#fff" opacity=".18" transform="rotate(-24 46 27)"/>
      <path class="ch-hair" d="M54 20q1-12 12-10" fill="none" stroke="#6e4528" stroke-width="5" stroke-linecap="round"/>
      <path d="M60 44C54 38 38 38 34 52C31 62 36 72 46 77C53 81 67 81 74 77C84 72 89 62 86 52C82 38 66 38 60 44Z" fill="${url(u, "skin")}"/>
      <ellipse cx="60" cy="69" rx="13.500" ry="9.800" fill="#fff6ea" opacity=".85"/>
      <ellipse cx="40.500" cy="65" rx="5.200" ry="3.400" fill="#ff8fa3" opacity=".42"/><ellipse cx="79.500" cy="65" rx="5.200" ry="3.400" fill="#ff8fa3" opacity=".42"/>
      ${brows}${eyes}${tear}
      <ellipse cx="56.500" cy="65.500" rx="1.700" ry="1.300" fill="#6e3f2a"/><ellipse cx="63.500" cy="65.500" rx="1.700" ry="1.300" fill="#6e3f2a"/>
      ${mouth}${banana}
    </g>`;
  }

  // ---- Onkel Otto: old and kind, round glasses, a big white moustache, an orange cardigan with a blue bow tie.
  function otto(mood, scene, u) {
    const cheer = mood === "cheer";
    const sad = mood === "sad";
    const defs = radial(`${u}skin`, "#ffe3c6", "#f2c9a2", "#d19b73") + linear(`${u}card`, "#f0a05a", "#b2602a") + radial(`${u}hair`, "#ffffff", "#eef1f5", "#c3ccd6")
      + linear(`${u}frame`, "#9a6a46", "#553523") + radial(`${u}bow`, "#7ad6ff", "#1cb0f6", "#1085bd") + radial(`${u}nose`, "#f4b9a0", "#e49f84", "#c9806a")
      + linear(`${u}lens`, "#e6f5ff", "#a9d9f7") + linear(`${u}arm`, "#d98a48", "#a35a27", true);
    const hand = (x, y) => `<circle cx="${x}" cy="${y}" r="6.800" fill="${url(u, "skin")}"/>`;
    const arms = cheer
      ? `<ellipse cx="25" cy="72" rx="8.800" ry="14.500" transform="rotate(-30 25 72)" fill="${url(u, "arm")}"/><ellipse cx="95" cy="72" rx="8.800" ry="14.500" transform="rotate(30 95 72)" fill="${url(u, "arm")}"/>${hand(17, 60)}${hand(103, 60)}`
      : `<ellipse cx="31" cy="96" rx="8.800" ry="14.500" transform="rotate(12 31 96)" fill="${url(u, "arm")}"/>${hand(28, 108)}<ellipse cx="89" cy="96" rx="8.800" ry="14.500" transform="rotate(-12 89 96)" fill="${url(u, "arm")}"/>${hand(92, 108)}`;
    const brows = sad
      ? `<ellipse cx="48" cy="37" rx="8.600" ry="3.600" fill="url(#${u}hair)" transform="rotate(-18 48 37)"/><ellipse cx="72" cy="37" rx="8.600" ry="3.600" fill="url(#${u}hair)" transform="rotate(18 72 37)"/>`
      : cheer ? `<ellipse cx="48" cy="35" rx="8.600" ry="3.600" fill="url(#${u}hair)" transform="rotate(-10 48 35)"/><ellipse cx="72" cy="35" rx="8.600" ry="3.600" fill="url(#${u}hair)" transform="rotate(10 72 35)"/>`
        : `<ellipse cx="48" cy="37" rx="8.600" ry="3.600" fill="url(#${u}hair)" transform="rotate(-6 48 37)"/><ellipse cx="72" cy="37" rx="8.600" ry="3.600" fill="url(#${u}hair)" transform="rotate(6 72 37)"/>`;
    const eyes = cheer ? happyEyes(48, 72, 51, 5, "#3a2a20", 5) : eye(48, 50, 4.8, "#7a5638") + eye(72, 50, 4.8, "#7a5638");
    const mouth = {
      happy: '<path d="M53 75q7 6 14 0" fill="none" stroke="#7a3b2e" stroke-width="2.6" stroke-linecap="round"/>',
      cheer: '<path d="M52 73q8 12 16 0z" fill="#7a2e2e"/>',
      sad: '<path d="M53 78q7-6 14 0" fill="none" stroke="#7a3b2e" stroke-width="2.6" stroke-linecap="round"/>',
    }[mood] || "";
    const paper = scene === "read"
      ? `<g class="ch-paper"><rect x="32" y="82" width="56" height="31" rx="3" fill="#fff" stroke="#cfd4d8" stroke-width="1.6"/><rect x="32" y="82" width="56" height="7" rx="3" fill="#dbe6ee"/><path d="M38 95h20M38 101h20M38 107h13M64 95h18M64 101h18M64 107h11" stroke="#9aa5ad" stroke-width="2.4" stroke-linecap="round"/><path d="M60 89v24" stroke="#cfd4d8" stroke-width="1.4"/>${hand(29, 103)}${hand(91, 103)}</g>` : "";
    const tea = scene === "tea"
      ? `<g class="ch-tea"><path class="ch-steam" d="M94 82q-4-5 0-9q4-4 0-9" fill="none" stroke="#c4cdd6" stroke-width="2.4" stroke-linecap="round"/><path class="ch-steam s2" d="M101 84q-4-5 0-9q4-4 0-9" fill="none" stroke="#c4cdd6" stroke-width="2.4" stroke-linecap="round"/><path d="M89 90h18v8a9 9 0 01-18 0z" fill="#fff" stroke="#cfd4d8" stroke-width="1.6"/><path d="M107 92h3a4 4 0 010 8h-3" fill="none" stroke="#cfd4d8" stroke-width="2.4"/></g>` : "";
    const lens = (cx) => `<circle cx="${cx}" cy="50" r="10.200" fill="${url(u, "lens")}" fill-opacity=".42"/><circle cx="${cx}" cy="50" r="10.200" fill="none" stroke="${url(u, "frame")}" stroke-width="2.800"/>${gloss(`M${cx - 6} ${46}q2-3.200 5-4`, ".85", 1.8)}`;
    return `<defs>${defs}</defs>${SHADOW}<g class="ch-bob">
      <ellipse cx="47" cy="113" rx="11.500" ry="5.500" fill="#4b2f20"/><ellipse cx="73" cy="113" rx="11.500" ry="5.500" fill="#4b2f20"/>
      <ellipse cx="44" cy="111" rx="5" ry="1.800" fill="#fff" opacity=".18"/><ellipse cx="70" cy="111" rx="5" ry="1.800" fill="#fff" opacity=".18"/>
      ${arms}
      <path d="M33 95q0-15 14-15h26q14 0 14 15v13q0 6-6 6H39q-6 0-6-6z" fill="${url(u, "card")}"/>
      <path d="M81 85q7 4 7 14v9q0 6-6 6" fill="#000" opacity=".1"/>
      ${gloss("M38 96q1-9 10-12", ".4", 3.4)}
      <path d="M60 86v28" stroke="#8d4a1d" stroke-width="2.4"/>
      <path d="M50 80l10 14 10-14z" fill="#fff"/><path d="M50 80l10 14 10-14" fill="none" stroke="#dfe5ea" stroke-width="1"/>
      <path d="M51.500 82l8.500 4-8.500 4zM68.500 82l-8.500 4 8.500 4z" fill="${url(u, "bow")}"/><circle cx="60" cy="86" r="2.800" fill="#0e78ad"/><ellipse cx="58.600" cy="84.800" rx="1" ry=".7" fill="#fff" opacity=".7"/>
      <circle cx="65" cy="99" r="1.900" fill="#6b3a18"/><circle cx="65" cy="107" r="1.900" fill="#6b3a18"/>
      <rect x="37" y="98" width="11" height="9" rx="2" fill="#a35a27" opacity=".55"/><path d="M39 98l3 -3.500 3 3.500z" fill="#fff"/>
      ${paper}
      <ellipse cx="60" cy="81" rx="15" ry="5" fill="#2b150a" opacity=".2"/>
      <circle cx="31" cy="53" r="5.800" fill="${url(u, "skin")}"/><circle cx="89" cy="53" r="5.800" fill="${url(u, "skin")}"/>
      <circle cx="60" cy="50" r="29.500" fill="${url(u, "skin")}"/>
      <ellipse cx="50" cy="26" rx="13" ry="5.500" fill="#fff" opacity=".26" transform="rotate(-18 50 26)"/>
      <ellipse cx="33" cy="43" rx="7" ry="12" fill="${url(u, "hair")}" transform="rotate(-10 33 43)"/><ellipse cx="87" cy="43" rx="7" ry="12" fill="${url(u, "hair")}" transform="rotate(10 87 43)"/>
      <path d="M31 36q-3-6 1-9M89 36q3-6-1-9M50 22q10-6 21 0" fill="none" stroke="${url(u, "hair")}" stroke-width="3.400" stroke-linecap="round"/>
      <path d="M42 30q8-3 17-3" fill="none" stroke="#b6663a" stroke-opacity=".18" stroke-width="1.6" stroke-linecap="round"/><path d="M45 34q6-2 13-2" fill="none" stroke="#b6663a" stroke-opacity=".14" stroke-width="1.4" stroke-linecap="round"/>
      ${brows}
      <path d="M37.500 55l-4 1.500M37.500 59l-3.500 3M82.500 55l4 1.500M82.500 59l3.500 3" fill="none" stroke="#b6764f" stroke-opacity=".5" stroke-width="1.3" stroke-linecap="round"/>
      ${eyes}
      ${lens(48)}${lens(72)}
      <path d="M58 49q2-2.500 4 0M38 48L33 50M82 48L87 50" fill="none" stroke="${url(u, "frame")}" stroke-width="2.400" stroke-linecap="round"/>
      <ellipse cx="38.500" cy="63" rx="4.800" ry="3.300" fill="#f08a8a" opacity=".42"/><ellipse cx="81.500" cy="63" rx="4.800" ry="3.300" fill="#f08a8a" opacity=".42"/>
      <ellipse cx="60" cy="59" rx="6" ry="5.200" fill="${url(u, "nose")}"/><ellipse cx="58.400" cy="57" rx="1.800" ry="1.200" fill="#fff" opacity=".5"/>
      ${mouth}
      <g class="ch-stache"><path d="M60 64.500c-4-3.500-9-3.500-13-1c-5 3-8 6-5.500 8.500c2.200 2.200 6.500-1.500 9-1.800c3.500-.4 6-.6 9.500-.6s6 .2 9.500.6c2.500.3 6.800 4 9 1.800c2.500-2.500-.5-5.500-5.500-8.500c-4-2.500-9-2.500-13 1z" fill="${url(u, "hair")}" stroke="#d0d7de" stroke-width=".9"/>
        <path d="M46 66q4 2 8 .5M74 66q-4 2-8 .5M44 69q5 1 9 -.5M76 69q-5 1-9 -.5" fill="none" stroke="#c3ccd6" stroke-width="1" stroke-linecap="round"/></g>
      ${tea}
    </g>`;
  }

  // ---- Bruder Ben: a cheerful big brother with messy ginger hair, a red hoodie and white sneakers.
  function ben(mood, scene, u) {
    const cheer = mood === "cheer";
    const sad = mood === "sad";
    const defs = radial(`${u}skin`, "#ffe4c8", "#f7d0a8", "#dba47c") + radial(`${u}hair`, "#f0a850", "#c97c2c", "#8a4f15") + linear(`${u}hood`, "#ff8e8e", "#d94545")
      + linear(`${u}hoodd`, "#f06060", "#c23a3a") + linear(`${u}arm`, "#ff7c7c", "#cf4040", true) + linear(`${u}shoe`, "#ffffff", "#d4dce3") + radial(`${u}ball`, "#ffc266", "#ff9600", "#c46a00");
    const hand = (x, y) => `<circle cx="${x}" cy="${y}" r="6.800" fill="${url(u, "skin")}"/>`;
    const arms = cheer
      ? `<ellipse cx="25" cy="72" rx="8.800" ry="14.500" transform="rotate(-30 25 72)" fill="${url(u, "arm")}"/><ellipse cx="95" cy="72" rx="8.800" ry="14.500" transform="rotate(30 95 72)" fill="${url(u, "arm")}"/>${hand(17, 60)}${hand(103, 60)}`
      : `<ellipse cx="31" cy="96" rx="8.800" ry="14.500" transform="rotate(12 31 96)" fill="${url(u, "arm")}"/><rect x="21" y="102" width="14" height="5" rx="2.500" fill="#c23a3a" transform="rotate(12 28 104)"/>${hand(28, 109)}
         <ellipse cx="89" cy="96" rx="8.800" ry="14.500" transform="rotate(-12 89 96)" fill="${url(u, "arm")}"/><rect x="85" y="102" width="14" height="5" rx="2.500" fill="#c23a3a" transform="rotate(-12 92 104)"/>${hand(92, 109)}`;
    const brows = sad ? '<path d="M41 44l14-5M79 44l-14-5" stroke="#8a4f15" stroke-width="3.400" stroke-linecap="round"/>'
      : cheer ? '<path d="M42 40q7-6 13 0M65 40q7-6 13 0" fill="none" stroke="#8a4f15" stroke-width="3.400" stroke-linecap="round"/>'
        : '<path d="M42 42q7-5 13 0M65 42q7-5 13 0" fill="none" stroke="#8a4f15" stroke-width="3.400" stroke-linecap="round"/>';
    const eyes = cheer ? happyEyes(48.500, 71.500, 53, 6.500, "#2b1d14", 8) : eye(49, 52, 6.800, "#3c7fb8") + eye(71, 52, 6.800, "#3c7fb8");
    const mouth = {
      happy: '<path d="M47 66q13 14 26 0z" fill="#7a2e2e"/><path d="M49.500 66.500h21q-2 4.500-10.500 4.500t-10.500-4.500z" fill="#fff"/>',
      cheer: '<path d="M45 65q15 21 30 0z" fill="#7a2e2e"/><path d="M52 77q8-6 16 0q-8 5-16 0z" fill="#ff7a8a"/><path d="M47 65.500h26q-3 5-13 5t-13-5z" fill="#fff"/>',
      sad: '<path d="M52 74q8-7 16 0" fill="none" stroke="#7a2e2e" stroke-width="3.400" stroke-linecap="round"/>',
    }[mood] || "";
    const tear = sad ? '<path class="ch-tear" d="M41 60c-3 4.500-3 8 0 9 3-1 3-4.500 0-9z" fill="#8fdcff" stroke="#4fb8ea" stroke-width=".8"/>' : "";
    const ball = scene === "ball"
      ? `<g class="ch-ball"><circle cx="103" cy="104" r="9.500" fill="${url(u, "ball")}"/><path d="M93.500 104h19M103 94.500v19M96.500 97.500q6.500 6.500 0 13M109.500 97.500q-6.500 6.500 0 13" stroke="#a85a00" stroke-width="1.400" fill="none"/><ellipse cx="99.500" cy="99.500" rx="3" ry="2" fill="#fff" opacity=".45"/></g>` : "";
    return `<defs>${defs}</defs>${SHADOW}<g class="ch-bob">
      <ellipse cx="46" cy="113" rx="11.500" ry="5.500" fill="${url(u, "shoe")}" stroke="#c9d2d9" stroke-width="1.200"/><ellipse cx="74" cy="113" rx="11.500" ry="5.500" fill="${url(u, "shoe")}" stroke="#c9d2d9" stroke-width="1.200"/>
      <path d="M38 113.500h15M67 113.500h15" stroke="#1cb0f6" stroke-width="2.600" stroke-linecap="round"/><path d="M38 116.500h16M66 116.500h16" stroke="#aeb9c2" stroke-width="1.600" stroke-linecap="round"/>
      ${arms}
      <path d="M33 95q0-15 14-15h26q14 0 14 15v13q0 6-6 6H39q-6 0-6-6z" fill="${url(u, "hood")}"/>
      <path d="M80 85q8 4 8 14v9q0 6-6 6" fill="#000" opacity=".1"/>
      ${gloss("M38 96q1-9 10-12", ".4", 3.400)}
      <path d="M43 80q17 16 34 0" fill="${url(u, "hoodd")}"/>
      <path d="M54 89v11M66 89v11" stroke="#fff" stroke-width="2.800" stroke-linecap="round"/><circle cx="54" cy="101.500" r="2" fill="#fff"/><circle cx="66" cy="101.500" r="2" fill="#fff"/>
      <path d="M43 106q17 5 34 0" stroke="#b83030" stroke-width="2.600" stroke-linecap="round" fill="none"/>
      <ellipse cx="60" cy="80.500" rx="15" ry="4.800" fill="#2b150a" opacity=".2"/>
      <circle cx="32" cy="54" r="4.800" fill="${url(u, "skin")}"/><circle cx="88" cy="54" r="4.800" fill="${url(u, "skin")}"/>
      <circle cx="60" cy="50" r="28.500" fill="${url(u, "skin")}"/>
      <path class="ch-hair" d="M30.500 47q-5-26 29.500-27q34.500 1 29.500 27q-5-9-15-12q-5 5-18 4q-14 1-26 8z" fill="${url(u, "hair")}"/>
      <path d="M49 25l3-12 5.500 8.500 6-10 3.500 12z" fill="${url(u, "hair")}"/>
      <path d="M40 30q8-6 18-6" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="3" stroke-linecap="round"/>
      ${brows}${eyes}${tear}
      <circle cx="44" cy="62" r="1.200" fill="#cc7f52"/><circle cx="49" cy="64" r="1.200" fill="#cc7f52"/><circle cx="71" cy="64" r="1.200" fill="#cc7f52"/><circle cx="76" cy="62" r="1.200" fill="#cc7f52"/><circle cx="46.500" cy="60.500" r="1" fill="#cc7f52"/><circle cx="73.500" cy="60.500" r="1" fill="#cc7f52"/>
      <ellipse cx="39.500" cy="63.500" rx="4.800" ry="3.200" fill="#ff8fa3" opacity=".42"/><ellipse cx="80.500" cy="63.500" rx="4.800" ry="3.200" fill="#ff8fa3" opacity=".42"/>
      <path d="M58.500 58q1.500 2 3 0" fill="none" stroke="#c98a62" stroke-width="1.400" stroke-linecap="round"/>
      ${mouth}${ball}
    </g>`;
  }

  // ---- Robi, the friendly robot: a screen for a face, a glowing antenna, a blue body with blinking lights.
  function robi(mood, scene, u) {
    const cheer = mood === "cheer";
    const sad = mood === "sad";
    const defs = radial(`${u}metal`, "#f3f8fc", "#b8cadb", "#7f95a9", ".3", ".22") + radial(`${u}orb`, "#fff6c2", "#ffc800", "#c98f00") + linear(`${u}body`, "#62cfff", "#1286c4")
      + radial(`${u}screen`, "#25405a", "#13222f", "#09111a", ".5", ".4") + linear(`${u}limb`, "#c9d8e5", "#8aa0b3", true) + radial(`${u}glow`, "#b6f4ff", "#4fd6f5", "#22a8cf")
      + radial(`${u}red`, "#ffc0c0", "#ff7a7a", "#d94c4c");
    const hand = (x, y) => `<circle cx="${x}" cy="${y}" r="5.800" fill="#6f879c"/><circle cx="${x - 1.500}" cy="${y - 1.500}" r="2" fill="#fff" opacity=".4"/>`;
    const arms = cheer
      ? `<rect x="13" y="62" width="9.500" height="25" rx="4.700" transform="rotate(-30 18 74)" fill="${url(u, "limb")}"/>${hand(14, 60)}<rect x="97.500" y="62" width="9.500" height="25" rx="4.700" transform="rotate(30 102 74)" fill="${url(u, "limb")}"/>${hand(106, 60)}`
      : `<rect x="23.500" y="86" width="9.500" height="23" rx="4.700" transform="rotate(8 28 86)" fill="${url(u, "limb")}"/>${hand(29, 111)}<rect x="87" y="86" width="9.500" height="23" rx="4.700" transform="rotate(-8 92 86)" fill="${url(u, "limb")}"/>${hand(91, 111)}`;
    const glow = sad ? url(u, "red") : url(u, "glow");
    const eyes = cheer
      ? '<path d="M42 56q6-12 12 0M66 56q6-12 12 0" fill="none" stroke="#7ee8ff" stroke-width="4.600" stroke-linecap="round"/>'
      : sad
        ? `<g class="ch-blink"><g class="ch-look"><rect x="42.500" y="47" width="11" height="12" rx="5.500" fill="${glow}"/><rect x="66.500" y="47" width="11" height="12" rx="5.500" fill="${glow}"/></g></g><path d="M40.500 49l14-5.500M79.500 49l-14-5.500" stroke="#ff8a8a" stroke-width="3" stroke-linecap="round"/>`
        : `<g class="ch-blink"><g class="ch-look"><rect x="42.500" y="43" width="11" height="15" rx="5.500" fill="${glow}"/><rect x="66.500" y="43" width="11" height="15" rx="5.500" fill="${glow}"/><rect x="45" y="45" width="3.600" height="5" rx="1.800" fill="#fff" opacity=".8"/><rect x="69" y="45" width="3.600" height="5" rx="1.800" fill="#fff" opacity=".8"/></g></g>`;
    const mouth = {
      happy: '<path d="M51 63q9 7 18 0" fill="none" stroke="#7ee8ff" stroke-width="3.400" stroke-linecap="round"/>',
      cheer: '<path d="M49 62q11 13 22 0z" fill="#7ee8ff"/>',
      sad: '<path d="M53 68q7-6 14 0" fill="none" stroke="#ff8a8a" stroke-width="3.400" stroke-linecap="round"/>',
    }[mood] || "";
    const gear = scene === "gear"
      ? '<g class="ch-gear"><circle cx="103" cy="102" r="10.500" fill="none" stroke="#ffc800" stroke-width="5" stroke-dasharray="4.600 3.200"/><circle cx="103" cy="102" r="7.200" fill="#ffc800"/><circle cx="103" cy="102" r="3" fill="#fff"/><circle cx="100.500" cy="99.500" r="1.800" fill="#fff" opacity=".6"/></g>' : "";
    return `<defs>${defs}</defs>${SHADOW}<g class="ch-bob">
      <rect x="39" y="109" width="18" height="8" rx="4" fill="#5d7488"/><rect x="63" y="109" width="18" height="8" rx="4" fill="#5d7488"/><rect x="41" y="110" width="9" height="2.400" rx="1.200" fill="#fff" opacity=".3"/><rect x="65" y="110" width="9" height="2.400" rx="1.200" fill="#fff" opacity=".3"/>
      ${arms}
      <rect x="34" y="82" width="52" height="31" rx="10" fill="${url(u, "body")}"/><rect x="34" y="104" width="52" height="9" rx="4.500" fill="#0f6fa3" opacity=".55"/>
      ${gloss("M39 91q1-6 8-8", ".5", 3.200)}
      <rect x="46" y="88" width="28" height="16" rx="4.500" fill="${url(u, "screen")}"/><rect x="46" y="88" width="28" height="16" rx="4.500" fill="none" stroke="#7ee8ff" stroke-opacity=".35"/>
      <circle class="ch-led l1" cx="54" cy="96" r="2.700" fill="#ff7a7a"/><circle class="ch-led l2" cx="60" cy="96" r="2.700" fill="#ffc800"/><circle class="ch-led l3" cx="66" cy="96" r="2.700" fill="#7ee8ff"/>
      <circle cx="38" cy="86" r="1.400" fill="#fff" opacity=".6"/><circle cx="82" cy="86" r="1.400" fill="#fff" opacity=".6"/><circle cx="38" cy="109" r="1.400" fill="#fff" opacity=".4"/><circle cx="82" cy="109" r="1.400" fill="#fff" opacity=".4"/>
      <rect x="52" y="75" width="16" height="9" rx="2.500" fill="${url(u, "limb")}"/><path d="M52 78h16M52 81h16" stroke="#6f879c" stroke-width="1"/>
      <g class="ch-ant"><line x1="60" y1="28" x2="60" y2="15" stroke="#8aa0b3" stroke-width="4" stroke-linecap="round"/><circle class="ch-bulb" cx="60" cy="12" r="6" fill="${url(u, "orb")}"/><circle cx="58" cy="10" r="2" fill="#fff" opacity=".8"/></g>
      <circle cx="24" cy="52" r="6.500" fill="${url(u, "metal")}"/><circle cx="24" cy="52" r="3" fill="#6f879c"/><circle cx="96" cy="52" r="6.500" fill="${url(u, "metal")}"/><circle cx="96" cy="52" r="3" fill="#6f879c"/>
      <rect x="27" y="28" width="66" height="50" rx="17" fill="${url(u, "metal")}" stroke="#7f95a9" stroke-width="2.600"/>
      ${gloss("M35 38q4-7 14-8", ".7", 3)}
      <rect x="35" y="36" width="50" height="34" rx="11" fill="${url(u, "screen")}"/>
      <rect x="35" y="36" width="50" height="34" rx="11" fill="none" stroke="#7ee8ff" stroke-opacity=".3" stroke-width="1.400"/>
      <rect class="ch-scan" x="37" y="38" width="46" height="3" rx="1.500" fill="#7ee8ff" opacity=".22"/>
      ${eyes}
      <ellipse cx="39.500" cy="64.500" rx="3.200" ry="2.200" fill="#ff9aa8" opacity=".75"/><ellipse cx="80.500" cy="64.500" rx="3.200" ry="2.200" fill="#ff9aa8" opacity=".75"/>
      ${mouth}${gear}
    </g>`;
  }

  const CAST = {
    gomi: { name: "Gomi", role: "der Mathe-Affe", draw: gomi, scene: "banana" },
    otto: { name: "Onkel Otto", role: "alt und nett", draw: otto, scene: "read" },
    ben: { name: "Bruder Ben", role: "der große Bruder", draw: ben, scene: "ball" },
    robi: { name: "Robi", role: "der Roboter", draw: robi, scene: "gear" },
  };

  /* The whole character as SVG markup. `scene` (optional) gives them something to do: the default scene of each
     character is CAST[name].scene. */
  function character(name, mood = "happy", scene = "") {
    const who = CAST[name] ? name : "gomi";
    const shown = ["happy", "cheer", "sad"].includes(mood) ? mood : "happy";
    const body = CAST[who].draw(shown, scene, `c${++counter}`);
    return `<svg viewBox="0 0 120 120" class="ch ch-${who} ch-${shown}" aria-hidden="true">${body}</svg>`;
  }

  /* Only the head and shoulders, for small round pictures. */
  function portrait(name, mood = "happy") {
    return character(name, mood).replace('viewBox="0 0 120 120"', 'viewBox="14 4 92 92"');
  }

  /* The daily treasure chest. Give its holder the class "open" and the lid swings up and the gems show. */
  function chest() {
    const u = `c${++counter}`;
    return `<svg viewBox="0 0 120 104" class="chest" aria-hidden="true"><defs>${linear(`${u}wood`, "#d98a3a", "#8a4a16")}${linear(`${u}lid`, "#f0a850", "#b8661f")}${linear(`${u}gold`, "#fff0a0", "#e6a800")}<radialGradient id="${u}glow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fff8c4" stop-opacity=".95"/><stop offset=".5" stop-color="#ffd54a" stop-opacity=".5"/><stop offset="1" stop-color="#ffd54a" stop-opacity="0"/></radialGradient>${radial(`${u}gem`, "#c8f2ff", "#1cb0f6", "#0d77ad")}</defs>
      <ellipse cx="60" cy="98" rx="42" ry="5" fill="#0b2a44" opacity=".18"/>
      <circle class="chest-glow" cx="60" cy="52" r="46" fill="${url(u, "glow")}"/>
      <g class="chest-gems"><circle cx="48" cy="52" r="8" fill="${url(u, "gem")}"/><circle cx="66" cy="49" r="9" fill="${url(u, "gem")}"/><circle cx="80" cy="54" r="7" fill="#ffd54a"/><path d="M44 49l4-4 4 4M62 46l4-4 4 4" stroke="#fff" stroke-opacity=".7" fill="none" stroke-width="1.600"/></g>
      <rect x="16" y="52" width="88" height="42" rx="8" fill="${url(u, "wood")}"/>
      <path d="M16 68h88M16 80h88" stroke="#6b3510" stroke-opacity=".35" stroke-width="1.600"/>
      <rect x="28" y="52" width="10" height="42" fill="${url(u, "gold")}"/><rect x="82" y="52" width="10" height="42" fill="${url(u, "gold")}"/>
      <rect x="52" y="58" width="16" height="18" rx="4" fill="${url(u, "gold")}" stroke="#b07d00" stroke-width="1.400"/><circle cx="60" cy="65" r="2.800" fill="#7a5200"/><rect x="58.800" y="66" width="2.400" height="6" rx="1.200" fill="#7a5200"/>
      <g class="chest-lid"><path d="M14 54q0-32 46-32t46 32z" fill="${url(u, "lid")}"/><rect x="28" y="24" width="10" height="30" fill="${url(u, "gold")}" transform="skewX(0)"/><rect x="82" y="24" width="10" height="30" fill="${url(u, "gold")}"/><path d="M26 38q8-12 24-14" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="3.400" stroke-linecap="round"/><rect x="14" y="50" width="92" height="6" rx="3" fill="#a35a16"/></g></svg>`;
  }

  window.GomatArt = { ICON, icon, character, portrait, chest, CAST };
})();
