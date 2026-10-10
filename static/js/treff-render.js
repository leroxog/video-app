/* Treff render: what a message looks like -- the parts of its text (links, server addresses that can be copied, bold, code, the numbers of
   other people) and the bubble with its answer, its reactions and its menu.  Everything is made of elements and text nodes; nothing a
   person wrote is ever put on the page as HTML. */
(function () {
  "use strict";

  const Core = window.TreffCore;
  const T = (window.Treff = window.Treff || {});
  const { h, put, icon, person, copyText, toast } = T;

  const REL = "noopener noreferrer nofollow ugc";

  async function copy(text, what = "Kopiert") {
    toast((await copyText(text)) ? `${what}: ${text.length > 60 ? `${text.slice(0, 59)}…` : text}` : "Das Kopieren hat nicht geklappt.");
  }

  /* Elements for the parts of a text (see TreffCore.parseMessage). */
  function renderParts(parts) {
    return parts.map((p) => {
      switch (p.type) {
        case "text": return p.value;
        case "break": return h("br");
        case "bold": return h("strong", {}, p.value);
        case "italic": return h("em", {}, p.value);
        case "code": return h("code", { class: "inline-code" }, p.value);
        case "link": return h("a", { class: "link", href: p.href, target: "_blank", rel: REL, title: p.href }, icon("external"), h("span", {}, Core.shortLink(p.value)));
        case "address": return h("button", { class: "chip-copy", type: "button", title: "Kopieren", "aria-label": `${p.value} kopieren`, onclick: () => copy(p.value) }, h("span", {}, p.value), icon("copy"));
        case "user": return h("span", { class: "mention", style: `color: ${Core.colorFor(`user ${p.number}`).soft}` }, Core.userName(p.number));
        case "quote": return h("blockquote", {}, renderParts(p.parts));
        case "codeblock": return h("div", { class: "codeblock" }, h("pre", {}, h("code", {}, p.value)), h("button", { class: "icon-btn small", type: "button", "aria-label": "Code kopieren", onclick: () => copy(p.value, "Code kopiert") }, icon("copy")));
        default: return "";
      }
    });
  }
  const renderText = (text) => renderParts(Core.parseMessage(text));

  /* The bubble of one message.  ctx: {me (number), open(menu anchor, message), reply(message), jump(id), react(message, emoji)} */
  function messageEl(message, ctx, continued = false) {
    const mine = message.mine;
    const el = h("div", { class: `msg${mine ? " mine" : ""}${message.important ? " important" : ""}${message.deleted ? " deleted" : ""}${continued ? " cont" : ""}`, "data-id": String(message.id), id: `m${message.id}` });
    const bubble = h("div", { class: "bubble" });
    if (!continued && !mine) put(bubble, h("div", { class: "msg-head" }, person(message.user)));
    if (message.important) put(bubble, h("div", { class: "tag-important" }, icon("flag"), h("span", {}, "Wichtig!")));
    if (message.replyTo) {
      const r = message.replyTo;
      put(bubble, h("button", { class: "reply-quote", type: "button", onclick: () => ctx.jump(r.id), "aria-label": `Zur Nachricht von ${Core.userName(r.user)}` }, person(r.user), h("span", {}, r.deleted ? "Nachricht gelöscht" : r.text)));
    }
    put(bubble, message.deleted ? h("div", { class: "msg-body deleted-text" }, "Diese Nachricht wurde gelöscht.") : h("div", { class: "msg-body" }, renderText(message.text)));
    const foot = h("div", { class: "msg-foot" }, h("span", { class: "time", title: new Date(message.time).toLocaleString("de-DE") }, Core.clock(message.time)));
    if (!message.deleted) put(foot, h("button", { class: "msg-more", type: "button", "aria-label": "Mehr zu dieser Nachricht", onclick: (e) => ctx.open(e.currentTarget, message) }, icon("more")));
    put(bubble, foot);
    put(el, bubble);
    if (message.reactions.length) {
      put(el, h("div", { class: "reactions" }, message.reactions.map((r) => h("button", { class: `reaction${r.mine ? " on" : ""}`, type: "button", "aria-pressed": String(r.mine), "aria-label": `${r.emoji} ${r.count}`, onclick: () => ctx.react(message, r.emoji) }, h("span", {}, r.emoji), h("b", {}, String(r.count))))));
    }
    return el;
  }

  Object.assign(T, { renderParts, renderText, messageEl, copy });
})();
