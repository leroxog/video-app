(function () {
  "use strict";

  var msgsEl = document.getElementById("nxMsgs");
  var emptyEl = document.getElementById("nxEmpty");
  var input = document.getElementById("nxInput");
  var sendBtn = document.getElementById("nxSend");
  var sidebar = document.getElementById("nxSidebar");
  var sidebarBackdrop = document.getElementById("nxSidebarBackdrop");
  var sidebarList = document.getElementById("nxSidebarList");
  var menuBtn = document.getElementById("nxMenuBtn");
  var newChatBtn = document.getElementById("nxNewChat");
  var busy = false;
  var activeChatId = window.NEX_CHAT_ID || null;
  var chats = window.NEX_CHATS || [];
  var openRowMenu = null;
  var versionBtn = document.getElementById("nxVersionBtn");
  var versionLabel = document.getElementById("nxVersionLabel");
  var versionMenu = document.getElementById("nxVersionMenu");
  var pendingPersona = null;
  var PERSONA_LABELS = { nex: "Nex", neo: "Neo" };
  // Every nexpreview artifact seen so far in the currently open chat, in
  // chronological order -- reset whenever a different chat's messages load
  // (see setChatArtifacts below). Powers the preview panel's version tabs:
  // a flat timeline across the whole chat, not semantic "same artifact,
  // revised" grouping (that would need the model to track a stable
  // artifact identity across turns -- unnecessary complexity for what the
  // user actually asked for: "click back to see how it looked before").
  var chatArtifacts = [];
  function resetChatArtifacts() { chatArtifacts = []; }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // marked doesn't sanitize its output (raw HTML in the source passes
  // through unchanged by design -- see its own README), so a prompt that
  // somehow gets Nex to echo back a <script>/onerror-bearing tag would
  // otherwise execute. DOMPurify strips anything but plain markup before
  // it ever reaches innerHTML.
  function renderMarkdown(text) {
    var html = window.marked ? window.marked.parse(text, { breaks: true, gfm: true }) : esc(text);
    return window.DOMPurify ? window.DOMPurify.sanitize(html) : esc(text);
  }

  function addCopyButtons(container) {
    container.querySelectorAll("pre").forEach(function (pre) {
      if (pre.querySelector(".nx-copybtn")) return;
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "nx-copybtn";
      btn.textContent = "Kopieren";
      pre.appendChild(btn);
    });
  }

  // Wires load/error handling for inline generated images (see
  // nexImageTag() above) -- attached via addEventListener, not inline
  // onerror=, since DOMPurify strips inline event-handler attributes.
  // On error (e.g. Pollinations' ~1 request/15s anonymous throttle), adds
  // a retry button that re-fetches with a cache-busting param.
  function wireGeneratedImages(container) {
    container.querySelectorAll(".nx-gen-image").forEach(function (img) {
      if (img._nxWired) return;
      img._nxWired = true;
      var baseSrc = img.src;
      img.addEventListener("load", function () {
        img.classList.remove("is-error");
        var retry = img.nextElementSibling;
        if (retry && retry.classList.contains("nx-gen-image-retry")) retry.remove();
      });
      img.addEventListener("error", function () {
        img.classList.add("is-error");
        if (img.nextElementSibling && img.nextElementSibling.classList.contains("nx-gen-image-retry")) return;
        var retry = document.createElement("button");
        retry.type = "button";
        retry.className = "nx-gen-image-retry";
        retry.textContent = "Bild konnte nicht geladen werden -- erneut versuchen";
        retry.addEventListener("click", function () {
          img.classList.remove("is-error");
          img.src = baseSrc + (baseSrc.indexOf("?") === -1 ? "?" : "&") + "retry=" + Date.now();
        });
        img.insertAdjacentElement("afterend", retry);
      });
    });
  }

  // ---------------- Nex Browser: artifact preview panel ----------------
  // See ai_assistant.py's _ARTIFACT_PROTOCOL for the model-side half of
  // this convention: a complete, self-contained HTML/CSS/JS artifact
  // comes back wrapped in a FOUR-backtick fence tagged
  // "nexpreview:<title>"; a generated-image request comes back the same
  // way tagged "neximage:<title>", its content just a short English image
  // prompt. Four backticks (not three) specifically so an ordinary ```
  // that happens to occur inside generated code (a JS template literal, a
  // comment) can never close the block early -- CommonMark's own rule for
  // exactly this problem.
  var NEXPREVIEW_RE = /````nexpreview[:\s]*([^\n]*)\n([\s\S]*?)\n````/g;
  var NEXIMAGE_RE = /````neximage[:\s]*([^\n]*)\n([\s\S]*?)\n````/g;
  var FENCE_KINDS = ["nexpreview", "neximage"];

  // Deterministic small hash so the same stored message always requests
  // the same image from Pollinations on every reload (its own seed
  // otherwise defaults to random per request).
  function stableSeed(str) {
    var h = 0;
    for (var i = 0; i < str.length; i++) { h = (h * 31 + str.charCodeAt(i)) >>> 0; }
    return h;
  }

  // Unlike a nexpreview artifact (always hidden behind the panel/chip),
  // a generated image is visible content like any other -- it renders
  // straight into the chat bubble. Built as a raw <img> tag spliced into
  // the markdown source (marked passes raw HTML through, DOMPurify then
  // sanitizes it -- same pipeline as any other message). Loading/error
  // handling is wired separately via wireGeneratedImages() using
  // addEventListener, since DOMPurify strips inline onerror= attributes.
  function nexImageTag(title, prompt) {
    var seed = stableSeed(title + "|" + prompt);
    var src = "https://image.pollinations.ai/prompt/" + encodeURIComponent(prompt)
      + "?width=1024&height=1024&nologo=true&seed=" + seed;
    return '<img class="nx-gen-image" src="' + src + '" alt="' + esc(title) + '">';
  }

  // Strips every complete nexpreview block out of `full` (never just the
  // first -- the model is told to send only one, but if it ever sends
  // more, none of them may leak into the chat) and returns the first as
  // `artifact`; replaces every complete neximage block with an inline
  // <img> tag. Also holds back a *possibly still-forming* nexpreview/
  // neximage opening fence at the very end of the string so a partial
  // marker (e.g. "```` nexpr") never flashes into the chat as a
  // wrongly-parsed plain code block while it's still streaming in
  // character by character -- a *confirmed* 3-backtick run can never
  // become either fence (which strictly requires 4), so those are left
  // alone and keep rendering progressively exactly as before.
  function splitPreview(full) {
    var artifact = null;
    var text = full.replace(NEXPREVIEW_RE, function (_m, title, code) {
      if (!artifact) artifact = { title: (title || "").trim() || "Vorschau", code: code };
      return "";
    });
    text = text.replace(NEXIMAGE_RE, function (_m, title, prompt) {
      var t = (title || "").trim() || "Bild";
      return nexImageTag(t, prompt.trim());
    });

    // `pending`: set once we're confidently inside a still-streaming
    // nexpreview/neximage block (info line has settled), so the panel can
    // open live and grow the code view chunk by chunk for a nexpreview
    // block -- see Phase B wiring in streamInto()'s pump(). A neximage
    // block's pending state has no panel to feed (images render inline
    // once complete, not in the side panel); it exists purely so the
    // still-forming fence stays held back from `text`. Left null while
    // the fence is merely ambiguous (could still turn out to be a plain
    // fence or something else) or once it has fully closed (handled
    // above instead).
    var pending = null;
    var runs = text.match(/`{3,}/g) || [];
    if (runs.length % 2 === 1) {
      var lastRun = runs[runs.length - 1];
      var openIdx = text.lastIndexOf(lastRun);
      var after = text.slice(openIdx + lastRun.length);
      var newlineIdx = after.indexOf("\n");
      var settled = newlineIdx !== -1;
      var infoSoFar = (settled ? after.slice(0, newlineIdx) : after).replace(/^[:\s]*/, "");
      var stillAmbiguousLength = lastRun.length === 3 && after === "";
      var settledKind = lastRun.length >= 4 && settled
        ? FENCE_KINDS.filter(function (k) { return new RegExp("^" + k + "\\b").test(infoSoFar); })[0]
        : null;
      var couldStillMatch = lastRun.length >= 4 && !settled
        && FENCE_KINDS.some(function (k) { return k.indexOf(infoSoFar.split(":")[0]) === 0; });
      if (stillAmbiguousLength || settledKind || couldStillMatch) {
        text = text.slice(0, openIdx);
        if (settledKind === "nexpreview") {
          var titlePart = infoSoFar.replace(/^nexpreview[:\s]*/, "").trim();
          pending = { kind: "nexpreview", title: titlePart || null, code: after.slice(newlineIdx + 1) };
        } else if (settledKind === "neximage") {
          pending = { kind: "neximage" };
        } else {
          pending = { kind: null, title: null, code: "" };
        }
      }
    }

    return { text: text.trim(), artifact: artifact, pending: pending };
  }

  var previewPanel = document.getElementById("nxPreview");
  var previewFrame = document.getElementById("nxPreviewFrame");
  var previewCode = document.getElementById("nxPreviewCode");
  var previewCodeText = document.getElementById("nxPreviewCodeText");
  var previewTitle = document.getElementById("nxPreviewTitle");
  var previewToggle = document.getElementById("nxPreviewToggle");
  var previewClose = document.getElementById("nxPreviewClose");
  var previewTabs = document.getElementById("nxPreviewTabs");
  var showingPreviewCode = false;
  var currentPreviewVersions = [];

  // Shown only when the open artifact has earlier versions in this chat
  // (e.g. "build me a game" followed later by "make it better") -- one
  // pill per version, click reopens it without losing any other version.
  function renderVersionTabs(versions, activeIndex) {
    currentPreviewVersions = versions || [];
    if (!previewTabs) return;
    if (currentPreviewVersions.length <= 1) {
      previewTabs.hidden = true;
      previewTabs.innerHTML = "";
      return;
    }
    previewTabs.hidden = false;
    previewTabs.innerHTML = currentPreviewVersions.map(function (v, i) {
      return '<button type="button" class="nx-preview-tab' + (i === activeIndex ? " is-active" : "") + '" data-index="' + i + '">V' + (i + 1) + "</button>";
    }).join("");
  }

  function openPreviewPanel(artifact, versions, index) {
    var allVersions = versions || chatArtifacts;
    var activeIndex = index != null ? index : allVersions.indexOf(artifact);
    previewTitle.textContent = artifact.title || "Vorschau";
    previewFrame.srcdoc = artifact.code;
    previewCodeText.textContent = artifact.code;
    showingPreviewCode = false;
    previewFrame.hidden = false;
    previewCode.hidden = true;
    previewToggle.hidden = false;
    previewToggle.textContent = "Code anzeigen";
    previewToggle.classList.remove("is-active");
    renderVersionTabs(allVersions, activeIndex);
    previewPanel.hidden = false;
  }

  // Live-streaming state (Phase B): while an artifact is still being
  // generated, show its growing source instead of a dead iframe (there's
  // no complete document to render yet) -- no preview/code toggle or
  // version tabs while this is going on, there's nothing to preview yet.
  function openPreviewLoading(pending) {
    previewTitle.textContent = pending.title || "Wird erstellt …";
    previewCodeText.textContent = pending.code;
    previewFrame.hidden = true;
    previewCode.hidden = false;
    previewToggle.hidden = true;
    if (previewTabs) previewTabs.hidden = true;
    previewPanel.hidden = false;
    previewCode.scrollTop = previewCode.scrollHeight;
  }

  previewClose.addEventListener("click", function () { previewPanel.hidden = true; });
  previewToggle.addEventListener("click", function () {
    showingPreviewCode = !showingPreviewCode;
    previewFrame.hidden = showingPreviewCode;
    previewCode.hidden = !showingPreviewCode;
    previewToggle.textContent = showingPreviewCode ? "Vorschau" : "Code anzeigen";
    previewToggle.classList.toggle("is-active", showingPreviewCode);
  });
  if (previewTabs) {
    previewTabs.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-index]");
      if (!btn) return;
      var i = Number(btn.dataset.index);
      openPreviewPanel(currentPreviewVersions[i], currentPreviewVersions, i);
    });
  }

  function appendPreviewChip(bubble, artifact) {
    bubble._nexArtifact = artifact;
    chatArtifacts.push(artifact);
    var index = chatArtifacts.length - 1;
    var chip = document.createElement("button");
    chip.type = "button";
    chip.className = "nx-preview-chip";
    chip.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>'
      + "<span>" + esc(artifact.title) + "</span>";
    chip.addEventListener("click", function () { openPreviewPanel(artifact, chatArtifacts, index); });
    bubble.appendChild(chip);
  }

  // The initial page load renders messages as plain escaped text
  // server-side (fast first paint, no client round-trip) -- upgrade them
  // to rendered markdown (and extract any artifact into a chip) once
  // marked/DOMPurify are available.
  resetChatArtifacts();
  msgsEl.querySelectorAll(".nx-bubble").forEach(function (b) {
    var split = splitPreview(b.textContent);
    b.innerHTML = renderMarkdown(split.text);
    addCopyButtons(b);
    wireGeneratedImages(b);
    if (split.artifact) appendPreviewChip(b, split.artifact);
  });

  function legacyCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    var ok = false;
    try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }

  msgsEl.addEventListener("click", function (e) {
    var btn = e.target.closest(".nx-copybtn");
    if (!btn) return;
    var code = btn.parentElement.querySelector("code");
    var text = code ? code.textContent : "";
    var flash = function (ok) {
      var orig = btn.textContent;
      btn.textContent = ok ? "Kopiert!" : "Ging nicht";
      btn.classList.toggle("copied", ok);
      setTimeout(function () { btn.textContent = orig; btn.classList.remove("copied"); }, 1500);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { flash(true); }, function () { flash(legacyCopy(text)); });
    } else {
      flash(legacyCopy(text));
    }
  });

  // ---------------- message pane ----------------
  function clearEmpty() { if (emptyEl) { emptyEl.remove(); emptyEl = null; } }

  function scrollDown() { msgsEl.scrollTop = msgsEl.scrollHeight; }

  function showEmptyPane() {
    msgsEl.innerHTML = '<div class="nx-empty" id="nxEmpty">'
      + document.querySelector(".nx-top-mark").outerHTML.replace('class="nx-top-mark"', 'class="nx-empty-mark"')
      + "<h2>Hallo, ich bin Nex</h2><p>Frag mich einfach irgendwas.</p></div>";
    emptyEl = document.getElementById("nxEmpty");
  }

  function addMsg(role, text) {
    clearEmpty();
    var row = document.createElement("div");
    row.className = "nx-row " + (role === "user" ? "me" : "them");
    var b = document.createElement("div");
    b.className = "nx-bubble";
    var split = splitPreview(text);
    b.innerHTML = renderMarkdown(split.text);
    addCopyButtons(b);
    wireGeneratedImages(b);
    if (split.artifact) appendPreviewChip(b, split.artifact);
    row.appendChild(b);
    msgsEl.appendChild(row);
    scrollDown();
    return b;
  }

  var typingRow = null;
  function showTyping() {
    if (typingRow) return;
    clearEmpty();
    typingRow = document.createElement("div");
    typingRow.className = "nx-row them";
    typingRow.innerHTML = '<div class="nx-bubble" style="padding:0;"><div class="nx-typing"><span></span><span></span><span></span></div></div>';
    msgsEl.appendChild(typingRow);
    scrollDown();
  }
  function hideTyping() { if (typingRow) { typingRow.remove(); typingRow = null; } }

  function autoGrow() {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 200) + "px";
  }
  function syncSend() { sendBtn.disabled = busy || !input.value.trim(); }
  input.addEventListener("input", function () { autoGrow(); syncSend(); });
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  });
  syncSend();

  function nice(err) {
    if (err === "empty") return "Schreib mir doch was.";
    if (err === "not_found") return "Dieser Chat existiert nicht mehr.";
    if (err === "rate_limited") return "Kurz durchatmen -- gleich wieder.";
    return "Das hat gerade nicht geklappt. Nochmal versuchen?";
  }

  // ---------------- sidebar ----------------
  function closeRowMenu() { if (openRowMenu) { openRowMenu.remove(); openRowMenu = null; } }

  function closeSidebar() { sidebar.classList.remove("open"); sidebarBackdrop.classList.remove("open"); }
  function openSidebar() { sidebar.classList.add("open"); sidebarBackdrop.classList.add("open"); }
  menuBtn.addEventListener("click", function () { sidebar.classList.contains("open") ? closeSidebar() : openSidebar(); });
  sidebarBackdrop.addEventListener("click", closeSidebar);

  function renderSidebar() {
    if (!chats.length) {
      sidebarList.innerHTML = '<div class="nx-sidebar-empty">Noch keine Chats.</div>';
      return;
    }
    sidebarList.innerHTML = chats.map(function (c) {
      return '<div class="nx-sidebar-row' + (c.id === activeChatId ? " is-active" : "") + '" data-chat-id="' + c.id + '">'
        + '<span class="nx-sidebar-row-title">' + esc(c.title) + '</span>'
        + '<button type="button" class="nx-sidebar-row-more" data-more aria-label="Mehr">'
        + '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg></button>'
        + "</div>";
    }).join("");
  }
  renderSidebar();

  function syncVersionLabel(character) {
    if (!versionLabel) return;
    versionLabel.textContent = PERSONA_LABELS[character] || PERSONA_LABELS.nex;
    if (versionMenu) {
      versionMenu.querySelectorAll("[data-character]").forEach(function (btn) {
        btn.classList.toggle("is-active", btn.dataset.character === character);
      });
    }
  }

  function setActive(id, skipPush) {
    activeChatId = id;
    window.NEX_CHAT_ID = id;
    sidebarList.querySelectorAll(".nx-sidebar-row").forEach(function (row) {
      row.classList.toggle("is-active", Number(row.dataset.chatId) === id);
    });
    if (!skipPush) history.pushState(null, "", id ? "/?chat=" + id : "/");
    var chat = chats.find(function (c) { return c.id === id; });
    pendingPersona = null;
    syncVersionLabel(chat ? chat.character : "nex");
  }

  function switchToChat(id, skipPush) {
    if (id === activeChatId) { closeSidebar(); return; }
    fetch("/api/ai/chats/" + id + "/messages")
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j.ok) { window.plToast && window.plToast(nice(j.error)); return; }
        var c = chats.find(function (c) { return c.id === id; });
        if (c) c.character = j.chat.character;
        setActive(id, skipPush);
        resetChatArtifacts();
        if (!j.messages.length) { showEmptyPane(); }
        else {
          msgsEl.innerHTML = "";
          emptyEl = null;
          j.messages.forEach(function (m) { addMsg(m.role, m.content); });
        }
        closeSidebar();
      });
  }

  function newChat(skipPush) {
    setActive(null, skipPush);
    resetChatArtifacts();
    showEmptyPane();
    closeSidebar();
  }
  newChatBtn.addEventListener("click", function () { newChat(); });

  function renameChat(id, row) {
    closeRowMenu();
    var titleEl = row.querySelector(".nx-sidebar-row-title");
    var current = titleEl.textContent;
    titleEl.innerHTML = '<input type="text" maxlength="100">';
    var inp = titleEl.querySelector("input");
    inp.value = current;
    inp.focus();
    inp.select();
    function commit() {
      var title = inp.value.trim();
      if (!title || title === current) { titleEl.textContent = current; return; }
      fetch("/api/ai/chats/" + id, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: title }),
      }).then(function (r) { return r.json(); }).then(function (j) {
        titleEl.textContent = j.ok ? j.chat.title : current;
        var c = chats.find(function (c) { return c.id === id; });
        if (c && j.ok) c.title = j.chat.title;
      }).catch(function () { titleEl.textContent = current; });
    }
    inp.addEventListener("blur", commit);
    inp.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); inp.blur(); }
      if (e.key === "Escape") { titleEl.textContent = current; }
    });
  }

  function deleteChat(id) {
    closeRowMenu();
    if (!window.confirm("Diesen Chat wirklich löschen?")) return;
    fetch("/api/ai/chats/" + id + "/delete", { method: "POST" }).then(function (r) { return r.json(); }).then(function (j) {
      if (!j.ok) return;
      chats = chats.filter(function (c) { return c.id !== id; });
      renderSidebar();
      if (id === activeChatId) {
        if (chats.length) switchToChat(chats[0].id);
        else newChat();
      }
    });
  }

  sidebarList.addEventListener("click", function (e) {
    var moreBtn = e.target.closest("[data-more]");
    var row = e.target.closest(".nx-sidebar-row");
    if (!row) return;
    var id = Number(row.dataset.chatId);
    if (moreBtn) {
      e.stopPropagation();
      var wasOpenOnThisRow = openRowMenu && row.classList.contains("is-open-menu");
      closeRowMenu();
      sidebarList.querySelectorAll(".is-open-menu").forEach(function (r) { r.classList.remove("is-open-menu"); });
      if (wasOpenOnThisRow) return;
      row.classList.add("is-open-menu");
      var menu = document.createElement("div");
      menu.className = "nx-row-menu";
      menu.innerHTML = '<button type="button" data-act="rename">Umbenennen</button><button type="button" class="danger" data-act="delete">Löschen</button>';
      row.appendChild(menu);
      openRowMenu = menu;
      menu.addEventListener("click", function (e2) {
        e2.stopPropagation();
        var act = e2.target.closest("[data-act]");
        if (!act) return;
        if (act.dataset.act === "rename") renameChat(id, row);
        else if (act.dataset.act === "delete") deleteChat(id);
      });
      return;
    }
    if (e.target.closest(".nx-sidebar-row-title input")) return;
    switchToChat(id);
  });
  document.addEventListener("click", function (e) {
    if (!e.target.closest(".nx-row-menu") && !e.target.closest("[data-more]")) {
      closeRowMenu();
      sidebarList.querySelectorAll(".is-open-menu").forEach(function (r) { r.classList.remove("is-open-menu"); });
    }
  });

  window.addEventListener("popstate", function () {
    var params = new URLSearchParams(location.search);
    var id = params.get("chat") ? Number(params.get("chat")) : null;
    if (id !== activeChatId) { if (id) switchToChat(id, true); else newChat(true); }
  });

  // ---------------- send ----------------
  function streamInto(chatId, text) {
    return fetch("/api/ai/chats/" + chatId + "/stream", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: text }),
    }).then(function (res) {
      var ct = res.headers.get("content-type") || "";
      if (ct.indexOf("application/json") !== -1) {
        return res.json().then(function (j) { throw new Error(nice(j.error)); });
      }
      hideTyping();
      var bubble = addMsg("assistant", "");
      var reader = res.body.getReader();
      var decoder = new TextDecoder();
      var full = "";
      var lastPending = null;
      function pump() {
        return reader.read().then(function (result) {
          if (result.done) {
            if (!full) {
              // the stream opened (200, text/plain) but ended without a
              // single token ever arriving -- e.g. Groq itself failed
              // after api_ai_stream had already started responding, so
              // the error never became a JSON {ok:false} the catch above
              // could show. Without this, the bubble would just stay
              // silently empty with no sign anything went wrong.
              var failMsg = "Da ist gerade etwas schiefgelaufen. Nochmal versuchen?";
              bubble.innerHTML = renderMarkdown(failMsg);
              speakReply(failMsg);
              return;
            }
            var split = splitPreview(full);
            bubble.innerHTML = renderMarkdown(split.text);
            addCopyButtons(bubble);
            wireGeneratedImages(bubble);
            speakReply(split.text);
            if (split.artifact) {
              appendPreviewChip(bubble, split.artifact);
              openPreviewPanel(split.artifact);
            } else if (lastPending && lastPending.kind === "nexpreview") {
              // the stream ended (e.g. MAX_REPLY_TOKENS hit) before the
              // fence ever closed -- still swap to a best-effort iframe
              // with whatever code arrived instead of leaving the panel
              // stuck on "Wird erstellt ..." forever. (A neximage prompt
              // cut off mid-stream has no panel to fall back into -- the
              // incomplete fence was already excluded from split.text, so
              // the bubble just shows whatever prose came before it.)
              var truncated = { title: lastPending.title || "Vorschau", code: lastPending.code };
              appendPreviewChip(bubble, truncated);
              openPreviewPanel(truncated);
            }
            return;
          }
          full += decoder.decode(result.value, { stream: true });
          var split = splitPreview(full);
          bubble.innerHTML = renderMarkdown(split.text);
          if (split.pending) {
            lastPending = split.pending;
            if (split.pending.kind === "nexpreview") openPreviewLoading(split.pending);
          }
          scrollDown();
          return pump();
        });
      }
      return pump();
    });
  }

  function send() {
    var text = input.value.trim();
    if (!text || busy) return;
    input.value = "";
    autoGrow();
    addMsg("user", text);
    busy = true;
    syncSend();
    showTyping();

    var ensureChat = activeChatId
      ? Promise.resolve(activeChatId)
      : fetch("/api/ai/chats", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ character: pendingPersona || undefined }),
        }).then(function (r) { return r.json(); }).then(function (j) {
          chats.unshift(j.chat);
          setActive(j.chat.id);
          renderSidebar();
          return j.chat.id;
        });

    ensureChat
      .then(function (chatId) {
        var isNewTitle = !(chats.find(function (c) { return c.id === chatId; }) || {}).title
          || (chats.find(function (c) { return c.id === chatId; }) || {}).title === "Neuer Chat";
        return streamInto(chatId, text).then(function () {
          if (isNewTitle) {
            var c = chats.find(function (c) { return c.id === chatId; });
            if (c) { c.title = text.slice(0, 40); renderSidebar(); }
          }
        });
      })
      .then(function () {
        busy = false;
        syncSend();
        if (window.plSound) window.plSound.play("receive");
      })
      .catch(function (err) {
        hideTyping();
        busy = false;
        syncSend();
        var msg = (err && err.message) || "Verbindungsfehler.";
        addMsg("assistant", msg);
        speakReply(msg);
      });
  }

  sendBtn.addEventListener("click", send);

  // ---------------- version picker ----------------
  // Picking an entry switches the active chat's persona (AiChat.character)
  // -- an existing chat is PATCHed immediately, a not-yet-created one just
  // remembers the choice in `pendingPersona` until send() creates it.
  if (versionBtn) {
    versionBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      versionMenu.hidden = !versionMenu.hidden;
    });
    versionMenu.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-character]");
      if (!btn) return;
      versionMenu.hidden = true;
      var character = btn.dataset.character;
      if (activeChatId) {
        fetch("/api/ai/chats/" + activeChatId, {
          method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ character: character }),
        }).then(function (r) { return r.json(); }).then(function (j) {
          if (!j.ok) { window.plToast && window.plToast("Ging nicht."); return; }
          var c = chats.find(function (c) { return c.id === activeChatId; });
          if (c) c.character = character;
          syncVersionLabel(character);
        }).catch(function () { window.plToast && window.plToast("Ging nicht."); });
      } else {
        pendingPersona = character;
        syncVersionLabel(character);
      }
    });
    document.addEventListener("click", function (e) {
      if (!versionMenu.hidden && !e.target.closest(".nx-version-wrap")) versionMenu.hidden = true;
    });
    syncVersionLabel((chats.find(function (c) { return c.id === activeChatId; }) || {}).character || "nex");
  }

  // ---------------- account corner: theme / avatar / logout ----------------
  var accountBtn = document.getElementById("nxAccountBtn");
  if (accountBtn) {
    var accountMenu = document.getElementById("nxAccountMenu");
    var themeToggle = document.getElementById("nxThemeToggle");
    var themeLabel = document.getElementById("nxThemeToggleLabel");
    var avatarChangeBtn = document.getElementById("nxAvatarChangeBtn");
    var avatarFile = document.getElementById("nxAvatarFile");
    var logoutBtn = document.getElementById("nxLogoutBtn");

    function isLight() { return document.documentElement.getAttribute("data-theme") === "light"; }
    function syncThemeLabel() { themeLabel.textContent = isLight() ? "Dunkles Design" : "Helles Design"; }
    syncThemeLabel();

    function closeAccountMenu() { accountMenu.hidden = true; }
    accountBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      accountMenu.hidden = !accountMenu.hidden;
    });
    document.addEventListener("click", function (e) {
      if (!accountMenu.hidden && !e.target.closest(".nx-me")) closeAccountMenu();
    });

    themeToggle.addEventListener("click", function () {
      var next = isLight() ? "dark" : "light";
      if (next === "light") document.documentElement.setAttribute("data-theme", "light");
      else document.documentElement.removeAttribute("data-theme");
      try { localStorage.setItem("pl_theme", next); } catch (e) {}
      syncThemeLabel();
    });

    avatarChangeBtn.addEventListener("click", function () {
      closeAccountMenu();
      avatarFile.click();
    });
    avatarFile.addEventListener("change", function () {
      var f = avatarFile.files[0];
      avatarFile.value = "";
      if (!f || !window.PlCropper) return;
      window.PlCropper.open(f, { aspect: 1, shape: "circle", title: "Profilbild zuschneiden" }).then(function (blob) {
        if (!blob) return;
        var fd = new FormData();
        fd.append("avatar", blob, "avatar.jpg");
        fetch("/api/pl/profile", { method: "POST", body: fd })
          .then(function (r) { return r.json(); })
          .then(function (j) {
            if (!j.ok) { window.plToast && window.plToast("Ging nicht."); return; }
            accountBtn.innerHTML = '<img src="' + j.avatar_url + '" alt="">';
          })
          .catch(function () { window.plToast && window.plToast("Ging nicht."); });
      });
    });

    logoutBtn.addEventListener("click", function () { location.href = "/logout"; });
  }

  // ---------------- voice mode ----------------
  // Native Web Speech API only -- no key, no external service, matches
  // "kostenlos" better than any API would. Mic button is the sole on/off
  // switch: click starts continuous listening, a 1.6s silence timer
  // auto-sends whatever landed in #nxInput (reusing send() unchanged),
  // and Nex's reply is read back once streaming completes (see the
  // speakReply() calls added to pump() above). Recognition pauses while
  // a reply is streaming or being spoken so Nex never transcribes itself.
  var micBtn = document.getElementById("nxMicBtn");
  var voiceStatus = document.getElementById("nxVoiceStatus");
  var voiceMuteToggle = document.getElementById("nxVoiceMuteToggle");
  var voiceMuteLabel = document.getElementById("nxVoiceMuteLabel");
  var voiceSelect = document.getElementById("nxVoiceSelect");
  var voiceModeOn = false;
  var voiceMuted = false;
  var wantListening = false;
  var selectedVoice = null;
  var recognition = null;

  function setVoiceStatus(text) {
    if (!voiceStatus) return;
    voiceStatus.textContent = text || "";
    voiceStatus.hidden = !text;
  }

  function pauseListening() {
    if (recognition) { try { recognition.stop(); } catch (e) {} }
  }

  function startListeningSafely() {
    if (!recognition || !wantListening || busy) return;
    try { recognition.start(); } catch (e) { /* already running */ }
  }

  function resumeListeningIfWanted() {
    if (wantListening && !busy) startListeningSafely();
  }

  // Code the model wrote (nexpreview/neximage fences are already gone
  // from split.text by the time this runs -- neximage became an <img>
  // tag, nexpreview an empty string) shouldn't be read out character by
  // character; same for plain ``` snippets, links, and markdown noise.
  function stripForSpeech(text) {
    return text
      .replace(/<img[^>]*class="nx-gen-image"[^>]*>/g, " Ich habe dir ein Bild im Chat gezeigt. ")
      .replace(/```[\s\S]*?```/g, " Den Code habe ich dir im Chat gezeigt. ")
      .replace(/https?:\/\/[^\s]+/g, "ein Link im Chat")
      .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE0F}]/gu, "")
      .replace(/[*_`~#>]+/g, "")
      .replace(/^\s*[-•]\s+/gm, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  function speakReply(text) {
    if (!voiceModeOn || voiceMuted || !window.speechSynthesis) { resumeListeningIfWanted(); return; }
    var spoken = stripForSpeech(text);
    if (!spoken) { resumeListeningIfWanted(); return; }
    speechSynthesis.cancel();
    var utter = new SpeechSynthesisUtterance(spoken);
    if (selectedVoice) utter.voice = selectedVoice;
    utter.lang = "de-DE";
    if (micBtn) micBtn.classList.add("is-speaking");
    setVoiceStatus("Nex spricht …");
    utter.onend = function () {
      if (micBtn) micBtn.classList.remove("is-speaking");
      resumeListeningIfWanted();
    };
    utter.onerror = utter.onend;
    speechSynthesis.speak(utter);
  }

  // Quality heuristic for speechSynthesis.getVoices() -- prefers higher-
  // quality/neural voices and German, falls back to whatever the browser
  // offers. Voice list loading is async and browser-dependent, hence the
  // onvoiceschanged hook.
  function scoreVoice(v) {
    var s = 0;
    var n = v.name.toLowerCase();
    if (/enhanced|premium|natural|neural|pro\b/.test(n)) s += 100;
    if (/online|siri|google/.test(n)) s += 20;
    if (/de-de|de_de/i.test(v.lang)) s += 15;
    return s;
  }
  function populateVoices() {
    if (!voiceSelect || !window.speechSynthesis) return;
    var voices = speechSynthesis.getVoices();
    if (!voices.length) return;
    var relevant = voices.filter(function (v) { return /^de|^en/i.test(v.lang); });
    var list = (relevant.length ? relevant : voices).slice().sort(function (a, b) { return scoreVoice(b) - scoreVoice(a); });
    voiceSelect.innerHTML = list.map(function (v) {
      return '<option value="' + esc(v.name) + '">' + esc(v.name) + " (" + esc(v.lang) + ")</option>";
    }).join("");
    if (list.length) { voiceSelect.value = list[0].name; selectedVoice = list[0]; }
  }
  if (window.speechSynthesis) {
    speechSynthesis.onvoiceschanged = populateVoices;
    populateVoices();
  }
  if (voiceSelect) {
    voiceSelect.addEventListener("change", function () {
      var voices = speechSynthesis.getVoices();
      selectedVoice = voices.find(function (v) { return v.name === voiceSelect.value; }) || null;
    });
  }
  if (voiceMuteToggle) {
    voiceMuteToggle.addEventListener("click", function () {
      voiceMuted = !voiceMuted;
      voiceMuteLabel.textContent = "Antworten vorlesen: " + (voiceMuted ? "aus" : "an");
      if (voiceMuted && window.speechSynthesis) speechSynthesis.cancel();
    });
  }

  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  var isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  var isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

  if (!SR || (isIOS && isSafari)) {
    if (micBtn) {
      micBtn.disabled = true;
      micBtn.title = "Spracherkennung wird von diesem Browser nicht unterstützt";
    }
  } else if (micBtn) {
    recognition = new SR();
    recognition.lang = "de-DE";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    var finalTranscript = "";
    var silenceTimer = null;

    function clearSilenceTimer() { if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null; } }
    function armSilenceTimer() {
      clearSilenceTimer();
      silenceTimer = setTimeout(function () {
        if (input.value.trim() && !busy) {
          pauseListening();
          finalTranscript = "";
          send();
        }
      }, 1600);
    }

    recognition.onstart = function () {
      finalTranscript = "";
      micBtn.classList.add("is-listening");
      setVoiceStatus("Hört zu …");
    };
    var micErrorShown = false;
    recognition.onend = function () {
      micBtn.classList.remove("is-listening");
      clearSilenceTimer();
      if (wantListening && !busy) {
        setTimeout(function () { if (wantListening) startListeningSafely(); }, 300);
      } else if (!wantListening) {
        // onerror (permission denied) fires just before onend and already
        // set a status message -- onend runs right after with
        // wantListening now false too, so without this guard it would
        // immediately wipe that message back to empty.
        if (micErrorShown) micErrorShown = false;
        else setVoiceStatus("");
      }
    };
    recognition.onresult = function (event) {
      var interimText = "";
      for (var i = event.resultIndex; i < event.results.length; i++) {
        var t = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalTranscript += t + " ";
        else interimText += t;
      }
      input.value = (finalTranscript + interimText).trim();
      autoGrow();
      syncSend();
      armSilenceTimer();
    };
    recognition.onerror = function (e) {
      if (e.error === "no-speech" || e.error === "aborted") return;
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        wantListening = false;
        voiceModeOn = false;
        micErrorShown = true;
        micBtn.classList.remove("is-listening");
        setVoiceStatus("Mikrofon-Zugriff verweigert.");
      }
    };

    micBtn.addEventListener("click", function () {
      if (wantListening) {
        wantListening = false;
        voiceModeOn = false;
        clearSilenceTimer();
        finalTranscript = "";
        pauseListening();
        setVoiceStatus("");
      } else {
        wantListening = true;
        voiceModeOn = true;
        startListeningSafely();
      }
    });
  }
})();
