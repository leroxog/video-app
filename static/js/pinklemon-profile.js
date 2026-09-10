(function () {
  "use strict";
  var wrap = document.querySelector(".pl-prof2, .pl-profile");
  if (!wrap) return;
  var uname = wrap.dataset.username;
  var followBtn = document.getElementById("plFollowBtn");
  var msgBtn = document.getElementById("plMsgBtn");
  var hint = document.getElementById("plMutualHint");
  var followerCount = document.getElementById("plFollowerCount");

  function api(m, u) { return fetch(u, { method: m }).then(function (r) { return r.json(); }); }

  if (followBtn) followBtn.addEventListener("click", function () {
    followBtn.disabled = true;
    api("POST", "/api/pl/follow/" + encodeURIComponent(uname)).then(function (j) {
      followBtn.disabled = false;
      if (!j.ok) return;
      followBtn.dataset.following = j.following ? "1" : "0";
      followBtn.textContent = j.following ? "Entfolgen" : "Folgen";
      followBtn.classList.toggle("ghost", j.following);
      followerCount.textContent = j.followers;
      if (j.mutual) {
        msgBtn.disabled = false;
        hint.innerHTML = "Ihr folgt euch gegenseitig &mdash; ihr könnt schreiben.";
      } else {
        msgBtn.disabled = true;
        hint.textContent = j.following ? "Warte, bis @" + uname + " zurückfolgt." : "Folgt euch gegenseitig, um schreiben zu können.";
      }
    });
  });

  if (msgBtn) msgBtn.addEventListener("click", function () {
    if (msgBtn.disabled) return;
    fetch("/api/pl/chats/dm/" + encodeURIComponent(uname), { method: "POST" })
      .then(function (r) { return r.json(); })
      .then(function (j) { if (j.ok) location.href = "/freunde/c/" + j.chat_id; });
  });

  // ---------------- edit profile ----------------
  var editBtn = document.getElementById("plEditProfileBtn");
  var sheet = document.getElementById("plEditProfileSheet");
  if (editBtn && sheet) {
    function open() { sheet.classList.add("open"); document.body.style.overflow = "hidden"; }
    function close() { sheet.classList.remove("open"); document.body.style.overflow = ""; }
    sheet.addEventListener("click", function (e) {
      if (e.target === sheet || e.target.closest("[data-close-sheet]") || e.target.classList.contains("pl-sheet-grip")) close();
    });
    editBtn.addEventListener("click", open);

    var avatarFile = document.getElementById("plEditAvatarFile");
    var bannerFile = document.getElementById("plEditBannerFile");
    var avatarBox = document.getElementById("plEditAvatar");
    var bannerBox = document.getElementById("plEditBanner");

    sheet.addEventListener("click", function (e) {
      var b = e.target.closest("[data-pick]");
      if (!b) return;
      (b.dataset.pick === "banner" ? bannerFile : avatarFile).click();
    });
    avatarFile.addEventListener("change", function () {
      var f = avatarFile.files[0];
      if (f) preview(avatarBox, f, true);
    });
    bannerFile.addEventListener("change", function () {
      var f = bannerFile.files[0];
      if (f) { var u = URL.createObjectURL(f); bannerBox.style.backgroundImage = "url('" + u + "')"; }
    });
    function preview(box, file, round) {
      var u = URL.createObjectURL(file);
      box.querySelector("img") ? (box.querySelector("img").src = u)
        : box.insertAdjacentHTML("afterbegin", '<img src="' + u + '" alt="">');
      var span = box.querySelector("span"); if (span) span.remove();
    }

    document.getElementById("plEditProfileSave").addEventListener("click", function () {
      var btn = this; btn.disabled = true;
      var fd = new FormData();
      fd.append("display_name", document.getElementById("plEditName").value.trim());
      if (avatarFile.files[0]) fd.append("avatar", avatarFile.files[0]);
      if (bannerFile.files[0]) fd.append("banner", bannerFile.files[0]);
      fetch("/api/pl/profile", { method: "POST", body: fd })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          btn.disabled = false;
          if (!j.ok) { window.plToast("Ging nicht."); return; }
          location.reload();
        })
        .catch(function () { btn.disabled = false; window.plToast("Ging nicht."); });
    });
  }
})();
