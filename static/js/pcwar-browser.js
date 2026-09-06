(() => {
  const HOME_URL = "/static/pcwar-newtab.html";
  const frame = document.getElementById("pcwarBrowserFrame");
  const form = document.getElementById("pcwarBrowserForm");
  const urlInput = document.getElementById("pcwarBrowserUrl");
  const homeBtn = document.getElementById("pcwarBrowserHome");
  const reloadBtn = document.getElementById("pcwarBrowserReload");
  const openedNotice = document.getElementById("pcwarBrowserOpenedNotice");

  function resolveAddress(raw) {
    const value = raw.trim();
    if (!value) return HOME_URL;
    const looksLikeUrl =
      /^https?:\/\//i.test(value) ||
      (/^[\w.-]+\.[a-z]{2,}(:\d+)?(\/.*)?$/i.test(value) && !value.includes(" "));
    if (looksLikeUrl) {
      return /^[a-z]+:\/\//i.test(value) ? value : "https://" + value;
    }
    return "https://duckduckgo.com/?q=" + encodeURIComponent(value);
  }

  // Real sites send their own X-Frame-Options/CSP headers specifically to
  // stop other pages from embedding them -- that's a real security control
  // their operators chose, not a bug, and stripping it via a server-side
  // proxy would mean actually circumventing it, not simulating anything
  // (see this file's git history/PCwar's module docs for why that was
  // declined before, and is still declined now). The honest way to make
  // "visit any real site" actually work every time is to not fight that
  // control at all: external addresses open in a real new browser tab
  // instead of the iframe, which always works regardless of any site's
  // embedding policy. The iframe itself only ever shows this app's own
  // local start page.
  function navigate(url) {
    if (url === HOME_URL) {
      frame.src = url;
      urlInput.value = "";
      openedNotice.classList.add("hidden");
      return;
    }
    window.open(url, "_blank", "noopener");
    urlInput.value = url;
    openedNotice.textContent = "In neuem Tab geöffnet: " + url;
    openedNotice.classList.remove("hidden");
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    window.leroxGamesSounds.click();
    navigate(resolveAddress(urlInput.value));
  });

  homeBtn.addEventListener("click", () => {
    window.leroxGamesSounds.click();
    navigate(HOME_URL);
  });

  reloadBtn.addEventListener("click", () => {
    window.leroxGamesSounds.click();
    frame.src = frame.src;
  });

  navigate(HOME_URL);
})();
