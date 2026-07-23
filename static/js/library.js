(function () {
    const STORAGE_KEY = "timeskip_installed_apps";
    const grid = document.getElementById("libraryGrid");
    const emptyState = document.getElementById("libraryEmptyState");
    if (!grid) return;

    let installed = [];
    try {
        installed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    } catch (e) {
        installed = [];
    }

    function save() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(installed));
    }

    function buildCard(item) {
        const card = document.createElement("div");
        card.className = "game-card game-card-installable";

        // Not a link -- entry is only allowed via the "Öffnen" button below.
        const link = document.createElement("div");
        link.className = "game-card-webapp-linkarea";

        const thumb = document.createElement("div");
        thumb.className = "game-card-thumb game-card-thumb-appicon";
        if (item.iconUrl) {
            const img = document.createElement("img");
            img.className = "game-card-appicon-img";
            img.src = item.iconUrl;
            img.alt = "";
            thumb.appendChild(img);
        } else {
            const placeholder = document.createElement("div");
            placeholder.className = "game-card-thumb-webapp-icon-wrap";
            placeholder.textContent = "🌐";
            thumb.appendChild(placeholder);
        }

        const info = document.createElement("div");
        info.className = "game-card-info";
        const title = document.createElement("div");
        title.className = "game-card-title";
        title.textContent = item.name || item.url;
        info.appendChild(title);

        link.appendChild(thumb);
        link.appendChild(info);

        const actions = document.createElement("div");
        actions.className = "game-card-library-actions";

        const openBtn = document.createElement("button");
        openBtn.type = "button";
        openBtn.className = "game-card-app-action";
        openBtn.dataset.state = "open";
        openBtn.textContent = "Öffnen";
        openBtn.addEventListener("click", () => { window.location.href = item.url; });

        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "game-card-library-remove";
        removeBtn.textContent = "Entfernen";
        removeBtn.addEventListener("click", () => {
            installed = installed.filter((i) => i.url !== item.url);
            save();
            card.remove();
            if (installed.length === 0) emptyState.style.display = "block";
        });

        actions.appendChild(openBtn);
        actions.appendChild(removeBtn);

        card.appendChild(link);
        card.appendChild(actions);
        return card;
    }

    if (installed.length === 0) {
        emptyState.style.display = "block";
    } else {
        installed.forEach((item) => grid.appendChild(buildCard(item)));
    }
})();
