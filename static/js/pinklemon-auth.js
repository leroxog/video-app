(function () {
  "use strict";

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  var track = document.getElementById("plAuthTrack");
  var viewport = document.getElementById("plAuthViewport");
  var steps = Array.prototype.slice.call(document.querySelectorAll(".pl-authstep"));
  var stepNames = steps.map(function (s) { return s.dataset.step; });
  var current = 0;

  var state = {
    username: "", password: "",
    birth_day: null, birth_month: null, birth_year: null,
    gender: null, email: "",
    display_name: "", avatarFile: null, bannerFile: null,
  };

  function stepIndex(name) { return stepNames.indexOf(name); }

  function resizeToStep(i) {
    viewport.style.height = steps[i].scrollHeight + "px";
  }

  function goTo(name) {
    var i = typeof name === "number" ? name : stepIndex(name);
    current = i;
    track.style.transform = "translateX(-" + (i * 100) + "%)";
    resizeToStep(i);
  }

  window.addEventListener("resize", function () { resizeToStep(current); });

  function showOverlay(stepEl) { var o = stepEl.querySelector(".pl-authoverlay"); if (o) o.hidden = false; }
  function hideOverlay(stepEl) { var o = stepEl.querySelector(".pl-authoverlay"); if (o) o.hidden = true; }

  // "Lade verschwinden": darken + spinner over the current step, at least
  // `minMs` long (so it's actually perceptible even when the wrapped work
  // is instant/purely local), then fades back out.
  function withLoading(stepEl, fn, minMs) {
    minMs = minMs || 550;
    showOverlay(stepEl);
    var start = Date.now();
    return Promise.resolve().then(fn).then(function (result) {
      var wait = Math.max(0, minMs - (Date.now() - start));
      return new Promise(function (res) { setTimeout(res, wait); }).then(function () { return result; });
    }).finally(function () { hideOverlay(stepEl); });
  }

  // ================== login ==================
  var loginStepEl = steps[stepIndex("login")];
  var loginForm = document.getElementById("plLoginForm");
  var loginUsername = document.getElementById("plLoginUsername");
  var loginPassword = document.getElementById("plLoginPassword");
  var loginBtn = document.getElementById("plLoginBtn");
  var loginError = document.getElementById("plLoginError");

  function tryLogin() {
    var u = loginUsername.value.trim(), p = loginPassword.value;
    if (!u || !p) return;
    loginError.textContent = "";
    withLoading(loginStepEl, function () {
      return fetch("/api/pl/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: u, password: p }),
      }).then(function (r) { return r.json(); });
    }).then(function (j) {
      if (j.ok) {
        loginForm.hidden = true;
        loginBtn.hidden = false;
        resizeToStep(current);
      } else {
        loginError.textContent = "Benutzername oder Passwort falsch.";
      }
    }).catch(function () { loginError.textContent = "Verbindungsfehler."; });
  }
  [loginUsername, loginPassword].forEach(function (el) {
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); tryLogin(); } });
  });
  loginBtn.addEventListener("click", function () { location.href = "/"; });
  document.getElementById("plGoRegister").addEventListener("click", function (e) {
    e.preventDefault();
    goTo("register1");
  });

  // ================== register step 1 ==================
  var reg1El = steps[stepIndex("register1")];
  var regUsername = document.getElementById("plRegUsername");
  var regPassword = document.getElementById("plRegPassword");
  var regPassword2 = document.getElementById("plRegPassword2");
  var reg1Error = document.getElementById("plReg1Error");
  var reg1Next = document.getElementById("plReg1Next");
  var reg1CheckTimer = null;
  var USERNAME_RE = /^[a-zA-Z0-9_.]{3,30}$/;

  function reg1Validate() {
    reg1Next.hidden = true;
    reg1Error.textContent = "";
    clearTimeout(reg1CheckTimer);
    var u = regUsername.value.trim(), p = regPassword.value, p2 = regPassword2.value;
    if (!u || !p || !p2) return;
    if (!USERNAME_RE.test(u)) { reg1Error.textContent = "3-30 Zeichen, nur Buchstaben, Zahlen, _ und ."; return; }
    if (p.length < 6) { reg1Error.textContent = "Passwort muss mindestens 6 Zeichen haben."; return; }
    if (p !== p2) { reg1Error.textContent = "Passwörter stimmen nicht überein."; return; }
    reg1CheckTimer = setTimeout(function () {
      withLoading(reg1El, function () {
        return fetch("/api/pl/register/check-username", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: u }),
        }).then(function (r) { return r.json(); });
      }).then(function (j) {
        if (j.ok && j.available) {
          state.username = u; state.password = p;
          reg1Next.hidden = false;
          resizeToStep(current);
        } else {
          reg1Error.textContent = "Dieser Name ist schon vergeben.";
        }
      }).catch(function () { reg1Error.textContent = "Verbindungsfehler."; });
    }, 500);
  }
  [regUsername, regPassword, regPassword2].forEach(function (el) { el.addEventListener("input", reg1Validate); });
  reg1Next.addEventListener("click", function () { goTo("register2"); });

  // ================== register step 2: birthday wheels + gender + email ==================
  function buildWheel(el, items, initialValue) {
    var ITEM_H = 38;
    el.innerHTML = "";
    var padTop = document.createElement("div"); padTop.style.height = ITEM_H * 2 + "px"; el.appendChild(padTop);
    items.forEach(function (it) {
      var d = document.createElement("div");
      d.className = "pl-wheel-item";
      d.textContent = it.label;
      el.appendChild(d);
    });
    var padBot = document.createElement("div"); padBot.style.height = ITEM_H * 2 + "px"; el.appendChild(padBot);

    var nodes = Array.prototype.slice.call(el.querySelectorAll(".pl-wheel-item"));
    var initIndex = 0;
    for (var i = 0; i < items.length; i++) { if (items[i].value === initialValue) { initIndex = i; break; } }

    var wheelObj = { onchange: null, getValue: function () { return items[currentIdx] ? items[currentIdx].value : null; } };
    var currentIdx = initIndex;

    function mark(idx) {
      nodes.forEach(function (n, i) { n.classList.toggle("is-center", i === idx); });
      currentIdx = idx;
    }
    mark(initIndex);
    el.scrollTop = initIndex * ITEM_H;

    var settleTimer = null;
    el.addEventListener("scroll", function () {
      var idx = Math.max(0, Math.min(items.length - 1, Math.round(el.scrollTop / ITEM_H)));
      mark(idx);
      clearTimeout(settleTimer);
      settleTimer = setTimeout(function () {
        var settled = Math.max(0, Math.min(items.length - 1, Math.round(el.scrollTop / ITEM_H)));
        el.scrollTo({ top: settled * ITEM_H, behavior: "smooth" });
        mark(settled);
        if (wheelObj.onchange) wheelObj.onchange(items[settled].value);
      }, 130);
    });
    return wheelObj;
  }

  var today = new Date();
  var dayItems = []; for (var d = 1; d <= 31; d++) dayItems.push({ value: d, label: String(d) });
  var MONTH_NAMES = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
  var monthItems = MONTH_NAMES.map(function (n, i) { return { value: i + 1, label: n }; });
  var yearItems = []; for (var y = today.getFullYear(); y >= today.getFullYear() - 100; y--) yearItems.push({ value: y, label: String(y) });

  var defaultYear = today.getFullYear() - 16;
  var dayWheel = buildWheel(document.getElementById("plWheelDay"), dayItems, 1);
  var monthWheel = buildWheel(document.getElementById("plWheelMonth"), monthItems, 1);
  var yearWheel = buildWheel(document.getElementById("plWheelYear"), yearItems, defaultYear);
  state.birth_day = 1; state.birth_month = 1; state.birth_year = defaultYear;
  dayWheel.onchange = function (v) { state.birth_day = v; };
  monthWheel.onchange = function (v) { state.birth_month = v; };
  yearWheel.onchange = function (v) { state.birth_year = v; };

  // Birthday (always has a default), gender and email are all genuinely
  // optional here -- picking a gender only marks it selected, it does NOT
  // by itself advance the step anymore (that felt like it forced an
  // answer). "Weiter" is always clickable; whatever's been picked (or
  // not) travels along in `state`.
  var reg2El = steps[stepIndex("register2")];
  var reg2Advancing = false;
  document.querySelectorAll(".pl-gender-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var already = btn.classList.contains("is-active");
      document.querySelectorAll(".pl-gender-btn").forEach(function (b) { b.classList.remove("is-active"); });
      if (!already) { btn.classList.add("is-active"); state.gender = btn.dataset.gender; }
      else { state.gender = null; }
    });
  });
  document.getElementById("plRegEmail").addEventListener("input", function (e) { state.email = e.target.value.trim(); });
  document.getElementById("plReg2Next").addEventListener("click", function () {
    if (reg2Advancing) return;
    reg2Advancing = true;
    state.email = document.getElementById("plRegEmail").value.trim();
    withLoading(reg2El, function () { return true; }).then(function () { goTo("register3"); });
  });

  // ================== register step 3: account bearbeiten ==================
  var reg3El = steps[stepIndex("register3")];
  var displayNameInput = document.getElementById("plRegDisplayName");
  var reg3Next = document.getElementById("plReg3Next");
  var avatarFile = document.getElementById("plAvatarFile");
  var bannerFile = document.getElementById("plBannerFile");
  var avatarPreview = document.getElementById("plEditAvatarPreview");
  var bannerPreview = document.getElementById("plEditBannerPreview");
  var avatarLetterEl = document.getElementById("plEditAvatarLetter");

  document.getElementById("plPickAvatar").addEventListener("click", function (e) { e.stopPropagation(); avatarFile.click(); });
  document.getElementById("plPickBanner").addEventListener("click", function (e) { e.stopPropagation(); bannerFile.click(); });
  avatarFile.addEventListener("change", function () {
    var f = avatarFile.files[0]; if (!f) return;
    window.PlCropper.open(f, { aspect: 1, shape: "circle", title: "Profilbild zuschneiden" }).then(function (blob) {
      avatarFile.value = "";
      if (!blob) return;
      state.avatarFile = blob;
      avatarPreview.style.backgroundImage = "url(" + URL.createObjectURL(blob) + ")";
      avatarLetterEl.hidden = true;
    });
  });
  bannerFile.addEventListener("change", function () {
    var f = bannerFile.files[0]; if (!f) return;
    window.PlCropper.open(f, { aspect: 3, shape: "rect", title: "Banner zuschneiden" }).then(function (blob) {
      bannerFile.value = "";
      if (!blob) return;
      state.bannerFile = blob;
      bannerPreview.style.backgroundImage = "url(" + URL.createObjectURL(blob) + ")";
    });
  });
  displayNameInput.addEventListener("input", function () {
    var v = displayNameInput.value.trim();
    avatarLetterEl.textContent = (v[0] || "?").toUpperCase();
    reg3Next.disabled = !v;
  });

  function goToHuman() {
    withLoading(reg3El, function () { return true; }).then(function () { goTo("human"); });
  }
  reg3Next.addEventListener("click", function () {
    if (reg3Next.disabled) return;
    state.display_name = displayNameInput.value.trim();
    goToHuman();
  });
  document.getElementById("plSkip3").addEventListener("click", function (e) { e.preventDefault(); goToHuman(); });

  // ================== human check ==================
  var humanEl = steps[stepIndex("human")];
  var humanBtn = document.getElementById("plHumanCheck");
  var humanDone = false;
  humanBtn.addEventListener("click", function () {
    if (humanDone) return;
    humanBtn.classList.add("checking");
    setTimeout(function () {
      humanBtn.classList.remove("checking");
      humanBtn.classList.add("checked");
      humanDone = true;
      withLoading(humanEl, function () { return true; }, 700).then(function () { createAccount(); });
    }, 900);
  });

  // ================== creating ==================
  var creatingText = document.getElementById("plCreatingText");

  function createAccount() {
    goTo("creating");
    var fd = new FormData();
    fd.append("username", state.username);
    fd.append("password", state.password);
    fd.append("password2", state.password);
    if (state.birth_day) fd.append("birth_day", state.birth_day);
    if (state.birth_month) fd.append("birth_month", state.birth_month);
    if (state.birth_year) fd.append("birth_year", state.birth_year);
    if (state.gender) fd.append("gender", state.gender);
    if (state.email) fd.append("email", state.email);
    if (state.display_name) fd.append("display_name", state.display_name);
    // cropper output is a plain Blob, not a File -- give it a filename
    // explicitly so the server's extension check (PL_IMAGE_EXT) sees one.
    if (state.avatarFile) fd.append("avatar", state.avatarFile, "avatar.jpg");
    if (state.bannerFile) fd.append("banner", state.bannerFile, "banner.jpg");

    fetch("/api/pl/register/complete", { method: "POST", body: fd })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j.ok) {
          window.plToast("Registrierung hat nicht geklappt. Nochmal versuchen.");
          goTo("register1");
          return;
        }
        creatingText.textContent = "Account wurde erfolgreich erstellt";
        setTimeout(function () { goTo("groups"); loadGroups(); }, 1200);
      })
      .catch(function () {
        window.plToast("Verbindungsfehler.");
        goTo("register1");
      });
  }

  // ================== suggested groups ==================
  var groupsEl = document.getElementById("plAuthGroups");
  function loadGroups() {
    fetch("/api/pl/servers/suggested").then(function (r) { return r.json(); }).then(function (j) {
      if (!j.ok || !j.servers.length) {
        groupsEl.innerHTML = '<div class="pl-authgroups-empty">Noch keine Vorschläge da.</div>';
        resizeToStep(current);
        return;
      }
      groupsEl.innerHTML = j.servers.map(function (s) {
        return '<div class="pl-authgroup">'
          + '<div class="pl-authgroup-icon"' + (s.icon_url ? ' style="background-image:url(\'' + esc(s.icon_url) + '\')"' : '') + '>'
          + (s.icon_url ? '' : esc((s.name[0] || "?").toUpperCase())) + '</div>'
          + '<div class="pl-authgroup-name">' + esc(s.name) + '</div>'
          + '<button type="button" class="pl-authgroup-join" data-code="' + esc(s.invite_code) + '" data-id="' + s.id + '">Beitreten</button></div>';
      }).join("");
      resizeToStep(current);
    }).catch(function () {
      groupsEl.innerHTML = '<div class="pl-authgroups-empty">Konnte nicht geladen werden.</div>';
      resizeToStep(current);
    });
  }
  groupsEl.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-code]");
    if (!btn) return;
    btn.disabled = true;
    fetch("/api/pl/servers/join/" + encodeURIComponent(btn.dataset.code), { method: "POST" })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j.ok) location.href = "/freunde/server/" + btn.dataset.id;
        else { window.plToast("Beitritt hat nicht geklappt."); btn.disabled = false; }
      });
  });
  document.getElementById("plSkipGroups").addEventListener("click", function (e) { e.preventDefault(); location.href = "/"; });

  // ================== 3D tilt on the glass card ==================
  var card = document.getElementById("plAuthCard");
  document.addEventListener("mousemove", function (e) {
    var r = card.getBoundingClientRect();
    var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    var dx = Math.max(-1, Math.min(1, (e.clientX - cx) / (r.width / 2)));
    var dy = Math.max(-1, Math.min(1, (e.clientY - cy) / (r.height / 2)));
    card.style.transform = "perspective(1400px) rotateY(" + (dx * 6) + "deg) rotateX(" + (-dy * 6) + "deg)";
  });
  document.addEventListener("mouseleave", function () { card.style.transform = "perspective(1400px) rotateY(0) rotateX(0)"; });

  // ================== boot ==================
  goTo(window.PL_AUTH_MODE === "signup" ? "register1" : "login");
})();
