(function () {
    const page = document.getElementById("webappEditorPage");
    if (!page) return;
    const projectId = page.dataset.projectId;

    const textarea = document.getElementById("webappCodeTextarea");
    const previewFrame = document.getElementById("webappPreviewFrame");
    const refreshPreviewBtn = document.getElementById("webappRefreshPreviewBtn");
    const undoBtn = document.getElementById("webappUndoBtn");

    const settingsBtn = document.getElementById("webappSettingsBtn");
    const settingsPanel = document.getElementById("webappSettingsPanel");
    const settingsCloseBtn = document.getElementById("webappSettingsCloseBtn");
    const slugInput = document.getElementById("webappSlugInput");
    const slugSaveBtn = document.getElementById("webappSlugSaveBtn");
    const slugNote = document.getElementById("webappSlugNote");
    const urlRow = document.getElementById("webappUrlRow");
    const urlDisplay = document.getElementById("webappUrlDisplay");
    const urlCopyBtn = document.getElementById("webappUrlCopyBtn");
    const iconInput = document.getElementById("webappIconInput");
    const iconPreview = document.getElementById("webappIconPreview");
    const iconNote = document.getElementById("webappIconNote");

    // The preview renders the current textarea content client-side, inside
    // the exact same sandbox restrictions the real published page uses (no
    // allow-same-origin, no top navigation) -- so what you see here already
    // reflects what a visitor's browser will and won't let the page do.
    // The textarea itself is hidden (see the "hidden" attribute in the
    // template) -- it's still what holds the current code and gets the
    // preview refreshed from, but there's no way to type into it anymore:
    // every change now comes from the AI accepting a propose_project_change
    // (see base.html's addChangeProposal, which sets .value, dispatches
    // "input" here, and separately POSTs the save itself -- no debounced
    // auto-save needed here anymore since nothing else writes to it).
    function refreshPreview() {
        previewFrame.srcdoc = textarea.value;
    }
    refreshPreviewBtn.addEventListener("click", refreshPreview);
    refreshPreview();
    textarea.addEventListener("input", refreshPreview);

    // Exposed so base.html's AI-change-accept handler can refresh both the
    // preview and this button's enabled state right after a change lands,
    // without this file needing to know anything about the chat UI.
    window.__nexaiWebappCodeApplied = function () {
        refreshPreview();
        if (undoBtn) undoBtn.disabled = false;
    };

    if (undoBtn) {
        undoBtn.disabled = page.dataset.hasPrevious !== "true";
        undoBtn.addEventListener("click", () => {
            undoBtn.disabled = true;
            fetch(`/api/studio/${projectId}/undo-web-code`, { method: "POST" })
                .then((res) => res.json())
                .then((data) => {
                    if (!data.ok) { undoBtn.disabled = false; return; }
                    textarea.value = data.web_code || "";
                    refreshPreview();
                    // Single-level undo -- once used, there's nothing further
                    // back to step to until the AI makes a new change.
                    undoBtn.disabled = true;
                })
                .catch(() => { undoBtn.disabled = false; });
        });
    }

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

    iconInput.addEventListener("change", () => {
        const file = iconInput.files[0];
        if (!file) return;
        iconNote.textContent = "Wird hochgeladen …";
        const formData = new FormData();
        formData.append("icon", file);
        fetch(`/api/studio/${projectId}/icon`, { method: "POST", body: formData })
            .then((res) => res.json())
            .then((data) => {
                if (!data.ok) {
                    iconNote.textContent = data.message || "Das Symbol konnte nicht hochgeladen werden.";
                    return;
                }
                iconPreview.innerHTML = `<img src="${data.icon_url}" alt="">`;
                iconNote.textContent = "Gespeichert!";
            })
            .catch(() => { iconNote.textContent = "Fehler beim Hochladen."; });
    });

    urlCopyBtn.addEventListener("click", () => {
        navigator.clipboard.writeText(urlDisplay.value).then(() => {
            urlCopyBtn.textContent = "Kopiert ✓";
            setTimeout(() => { urlCopyBtn.textContent = "Kopieren"; }, 1500);
        }).catch(() => {});
    });
})();
