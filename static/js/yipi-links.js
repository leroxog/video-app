/* Satürn links (yipi-links.js): a link in a post, a video, a comment or a chat gets a card (picture, title, text, site) and opens in a window of Satürn itself, so that nobody has to
   leave the page. `Y.linkCardFor(text)` makes the card for the first outside link in a text (or nothing), `Y.openSite(href)` opens the window.
   The server fetches the card and serves its pictures (yipi_links.py); the reader's browser never talks to the linked site until the window is opened. A page that forbids being
   shown in a frame (most big sites do) is not forced: the window then shows what the card knows and a button that opens the page in the browser. */
(function () {
  "use strict";

  const Y = window.Yipi;
  const Api = window.YipiApi;
  const Core = window.YipiCore;
  const { h, icon, put, fill, toast } = Y;

  const known = new Map();                                      // address -> the promise of its card (or null)

  const isOutside = (href) => { try { return new URL(href).origin !== location.origin; } catch (error) { return false; } };

  function fetchCard(href) {
    if (!known.has(href)) known.set(href, Api.get(Y.qs("/link-preview", { url: href })).then((reply) => (reply.ok ? reply.data : null)));
    return known.get(href);
  }

  /* The first link in a text that does not lead to Satürn itself. */
  function firstOutside(text) {
    if (!text) return null;
    for (const piece of Core.tokenize(text)) if (piece.type === "url" && isOutside(piece.href)) return piece.href;
    return null;
  }

  function cardBody(data, compact) {
    const picture = data.image ? h("span", { class: "lc-pic" }, h("img", { src: data.image, alt: "", loading: "lazy", decoding: "async", referrerpolicy: "no-referrer", onerror: (event) => event.target.parentNode.remove() })) : null;
    const site = h("span", { class: "lc-site" }, data.favicon ? h("img", { class: "lc-fav", src: data.favicon, alt: "", loading: "lazy", onerror: (event) => event.target.remove() }) : icon("link"), h("span", {}, data.site || data.domain));
    return [picture, h("span", { class: "lc-text" }, site, data.title ? h("b", { class: "lc-title" }, data.title) : null, data.description && !compact ? h("span", { class: "lc-desc" }, data.description) : null)];
  }

  /* The card of one address. It fills itself when the server answers and disappears when there is nothing to show (the link in the text stays). */
  function linkCard(href, options = {}) {
    const card = h("a", { class: `link-card${options.compact ? " compact" : ""}`, href, target: "_blank", rel: "noopener noreferrer nofollow ugc", hidden: true, "aria-label": "Link ansehen" });
    card.addEventListener("click", (event) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      event.stopPropagation();
      openSite(href);
    });
    fetchCard(href).then((data) => {
      if (!data) { card.remove(); return; }
      card.setAttribute("aria-label", `Link ansehen: ${data.title || data.domain}`);
      fill(card, ...cardBody(data, options.compact).filter(Boolean));
      card.hidden = false;
    });
    return card;
  }

  function linkCardFor(text, options) {
    const href = firstOutside(text);
    return href ? linkCard(href, options) : null;
  }

  // ------------------------------------------------------------------------------------------------ the window
  let open = null;

  function openSite(href) {
    if (open) open.close();
    const previous = document.activeElement;
    const title = h("b", { class: "sv-title" }, "Wird geladen …");
    const domain = h("span", { class: "sv-domain" });
    const body = h("div", { class: "sv-body" }, h("div", { class: "sv-wait" }, Y.pulseLoader ? Y.pulseLoader() : null));
    const outer = h("a", { class: "icon-btn sv-out", href, target: "_blank", rel: "noopener noreferrer nofollow ugc", "aria-label": "Im Browser öffnen", title: "Im Browser öffnen" }, icon("share"));
    const closeButton = h("button", { class: "icon-btn sv-close", type: "button", "aria-label": "Schließen", onclick: () => close() }, icon("close"));
    const copyButton = h("button", { class: "icon-btn sv-copy", type: "button", "aria-label": "Link kopieren", title: "Link kopieren", onclick: async () => {
      try { await navigator.clipboard.writeText(href); toast("Link kopiert."); } catch (error) { toast("Das Kopieren hat nicht geklappt."); }
    } }, icon("link"));
    const view = h("div", { class: "site-view", role: "dialog", "aria-modal": "true", "aria-label": "Webseite" },
      h("div", { class: "sv-bar" }, closeButton, h("div", { class: "sv-head" }, domain, title), copyButton, outer),
      body);
    const onKey = (event) => { if (event.key === "Escape") { event.preventDefault(); close(); } };
    function close() {
      if (!open || open.view !== view) return;
      document.removeEventListener("keydown", onKey, true);
      view.remove();
      document.documentElement.classList.remove("site-open");
      open = null;
      previous?.focus?.({ preventScroll: true });
    }
    open = { view, close };
    document.addEventListener("keydown", onKey, true);
    document.documentElement.classList.add("site-open");
    document.body.append(view);
    closeButton.focus({ preventScroll: true });

    try { domain.textContent = new URL(href).hostname.replace(/^www\./, ""); } catch (error) { domain.textContent = ""; }
    fetchCard(href).then((data) => {
      if (!view.isConnected) return;
      if (!data) {
        title.textContent = domain.textContent || "Webseite";
        fill(body, h("div", { class: "sv-fallback" }, h("h2", {}, "Diese Seite lässt sich hier nicht zeigen"), h("p", { class: "muted" }, "Sie antwortet nicht, oder Satürn darf sie nicht abrufen."),
          h("a", { class: "btn primary", href, target: "_blank", rel: "noopener noreferrer nofollow ugc" }, "Im Browser öffnen")));
        return;
      }
      title.textContent = data.title || data.domain;
      if (data.embeddable) {
        const frame = h("iframe", { class: "sv-frame", src: data.embed || data.url, title: data.title || data.domain, referrerpolicy: "no-referrer", loading: "eager",
          sandbox: "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-presentation", allow: "fullscreen; picture-in-picture; encrypted-media" });
        fill(body, h("div", { class: "sv-warn" }, icon("warn"), h("span", {}, `Das ist eine Seite von ${data.domain}, nicht von Satürn. Gib hier keine Passwörter ein, die du nicht dort benutzt.`)), frame);
        return;
      }
      fill(body, h("div", { class: "sv-fallback" },
        data.image ? h("img", { class: "sv-image", src: data.image, alt: "", referrerpolicy: "no-referrer", onerror: (event) => event.target.remove() }) : null,
        h("p", { class: "sv-site" }, data.site || data.domain),
        h("h2", {}, data.title || data.domain),
        data.description ? h("p", { class: "muted" }, data.description) : null,
        h("p", { class: "muted small" }, `${data.domain} erlaubt es nicht, die Seite in einem anderen Fenster zu zeigen. Du kannst sie im Browser öffnen.`),
        h("a", { class: "btn primary", href: data.url, target: "_blank", rel: "noopener noreferrer nofollow ugc" }, "Im Browser öffnen")));
    });
  }

  Object.assign(Y, { linkCard, linkCardFor, openSite });
  Y.links = { firstOutside, isOutside };
})();
