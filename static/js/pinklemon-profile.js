(function () {
  "use strict";
  var wrap = document.querySelector(".pl-profile");
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
      .then(function (j) {
        if (j.ok) location.href = "/freunde/c/" + j.chat_id;
      });
  });
})();
