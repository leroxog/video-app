(function () {
  "use strict";
  var feed = document.getElementById("plVidFeed");
  if (!feed) return;
  var S = window.plSound || { play: function () {} };

  // autoplay the section in view, pause the rest
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      var v = e.target.querySelector("video");
      if (!v) return;
      if (e.isIntersecting && e.intersectionRatio > 0.6) {
        v.play().then(function () { e.target.classList.remove("paused"); }).catch(function () {});
      } else {
        v.pause();
      }
    });
  }, { threshold: [0, 0.6, 1] });

  document.querySelectorAll(".pl-vid").forEach(function (sec) {
    io.observe(sec);
    var v = sec.querySelector("video");
    var muteBtn = sec.querySelector(".pl-vid-mute");
    var playBtn = sec.querySelector(".pl-vid-play");

    function togglePlay() {
      if (v.paused) { v.play(); sec.classList.remove("paused"); }
      else { v.pause(); sec.classList.add("paused"); }
    }
    playBtn.addEventListener("click", togglePlay);
    v.addEventListener("click", togglePlay);
    v.addEventListener("pause", function () { sec.classList.add("paused"); });
    v.addEventListener("play", function () { sec.classList.remove("paused"); });

    muteBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      v.muted = !v.muted;
      muteBtn.textContent = v.muted ? "🔇" : "🔊";
      if (!v.muted) v.play().catch(function () {});
    });

    var likeBtn = sec.querySelector("[data-vlike]");
    likeBtn.addEventListener("click", function () {
      var id = sec.dataset.postId;
      fetch("/api/pl/posts/" + id + "/like", { method: "POST" })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (!j.ok) return;
          sec.dataset.liked = j.liked ? "1" : "0";
          likeBtn.classList.toggle("liked", j.liked);
          likeBtn.querySelector(".pl-like-count").textContent = j.like_count;
          if (j.liked) S.play("like");
        });
    });

    var shareBtn = sec.querySelector("[data-vshare]");
    shareBtn.addEventListener("click", function () {
      var id = sec.dataset.postId;
      fetch("/api/pl/posts/" + id + "/share", { method: "POST" })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (!j.ok) return;
          shareBtn.querySelector(".pl-share-count").textContent = j.share_count;
          var link = location.origin + "/p/" + id;
          if (navigator.share) navigator.share({ title: "HEXAGONUM", url: link }).catch(function () {});
          else if (navigator.clipboard) navigator.clipboard.writeText(link).then(function () { window.plToast("Link kopiert."); });
        });
    });
  });
})();
