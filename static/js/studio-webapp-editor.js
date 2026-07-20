(function () {
    const page = document.getElementById("webappEditorPage");
    if (!page) return;
    const projectId = page.dataset.projectId;

    const textarea = document.getElementById("webappCodeTextarea");
    const saveBtn = document.getElementById("webappSaveBtn");
    const previewFrame = document.getElementById("webappPreviewFrame");
    const refreshPreviewBtn = document.getElementById("webappRefreshPreviewBtn");

    const settingsBtn = document.getElementById("webappSettingsBtn");
    const settingsPanel = document.getElementById("webappSettingsPanel");
    const settingsCloseBtn = document.getElementById("webappSettingsCloseBtn");
    const slugInput = document.getElementById("webappSlugInput");
    const slugSaveBtn = document.getElementById("webappSlugSaveBtn");
    const slugNote = document.getElementById("webappSlugNote");
    const urlRow = document.getElementById("webappUrlRow");
    const urlDisplay = document.getElementById("webappUrlDisplay");
    const urlCopyBtn = document.getElementById("webappUrlCopyBtn");

    // The preview renders the current textarea content client-side, inside
    // the exact same sandbox restrictions the real published page uses (no
    // allow-same-origin, no top navigation) -- so what you see here already
    // reflects what a visitor's browser will and won't let the page do.
    function refreshPreview() {
        previewFrame.srcdoc = textarea.value;
    }
    refreshPreviewBtn.addEventListener("click", refreshPreview);
    refreshPreview();

    let saveTimer = null;
    function saveCode() {
        fetch(`/api/studio/${projectId}/web-code`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ web_code: textarea.value }),
        });
    }
    textarea.addEventListener("input", () => {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(saveCode, 1500);
    });
    saveBtn.addEventListener("click", () => {
        clearTimeout(saveTimer);
        saveCode();
        refreshPreview();
    });

    settingsBtn.addEventListener("click", () => { settingsPanel.style.display = "flex"; });
    settingsCloseBtn.addEventListener("click", () => { settingsPanel.style.display = "none"; });

    slugSaveBtn.addEventListener("click", () => {
        const slug = slugInput.value.trim().toLowerCase();
        slugNote.textContent = "";
        fetch(`/api/studio/${projectId}/web-slug`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ web_slug: slug }),
        })
            .then((res) => res.json())
            .then((data) => {
                if (!data.ok) {
                    slugNote.textContent = data.message || "Dieser Name geht leider nicht.";
                    return;
                }
                urlDisplay.value = data.web_url;
                urlRow.style.display = "flex";
                slugNote.textContent = "Gespeichert!";
            })
            .catch(() => { slugNote.textContent = "Fehler beim Speichern."; });
    });

    urlCopyBtn.addEventListener("click", () => {
        navigator.clipboard.writeText(urlDisplay.value).then(() => {
            urlCopyBtn.textContent = "Kopiert ✓";
            setTimeout(() => { urlCopyBtn.textContent = "Kopieren"; }, 1500);
        }).catch(() => {});
    });
})();
