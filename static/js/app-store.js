(function () {
    // Must match the service worker's own CACHE_NAME (service-worker.js) --
    // its navigate handler falls back to caches.match(request) against this
    // same store when offline, so pre-warming it here from a "Laden" click
    // is what makes the app actually openable without a network afterwards.
    const CACHE_NAME = "timeskip-shell-v1";
    const STORAGE_KEY = "timeskip_installed_apps";

    function getInstalled() {
        try {
            return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
        } catch (e) {
            return [];
        }
    }

    function markInstalled(slug) {
        const installed = getInstalled();
        if (!installed.includes(slug)) {
            installed.push(slug);
            localStorage.setItem(STORAGE_KEY, JSON.stringify(installed));
        }
    }

    function setButtonState(button, state, label) {
        button.dataset.state = state;
        button.textContent = label;
    }

    function initCard(card) {
        const button = card.querySelector(".game-card-app-action");
        const slug = card.dataset.appSlug;
        const url = card.dataset.appUrl;
        if (!button || !slug || !url) return;

        if (getInstalled().includes(slug)) {
            setButtonState(button, "open", "Öffnen");
        }

        button.addEventListener("click", (event) => {
            event.preventDefault();
            if (button.dataset.state === "installing") return;
            if (button.dataset.state === "open") {
                window.location.href = url;
                return;
            }

            setButtonState(button, "installing", "Wird geladen …");
            if (!("caches" in window)) {
                setButtonState(button, "error", "Nicht unterstützt");
                setTimeout(() => setButtonState(button, "download", "Laden"), 2500);
                return;
            }
            caches.open(CACHE_NAME)
                .then((cache) => cache.add(url))
                .then(() => {
                    markInstalled(slug);
                    setButtonState(button, "open", "Öffnen");
                })
                .catch(() => {
                    setButtonState(button, "error", "Fehlgeschlagen");
                    setTimeout(() => setButtonState(button, "download", "Laden"), 2500);
                });
        });
    }

    document.querySelectorAll(".game-card-webapp").forEach(initCard);
})();
