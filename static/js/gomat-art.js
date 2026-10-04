/* gomat art: the icons and the four characters (Gomi the monkey, Onkel Otto, Bruder Ben and the robot Robi).
   All of it is original artwork drawn in code. The characters carry class names (ch-bob, ch-blink, ...) that
   gomat.css animates; moods are happy, cheer and sad; a scene gives a character something to do next to the path. */
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
  const SKIN = "#f6d2ad";
  const INK = "#2b1d14";
  const SHADOW = '<ellipse cx="60" cy="116" rx="30" ry="4" fill="#000" opacity=".12"/>';

  /* Gomi, the maths monkey: brown fur, blue shirt with a plus. */
  function gomi(mood, scene) {
    const fur = "#8a5a3b";
    const raised = mood === "cheer";
    const arms = raised
      ? `<ellipse cx="25" cy="70" rx="8" ry="14" transform="rotate(-32 25 70)" fill="${fur}"/><ellipse cx="95" cy="70" rx="8" ry="14" transform="rotate(32 95 70)" fill="${fur}"/>
         <circle cx="17" cy="58" r="7" fill="${SKIN}"/><circle cx="103" cy="58" r="7" fill="${SKIN}"/>`
      : `<ellipse cx="31" cy="95" rx="8" ry="13" transform="rotate(14 31 95)" fill="${fur}"/><circle cx="27" cy="106" r="6.500" fill="${SKIN}"/>
         <g class="ch-wave"><ellipse cx="89" cy="95" rx="8" ry="13" transform="rotate(-14 89 95)" fill="${fur}"/><circle cx="93" cy="106" r="6.500" fill="${SKIN}"/></g>`;
    const eyes = raised
      ? `<path d="M43 51q6-8 12 0M65 51q6-8 12 0" fill="none" stroke="${INK}" stroke-width="3.600" stroke-linecap="round"/>`
      : `<g class="ch-blink"><circle cx="49" cy="50" r="5.500" fill="${INK}"/><circle cx="71" cy="50" r="5.500" fill="${INK}"/><circle cx="50.800" cy="48.200" r="2" fill="#fff"/><circle cx="72.800" cy="48.200" r="2" fill="#fff"/></g>`;
    const brows = mood === "sad" ? `<path d="M41 44l13-4M79 44l-13-4" stroke="${INK}" stroke-width="3.200" stroke-linecap="round"/>` : "";
    const tear = mood === "sad" ? '<path class="ch-tear" d="M40 58c-3 4-3 7 0 8 3-1 3-4 0-8z" fill="#7fd3ff"/>' : "";
    const mouth = {
      happy: `<path d="M50 74q10 8 20 0" fill="none" stroke="${INK}" stroke-width="3.400" stroke-linecap="round"/>`,
      cheer: `<path d="M47 72q13 20 26 0z" fill="${INK}"/><path d="M53 81q7-5 14 0q-7 5-14 0z" fill="#ff7a8a"/>`,
      sad: `<path d="M51 80q9-8 18 0" fill="none" stroke="${INK}" stroke-width="3.400" stroke-linecap="round"/>`,
    }[mood] || "";
    const banana = scene === "banana"
      ? '<g class="ch-banana"><path d="M96 104q16-2 18-16q-6 10-22 8z" fill="#ffd54a" stroke="#d9a400" stroke-width="1.600" stroke-linejoin="round"/></g>' : "";
    return `${SHADOW}<g class="ch-bob">
      <path class="ch-tail" d="M84 104c24 5 28-20 15-27" fill="none" stroke="${fur}" stroke-width="7" stroke-linecap="round"/>
      <ellipse cx="47" cy="112" rx="10" ry="5" fill="${SKIN}"/><ellipse cx="73" cy="112" rx="10" ry="5" fill="${SKIN}"/>
      ${arms}
      <path d="M34 93q0-13 13-13h26q13 0 13 13v13q0 6-6 6H40q-6 0-6-6z" fill="#1cb0f6"/>
      <path d="M34 104h52v2q0 6-6 6H40q-6 0-6-6z" fill="#1899d6"/>
      <path d="M60 89v14M53 96h14" stroke="#fff" stroke-width="3.400" stroke-linecap="round"/>
      <path d="M55 20q1-11 10-10" fill="none" stroke="${fur}" stroke-width="5" stroke-linecap="round"/>
      <circle cx="27" cy="50" r="12" fill="${fur}"/><circle cx="93" cy="50" r="12" fill="${fur}"/>
      <circle cx="27" cy="50" r="7" fill="#e9a97f"/><circle cx="93" cy="50" r="7" fill="#e9a97f"/>
      <circle cx="60" cy="50" r="33" fill="${fur}"/>
      <circle cx="49" cy="53" r="17" fill="${SKIN}"/><circle cx="71" cy="53" r="17" fill="${SKIN}"/><ellipse cx="60" cy="68" rx="21" ry="15" fill="${SKIN}"/>
      <ellipse cx="60" cy="71" rx="13" ry="9" fill="#ffe6cf"/>
      <circle cx="38" cy="66" r="4.500" fill="#ff9aa8" opacity=".5"/><circle cx="82" cy="66" r="4.500" fill="#ff9aa8" opacity=".5"/>
      ${eyes}${brows}${tear}
      <circle cx="56" cy="66" r="1.600" fill="${INK}"/><circle cx="64" cy="66" r="1.600" fill="${INK}"/>
      ${mouth}${banana}
    </g>`;
  }

  /* Onkel Otto: old and kind, round glasses, big white moustache, an orange cardigan with a blue bow tie. */
  function otto(mood, scene) {
    const cardigan = "#c9773a";
    const raised = mood === "cheer";
    const arms = raised
      ? `<ellipse cx="25" cy="72" rx="8.500" ry="14" transform="rotate(-30 25 72)" fill="${cardigan}"/><ellipse cx="95" cy="72" rx="8.500" ry="14" transform="rotate(30 95 72)" fill="${cardigan}"/>
         <circle cx="17" cy="60" r="6.500" fill="#f2c9a2"/><circle cx="103" cy="60" r="6.500" fill="#f2c9a2"/>`
      : `<ellipse cx="31" cy="96" rx="8.500" ry="14" transform="rotate(12 31 96)" fill="${cardigan}"/><circle cx="28" cy="108" r="6.500" fill="#f2c9a2"/>
         <ellipse cx="89" cy="96" rx="8.500" ry="14" transform="rotate(-12 89 96)" fill="${cardigan}"/><circle cx="92" cy="108" r="6.500" fill="#f2c9a2"/>`;
    const eyes = raised
      ? '<path d="M42 51q6-7 12 0M66 51q6-7 12 0" fill="none" stroke="#2b1d14" stroke-width="3.200" stroke-linecap="round"/>'
      : '<g class="ch-blink"><circle cx="48" cy="49" r="3" fill="#2b1d14"/><circle cx="72" cy="49" r="3" fill="#2b1d14"/><circle cx="49.200" cy="47.800" r="1" fill="#fff"/><circle cx="73.200" cy="47.800" r="1" fill="#fff"/></g>';
    const brows = mood === "sad"
      ? '<ellipse cx="48" cy="36.500" rx="8" ry="3.400" fill="#f3f3f3" transform="rotate(-18 48 36.500)"/><ellipse cx="72" cy="36.500" rx="8" ry="3.400" fill="#f3f3f3" transform="rotate(18 72 36.500)"/>'
      : '<ellipse cx="48" cy="37.500" rx="8" ry="3.400" fill="#f3f3f3" transform="rotate(-6 48 37.500)"/><ellipse cx="72" cy="37.500" rx="8" ry="3.400" fill="#f3f3f3" transform="rotate(6 72 37.500)"/>';
    const mouth = {
      happy: '<path d="M53 73q7 6 14 0" fill="none" stroke="#7a3b2e" stroke-width="2.600" stroke-linecap="round"/>',
      cheer: '<path d="M52 71q8 12 16 0z" fill="#7a2e2e"/>',
      sad: '<path d="M53 77q7-6 14 0" fill="none" stroke="#7a3b2e" stroke-width="2.600" stroke-linecap="round"/>',
    }[mood] || "";
    const paper = scene === "read"
      ? `<g class="ch-paper"><rect x="33" y="82" width="54" height="30" rx="3" fill="#fff" stroke="#cfd4d8" stroke-width="1.600"/><path d="M39 91h20M39 98h20M39 105h13M65 91h16M65 98h16M65 105h10" stroke="#9aa5ad" stroke-width="2.400" stroke-linecap="round"/><circle cx="29" cy="102" r="6.500" fill="#f2c9a2"/><circle cx="91" cy="102" r="6.500" fill="#f2c9a2"/></g>` : "";
    const tea = scene === "tea"
      ? `<g class="ch-tea"><path class="ch-steam" d="M94 82q-4-5 0-9q4-4 0-9" fill="none" stroke="#b9c3cc" stroke-width="2.400" stroke-linecap="round"/><path class="ch-steam s2" d="M101 84q-4-5 0-9q4-4 0-9" fill="none" stroke="#b9c3cc" stroke-width="2.400" stroke-linecap="round"/><path d="M89 90h18v8a9 9 0 01-18 0z" fill="#fff" stroke="#cfd4d8" stroke-width="1.600"/><path d="M107 92h3a4 4 0 010 8h-3" fill="none" stroke="#cfd4d8" stroke-width="2.400"/></g>` : "";
    return `${SHADOW}<g class="ch-bob">
      <ellipse cx="47" cy="113" rx="11" ry="5" fill="#5b3a29"/><ellipse cx="73" cy="113" rx="11" ry="5" fill="#5b3a29"/>
      ${arms}
      <path d="M33 95q0-15 14-15h26q14 0 14 15v13q0 6-6 6H39q-6 0-6-6z" fill="${cardigan}"/>
      <path d="M60 86v28" stroke="#a65f2b" stroke-width="2.400"/>
      <path d="M50 80l10 14 10-14z" fill="#fff"/>
      <path d="M52 82l8 4-8 4zM68 82l-8 4 8 4z" fill="#1cb0f6"/><circle cx="60" cy="86" r="2.400" fill="#1899d6"/>
      <circle cx="65" cy="99" r="1.800" fill="#7a4420"/><circle cx="65" cy="107" r="1.800" fill="#7a4420"/>
      ${paper}
      <circle cx="31" cy="53" r="5.500" fill="#f2c9a2"/><circle cx="89" cy="53" r="5.500" fill="#f2c9a2"/>
      <circle cx="60" cy="50" r="29" fill="#f2c9a2"/>
      <ellipse cx="33" cy="42" rx="6.500" ry="11" fill="#f3f3f3" transform="rotate(-10 33 42)"/><ellipse cx="87" cy="42" rx="6.500" ry="11" fill="#f3f3f3" transform="rotate(10 87 42)"/>
      <path d="M48 24q12-7 24 0" fill="none" stroke="#f3f3f3" stroke-width="3.200" stroke-linecap="round"/>
      <ellipse cx="52" cy="31" rx="6" ry="2.800" fill="#fff" opacity=".4" transform="rotate(-20 52 31)"/>
      ${brows}
      <circle cx="48" cy="49" r="9.500" fill="#fff" fill-opacity=".4" stroke="#6b5646" stroke-width="2.600"/><circle cx="72" cy="49" r="9.500" fill="#fff" fill-opacity=".4" stroke="#6b5646" stroke-width="2.600"/>
      <path d="M57.500 48q2.500-2.500 5 0M38.500 48L33.500 50M81.500 48L86.500 50" fill="none" stroke="#6b5646" stroke-width="2.300" stroke-linecap="round"/>
      ${eyes}
      <circle cx="38" cy="62" r="4.500" fill="#f08a8a" opacity=".5"/><circle cx="82" cy="62" r="4.500" fill="#f08a8a" opacity=".5"/>
      <ellipse cx="60" cy="58" rx="5.500" ry="4.600" fill="#e8a187"/>
      ${mouth}
      <g class="ch-stache"><ellipse cx="51" cy="66" rx="10.500" ry="5" fill="#f7f7f7" stroke="#e0e0e0" transform="rotate(12 51 66)"/><ellipse cx="69" cy="66" rx="10.500" ry="5" fill="#f7f7f7" stroke="#e0e0e0" transform="rotate(-12 69 66)"/></g>
      ${tea}
    </g>`;
  }

  /* Bruder Ben: a cheerful big brother with messy hair, a red hoodie and white sneakers. */
  function ben(mood, scene) {
    const hoodie = "#ff6b6b";
    const raised = mood === "cheer";
    const arms = raised
      ? `<ellipse cx="25" cy="72" rx="8.500" ry="14" transform="rotate(-30 25 72)" fill="${hoodie}"/><ellipse cx="95" cy="72" rx="8.500" ry="14" transform="rotate(30 95 72)" fill="${hoodie}"/>
         <circle cx="17" cy="60" r="6.500" fill="#f7d0a8"/><circle cx="103" cy="60" r="6.500" fill="#f7d0a8"/>`
      : `<ellipse cx="31" cy="96" rx="8.500" ry="14" transform="rotate(12 31 96)" fill="${hoodie}"/><circle cx="28" cy="108" r="6.500" fill="#f7d0a8"/>
         <ellipse cx="89" cy="96" rx="8.500" ry="14" transform="rotate(-12 89 96)" fill="${hoodie}"/><circle cx="92" cy="108" r="6.500" fill="#f7d0a8"/>`;
    const eyes = raised
      ? '<path d="M42 53q7-8 13 0M65 53q7-8 13 0" fill="none" stroke="#2b1d14" stroke-width="3.400" stroke-linecap="round"/>'
      : '<g class="ch-blink"><circle cx="49" cy="52" r="6.500" fill="#fff"/><circle cx="71" cy="52" r="6.500" fill="#fff"/><circle cx="50" cy="53" r="3.500" fill="#2b1d14"/><circle cx="72" cy="53" r="3.500" fill="#2b1d14"/><circle cx="51" cy="51.600" r="1.200" fill="#fff"/><circle cx="73" cy="51.600" r="1.200" fill="#fff"/></g>';
    const brows = mood === "sad"
      ? '<path d="M41 44l14-4M79 44l-14-4" stroke="#8a5a2b" stroke-width="3.400" stroke-linecap="round"/>'
      : mood === "cheer" ? '<path d="M42 40q7-6 13 0M65 40q7-6 13 0" fill="none" stroke="#8a5a2b" stroke-width="3.400" stroke-linecap="round"/>'
        : '<path d="M42 42q7-5 13 0M65 42q7-5 13 0" fill="none" stroke="#8a5a2b" stroke-width="3.400" stroke-linecap="round"/>';
    const mouth = {
      happy: '<path d="M47 66q13 14 26 0z" fill="#7a2e2e"/><path d="M49.500 66.500h21q-2 4.500-10.500 4.500t-10.500-4.500z" fill="#fff"/>',
      cheer: '<path d="M45 65q15 20 30 0z" fill="#7a2e2e"/><path d="M52 77q8-6 16 0q-8 5-16 0z" fill="#ff7a8a"/>',
      sad: '<path d="M52 74q8-7 16 0" fill="none" stroke="#7a2e2e" stroke-width="3.400" stroke-linecap="round"/>',
    }[mood] || "";
    const ball = scene === "ball"
      ? '<g class="ch-ball"><circle cx="103" cy="104" r="9" fill="#ff9600"/><path d="M94 104h18M103 95v18M97 98q6 6 0 12M109 98q-6 6 0 12" stroke="#c46f00" stroke-width="1.400" fill="none"/></g>' : "";
    return `${SHADOW}<g class="ch-bob">
      <ellipse cx="46" cy="113" rx="11" ry="5" fill="#fff" stroke="#d6d6d6" stroke-width="1.400"/><ellipse cx="74" cy="113" rx="11" ry="5" fill="#fff" stroke="#d6d6d6" stroke-width="1.400"/>
      <path d="M38 113h15M67 113h15" stroke="#1cb0f6" stroke-width="2.400" stroke-linecap="round"/>
      ${arms}
      <path d="M33 95q0-15 14-15h26q14 0 14 15v13q0 6-6 6H39q-6 0-6-6z" fill="${hoodie}"/>
      <path d="M43 80q17 15 34 0" fill="#e65353"/>
      <path d="M54 89v10M66 89v10" stroke="#fff" stroke-width="2.600" stroke-linecap="round"/>
      <path d="M44 106h32" stroke="#e65353" stroke-width="2.600" stroke-linecap="round"/>
      <circle cx="32" cy="54" r="4.500" fill="#f7d0a8"/><circle cx="88" cy="54" r="4.500" fill="#f7d0a8"/>
      <circle cx="60" cy="50" r="28" fill="#f7d0a8"/>
      <path d="M31 47q-4-25 29-26q33 1 29 26q-5-9-15-12q-5 5-18 4q-14 1-25 8z" fill="#c97c2c"/>
      <path d="M50 25l3-11 5 8 6-9 3 11z" fill="#c97c2c"/>
      ${brows}${eyes}
      <circle cx="44" cy="62" r="1.100" fill="#d98c5f"/><circle cx="49" cy="64" r="1.100" fill="#d98c5f"/><circle cx="71" cy="64" r="1.100" fill="#d98c5f"/><circle cx="76" cy="62" r="1.100" fill="#d98c5f"/>
      <circle cx="39" cy="63" r="4.500" fill="#ff9aa8" opacity=".5"/><circle cx="81" cy="63" r="4.500" fill="#ff9aa8" opacity=".5"/>
      ${mouth}${ball}
    </g>`;
  }

  /* Robi, the friendly robot: a screen for a face, a blinking antenna, a blue body with lights. */
  function robi(mood, scene) {
    const raised = mood === "cheer";
    const arms = raised
      ? '<rect x="14" y="62" width="9" height="24" rx="4.500" transform="rotate(-30 18 74)" fill="#a9bccd"/><circle cx="14" cy="60" r="5.500" fill="#6f879c"/><rect x="97" y="62" width="9" height="24" rx="4.500" transform="rotate(30 102 74)" fill="#a9bccd"/><circle cx="106" cy="60" r="5.500" fill="#6f879c"/>'
      : '<rect x="24" y="86" width="9" height="22" rx="4.500" transform="rotate(8 28 86)" fill="#a9bccd"/><circle cx="29" cy="110" r="5.500" fill="#6f879c"/><rect x="87" y="86" width="9" height="22" rx="4.500" transform="rotate(-8 92 86)" fill="#a9bccd"/><circle cx="91" cy="110" r="5.500" fill="#6f879c"/>';
    const eyes = raised
      ? '<path d="M42 55q6-11 12 0M66 55q6-11 12 0" fill="none" stroke="#5ce1ff" stroke-width="4.400" stroke-linecap="round"/>'
      : mood === "sad"
        ? '<g class="ch-blink"><rect x="43" y="47" width="10" height="11" rx="5" fill="#ff8a8a"/><rect x="67" y="47" width="10" height="11" rx="5" fill="#ff8a8a"/></g><path d="M41 49l13-5M79 49l-13-5" stroke="#ff8a8a" stroke-width="3" stroke-linecap="round"/>'
        : '<g class="ch-blink"><rect x="43" y="44" width="10" height="14" rx="5" fill="#5ce1ff"/><rect x="67" y="44" width="10" height="14" rx="5" fill="#5ce1ff"/></g>';
    const mouth = {
      happy: '<path d="M52 63q8 6 16 0" fill="none" stroke="#5ce1ff" stroke-width="3.200" stroke-linecap="round"/>',
      cheer: '<path d="M50 62q10 12 20 0z" fill="#5ce1ff"/>',
      sad: '<path d="M53 67q7-6 14 0" fill="none" stroke="#ff8a8a" stroke-width="3.200" stroke-linecap="round"/>',
    }[mood] || "";
    const gear = scene === "gear"
      ? '<g class="ch-gear"><circle cx="103" cy="102" r="10" fill="none" stroke="#ffc800" stroke-width="5" stroke-dasharray="4.600 3.200"/><circle cx="103" cy="102" r="7" fill="#ffc800"/><circle cx="103" cy="102" r="2.800" fill="#fff"/></g>' : "";
    return `${SHADOW}<g class="ch-bob">
      <rect x="40" y="110" width="16" height="7" rx="3.500" fill="#6f879c"/><rect x="64" y="110" width="16" height="7" rx="3.500" fill="#6f879c"/>
      ${arms}
      <rect x="34" y="82" width="52" height="30" rx="10" fill="#1cb0f6"/><rect x="34" y="104" width="52" height="8" rx="4" fill="#1899d6"/>
      <rect x="46" y="88" width="28" height="15" rx="4" fill="#16232f"/>
      <circle class="ch-led l1" cx="54" cy="95.500" r="2.600" fill="#ff7a7a"/><circle class="ch-led l2" cx="60" cy="95.500" r="2.600" fill="#ffc800"/><circle class="ch-led l3" cx="66" cy="95.500" r="2.600" fill="#5ce1ff"/>
      <rect x="53" y="76" width="14" height="8" rx="2" fill="#8aa0b3"/>
      <g class="ch-ant"><line x1="60" y1="28" x2="60" y2="15" stroke="#8aa0b3" stroke-width="4" stroke-linecap="round"/><circle class="ch-bulb" cx="60" cy="12" r="5.500" fill="#ffc800"/></g>
      <circle cx="24" cy="52" r="5.500" fill="#8aa0b3"/><circle cx="96" cy="52" r="5.500" fill="#8aa0b3"/>
      <rect x="27" y="28" width="66" height="50" rx="17" fill="#b8cadb" stroke="#8aa0b3" stroke-width="3"/>
      <rect x="35" y="36" width="50" height="34" rx="11" fill="#16232f"/>
      ${eyes}
      <circle cx="39.500" cy="64" r="2" fill="#ff9aa8" opacity=".85"/><circle cx="80.500" cy="64" r="2" fill="#ff9aa8" opacity=".85"/>
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
    const who = CAST[name] || CAST.gomi;
    const body = who.draw(["happy", "cheer", "sad"].includes(mood) ? mood : "happy", scene);
    return `<svg viewBox="0 0 120 120" class="ch ch-${name in CAST ? name : "gomi"} ch-${mood}" aria-hidden="true">${body}</svg>`;
  }

  /* Only the head and shoulders, for small round pictures. */
  function portrait(name, mood = "happy") {
    return character(name, mood).replace('viewBox="0 0 120 120"', 'viewBox="14 4 92 92"');
  }

  window.GomatArt = { ICON, icon, character, portrait, CAST };
})();
