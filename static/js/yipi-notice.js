/* Pulse notice (yipi-notice.js): the page shown on a computer instead of the app (the app is made for a phone held upright). It lists what this
   site knows about the visitor's own visit -- the address the request came from, the browser, the device -- and nothing else. The numbers come
   from the visitor's own request (GET /api/yipi/visitor) and from the browser itself; they are shown to that visitor only and are not stored.
   The button at the bottom does nothing, on purpose. Which screens count as "a computer" is decided by the style sheet (hover and fine pointer,
   at least 820 px wide); this script only starts once the notice is really shown. */
(function () {
  "use strict";

  const Core = window.YipiCore;
  const Api = window.YipiApi;
  const Y = window.Yipi;
  const box = document.getElementById("dnData");
  if (!box) return;

  const computer = matchMedia("(hover: hover) and (pointer: fine) and (min-width: 820px)");
  let started = false;

  const shown = () => computer.matches && !document.documentElement.classList.contains("force-app");

  /* What the browser tells about itself. */
  function clientInfo() {
    const nav = navigator;
    const link = nav.connection || {};
    let timezone = "";
    try { timezone = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (error) { timezone = ""; }
    const dnt = nav.doNotTrack || window.doNotTrack;
    return {
      platform: (nav.userAgentData && nav.userAgentData.platform) || nav.platform || "",
      languages: Array.from(nav.languages || (nav.language ? [nav.language] : [])),
      timezone,
      localTime: new Date().toLocaleString("de-DE"),
      screen: { width: screen.width, height: screen.height, ratio: window.devicePixelRatio, depth: screen.colorDepth },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      cores: nav.hardwareConcurrency,
      memory: nav.deviceMemory,
      touchPoints: nav.maxTouchPoints,
      pointer: matchMedia("(pointer: coarse)").matches ? "Touch" : "Maus oder Touchpad",
      colorScheme: matchMedia("(prefers-color-scheme: dark)").matches ? "dunkel" : "hell",
      cookies: nav.cookieEnabled,
      doNotTrack: dnt === "1" || dnt === "yes" ? "aktiv" : dnt === "0" || dnt === "no" ? "nicht aktiv" : "",
      online: nav.onLine,
      connection: { type: link.effectiveType, downlink: link.downlink, rtt: link.rtt, saveData: link.saveData },
    };
  }

  function table(section) {
    return Y.h("section", { class: "dn-section" },
      Y.h("h2", {}, section.title),
      Y.h("table", { class: "dn-table" }, Y.h("tbody", {}, section.rows.map(([label, value]) => Y.h("tr", {}, Y.h("th", { scope: "row" }, label), Y.h("td", {}, value))))));
  }

  async function start() {
    if (started || !shown()) return;
    started = true;
    let server = {};
    try {
      const reply = await Api.get("/visitor");
      if (reply.ok) server = reply.data.visitor || {};
    } catch (error) { server = {}; }
    server.referrer = document.referrer;
    let me = null;
    try { me = (JSON.parse(document.getElementById("yipiBoot").textContent) || {}).me || null; } catch (error) { me = null; }
    box.replaceChildren(...Core.visitorSections(server, clientInfo(), me).map(table));
  }

  computer.addEventListener?.("change", start);
  start();
})();
