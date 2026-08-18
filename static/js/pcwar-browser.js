(() => {
  const HOME_URL = "/static/pcwar-newtab.html";
  const frame = document.getElementById("pcwarBrowserFrame");
  const form = document.getElementById("pcwarBrowserForm");
  const urlInput = document.getElementById("pcwarBrowserUrl");
  const homeBtn = document.getElementById("pcwarBrowserHome");
  const reloadBtn = document.getElementById("pcwarBrowserReload");

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

  function navigate(url) {
    frame.src = url;
    urlInput.value = url === HOME_URL ? "" : url;
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
