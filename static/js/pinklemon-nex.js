(function () {
  "use strict";
  var scroll = document.getElementById("nxScroll");
  var inner = document.getElementById("nxInner");
  var emptyEl = document.getElementById("nxEmpty");
  var input = document.getElementById("nxInput");
  var sendBtn = document.getElementById("nxSend");
  var MARK = document.querySelector("#nxEmpty .nx-logo").innerHTML;
  var chatId = null, busy = false;

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function atBottom() { return scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 120; }
  function down() { scroll.scrollTop = scroll.scrollHeight; }

  /* --- tiny markdown -> html --- */
  function inline(t) {
    t = esc(t);
    t = t.replace(/`([^`]+)`/g, "<code>$1</code>");
    t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    t = t.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
    t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    return t;
  }
  function md(src) {
    var lines = String(src).replace(/\r/g, "").split("\n");
    var html = "", i = 0, listType = null;
    function closeList() { if (listType) { html += "</" + listType + ">"; listType = null; } }
    while (i < lines.length) {
      var line = lines[i];
      var fence = line.match(/^```(\w*)/);
      if (fence) {
        closeList();
        var buf = [];
        i++;
        while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++; }
        i++;
        html += "<pre><code>" + esc(buf.join("\n")) + "</code></pre>";
        continue;
      }
      var h = line.match(/^(#{1,3})\s+(.*)/);
      if (h) { closeList(); html += "<h" + h[1].length + ">" + inline(h[2]) + "</h" + h[1].length + ">"; i++; continue; }
      var q = line.match(/^>\s?(.*)/);
      if (q) { closeList(); html += "<blockquote>" + inline(q[1]) + "</blockquote>"; i++; continue; }
      var ul = line.match(/^\s*[-*]\s+(.*)/);
      var ol = line.match(/^\s*\d+[.)]\s+(.*)/);
      if (ul || ol) {
        var want = ul ? "ul" : "ol";
        if (listType && listType !== want) closeList();
        if (!listType) { listType = want; html += "<" + want + ">"; }
        html += "<li>" + inline((ul || ol)[1]) + "</li>";
        i++; continue;
      }
      if (line.trim() === "") { closeList(); i++; continue; }
      closeList();
      var para = [line]; i++;
      while (i < lines.length && lines[i].trim() !== "" && !/^(```|#{1,3}\s|>\s?|\s*[-*]\s|\s*\d+[.)]\s)/.test(lines[i])) { para.push(lines[i]); i++; }
      html += "<p>" + inline(para.join("\n")).replace(/\n/g, "<br>") + "</p>";
    }
    closeList();
    return html;
  }

  function hideEmpty() { if (emptyEl) { emptyEl.remove(); emptyEl = null; } }

  function addUser(text) {
    hideEmpty();
    var d = document.createElement("div");
    d.className = "nx-turn user";
    d.innerHTML = '<div class="nx-bubble-user">' + esc(text) + "</div>";
    inner.appendChild(d);
    down();
  }
  function addAssist(mdText) {
    hideEmpty();
    var d = document.createElement("div");
    d.className = "nx-turn assist";
    d.innerHTML = '<div class="nx-assist-label"><span class="nx-assist-mark">' + MARK + "</span>Nex</div>"
      + '<div class="nx-assist-body">' + md(mdText) + "</div>";
    inner.appendChild(d);
    return d;
  }
  function addThinking() {
    hideEmpty();
    var d = document.createElement("div");
    d.className = "nx-turn assist";
    d.innerHTML = '<div class="nx-assist-label"><span class="nx-assist-mark">' + MARK + '</span>Nex</div>'
      + '<div class="nx-assist-body"><span class="nx-dots"><span></span><span></span><span></span></span></div>';
    inner.appendChild(d);
    down();
    return d;
  }

  function autosize() { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 140) + "px"; }
  input.addEventListener("input", autosize);

  function poll(jobId, thinkEl) {
    fetch("/api/ai/chat/" + jobId).then(function (r) { return r.json(); }).then(function (j) {
      if (j.status === "running") { setTimeout(function () { poll(jobId, thinkEl); }, 650); return; }
      var stick = atBottom();
      thinkEl.remove();
      busy = false; sendBtn.disabled = false;
      if (j.status === "done" && j.reply) addAssist(j.reply);
      else addAssist("Ich bin gerade nicht erreichbar. Gleich nochmal.");
      if (stick) down();
    }).catch(function () { thinkEl.remove(); busy = false; sendBtn.disabled = false; addAssist("Verbindungsfehler."); });
  }

  function send(text) {
    text = (text != null ? text : input.value).trim();
    if (!text || busy) return;
    input.value = ""; autosize();
    addUser(text);
    busy = true; sendBtn.disabled = true;
    var thinkEl = addThinking();
    var body = { message: text, character: window.NEX.character, project_type: window.NEX.projectType };
    if (chatId) body.chat_id = chatId;
    fetch("/api/ai/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j.ok) { thinkEl.remove(); busy = false; sendBtn.disabled = false; addAssist("Ging nicht."); return; }
        chatId = j.chat_id;
        poll(j.job_id, thinkEl);
      })
      .catch(function () { thinkEl.remove(); busy = false; sendBtn.disabled = false; addAssist("Verbindungsfehler."); });
  }

  sendBtn.addEventListener("click", function () { send(); });
  input.addEventListener("keydown", function (e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } });
  document.querySelectorAll(".nx-sugg").forEach(function (b) { b.addEventListener("click", function () { send(b.textContent); }); });

  document.getElementById("nxNew").addEventListener("click", function () {
    chatId = null;
    inner.innerHTML = "";
    var d = document.createElement("div");
    d.className = "nx-empty"; d.id = "nxEmpty";
    d.innerHTML = '<span class="nx-logo">' + MARK + '</span><h2>Nex</h2><p>Neuer Chat. Leg los.</p>';
    inner.appendChild(d);
    emptyEl = d;
  });

  // load latest Nex chat
  fetch("/api/ai/chats?character=" + encodeURIComponent(window.NEX.character))
    .then(function (r) { return r.json(); })
    .then(function (j) {
      if (j.ok && j.chats.length) {
        chatId = j.chats[0].id;
        return fetch("/api/ai/chats/" + chatId + "/messages").then(function (r) { return r.json(); }).then(function (m) {
          if (m.ok && m.messages.length) {
            hideEmpty();
            m.messages.forEach(function (x) { x.role === "user" ? addUser(x.content) : addAssist(x.content); });
            down();
          }
        });
      }
    });
})();
