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

    function isInstalled(key) {
        return getInstalled().some((item) => item.url === key);
    }

    function markInstalled(item) {
        const installed = getInstalled();
        if (!installed.some((existing) => existing.url === item.url)) {
            installed.push(item);
            localStorage.setItem(STORAGE_KEY, JSON.stringify(installed));
        }
    }

    function setButtonState(button, state, label) {
        button.dataset.state = state;
        button.textContent = label;
    }

    // A Web-in-Web-App's whole page is one self-contained document (its
    // code runs from an inline srcdoc iframe), so caching that one URL is
    // enough. A game's page instead pulls in separate JS/CSS files -- those
    // need caching too, or the page loads offline but renders broken.
    function extractSameOriginAssetUrls(html) {
        const doc = new DOMParser().parseFromString(html, "text/html");
        const urls = [];
        doc.querySelectorAll('script[src], link[rel="stylesheet"][href]').forEach((el) => {
            const src = el.getAttribute("src") || el.getAttribute("href");
            if (src && src.startsWith("/static/")) urls.push(src);
        });
        return urls;
    }

    function installUrl(url) {
        return caches.open(CACHE_NAME).then((cache) =>
            fetch(url).then((response) => {
                if (!response.ok) throw new Error("Netzwerkantwort war nicht ok.");
                const stored = response.clone();
                return response.text().then((html) => {
                    cache.put(url, stored);
                    const assetUrls = extractSameOriginAssetUrls(html);
                    return Promise.all(assetUrls.map((assetUrl) =>
                        fetch(assetUrl)
                            .then((assetResponse) => {
                                if (assetResponse.ok) cache.put(assetUrl, assetResponse);
                            })
                            .catch(() => {})
                    ));
                });
            })
        );
    }

    function initCard(card) {
        const button = card.querySelector(".game-card-app-action");
        const url = card.dataset.appUrl;
        if (!button || !url) return;

        if (isInstalled(url)) {
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
            installUrl(url)
                .then(() => {
                    markInstalled({
                        url: url,
                        name: card.dataset.appName || url,
                        iconUrl: card.dataset.appIcon || null,
                    });
                    setButtonState(button, "open", "Öffnen");
                })
                .catch(() => {
                    setButtonState(button, "error", "Fehlgeschlagen");
                    setTimeout(() => setButtonState(button, "download", "Laden"), 2500);
                });
        });
    }

    document.querySelectorAll(".game-card-installable").forEach(initCard);
})();
