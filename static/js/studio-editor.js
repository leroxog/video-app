(function () {
    const page = document.getElementById("studioEditorPage");
    if (!page) return;
    const projectId = page.dataset.projectId;

    const canvas = document.getElementById("studioCanvas");
    const blockList = document.getElementById("studioBlockList");
    const propsEmpty = document.getElementById("studioPropsEmpty");
    const propsForm = document.getElementById("studioPropsForm");
    const propName = document.getElementById("studioPropName");
    const propColor = document.getElementById("studioPropColor");
    const propsKind = document.getElementById("studioPropsKind");
    const newBlockBtn = document.getElementById("studioNewBlockBtn");
    const newBlockMenu = document.getElementById("studioNewBlockMenu");
    const contextMenu = document.getElementById("studioContextMenu");
    const contextDeleteBtn = document.getElementById("studioContextDeleteBtn");
    const toggleCodeBtn = document.getElementById("studioToggleCodeBtn");
    const codePanel = document.getElementById("studioCodePanel");
    const codePanelHeader = document.getElementById("studioCodePanelHeader");
    const codePanelClose = document.getElementById("studioCodePanelClose");
    const codeTextarea = document.getElementById("studioCodeTextarea");
    const codeGhost = document.getElementById("studioCodeGhost");
    const codePanelResize = document.getElementById("studioCodePanelResize");

    let blocks = [];
    let selectedId = null;
    let contextBlockId = null;
    let saveTimer = null;
    let currentSuggestion = "";

    function api(path, method, body) {
        return fetch(path, {
            method: method || "GET",
            headers: body ? { "Content-Type": "application/json" } : undefined,
            body: body ? JSON.stringify(body) : undefined,
        }).then((r) => r.json());
    }

    function getBlock(id) {
        return blocks.find((b) => b.id === id) || null;
    }

    function kindLabel(b) {
        if (b.kind === "spawn") return "Spawn-Punkt — hier startet jeder Spieler.";
        if (b.kind === "checkpoint") return "Checkpoint — einmal berührt, spawnt man ab dann hier.";
        return "Normaler Block.";
    }

    function renderBlockList() {
        blockList.innerHTML = "";
        blocks.forEach((b) => {
            const li = document.createElement("li");
            li.className = "studio-block-list-item" + (b.id === selectedId ? " is-selected" : "");
            li.dataset.blockId = b.id;
            const swatch = document.createElement("span");
            swatch.className = "studio-block-list-swatch";
            swatch.style.background = b.color;
            const name = document.createElement("span");
            name.textContent = b.name;
            li.appendChild(swatch);
            li.appendChild(name);
            li.addEventListener("click", () => selectBlock(b.id));
            blockList.appendChild(li);
        });
    }

    function renderBlockEl(b) {
        let el = canvas.querySelector(`[data-block-id="${b.id}"]`);
        if (!el) {
            el = document.createElement("div");
            el.className = "studio-block";
            el.dataset.blockId = b.id;
            const label = document.createElement("span");
            label.className = "studio-block-label";
            el.appendChild(label);
            const handle = document.createElement("div");
            handle.className = "studio-block-resize-handle";
            el.appendChild(handle);
            attachBlockInteractions(el, handle);
            canvas.appendChild(el);
        }
        el.style.left = b.x + "px";
        el.style.top = b.y + "px";
        el.style.width = b.width + "px";
        el.style.height = b.height + "px";
        el.style.background = b.color;
        el.classList.toggle("is-selected", b.id === selectedId);
        const label = el.querySelector(".studio-block-label");
        const badge = b.kind === "spawn" ? " (Spawn)" : b.kind === "checkpoint" ? " (Checkpoint)" : "";
        label.textContent = b.name + badge;
    }

    function renderCanvas() {
        const keep = new Set(blocks.map((b) => String(b.id)));
        canvas.querySelectorAll(".studio-block").forEach((el) => {
            if (!keep.has(el.dataset.blockId)) el.remove();
        });
        blocks.forEach(renderBlockEl);
    }

    function selectBlock(id) {
        selectedId = id;
        renderCanvas();
        renderBlockList();
        const b = getBlock(id);
        if (!b) {
            propsEmpty.style.display = "block";
            propsForm.style.display = "none";
            return;
        }
        propsEmpty.style.display = "none";
        propsForm.style.display = "flex";
        propName.value = b.name;
        propName.disabled = !!b.is_default;
        propColor.value = b.color;
        propsKind.textContent = kindLabel(b);
    }

    function patchBlock(id, patch) {
        const b = getBlock(id);
        if (!b) return;
        Object.assign(b, patch);
        renderBlockEl(b);
        if (id === selectedId) renderBlockList();
        api(`/api/studio/${projectId}/block/${id}`, "POST", patch).then((res) => {
            if (res.ok) Object.assign(b, res.block);
        });
    }

    function loadState() {
        api(`/api/studio/${projectId}/state`).then((res) => {
            if (!res.ok) return;
            blocks = res.blocks;
            if (!selectedId && blocks.length) selectedId = blocks[0].id;
            renderCanvas();
            renderBlockList();
            selectBlock(selectedId);
            codeTextarea.value = res.script_code && res.script_code.trim() ? res.script_code : ARROW + " ";
            updateGhost();
        });
    }

    function createBlock(kind) {
        api(`/api/studio/${projectId}/block`, "POST", { kind }).then((res) => {
            if (!res.ok) return;
            blocks.push(res.block);
            selectBlock(res.block.id);
        });
    }

    newBlockBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        newBlockMenu.style.display = newBlockMenu.style.display === "none" ? "flex" : "none";
    });
    newBlockMenu.querySelectorAll("button").forEach((btn) => {
        btn.addEventListener("click", () => {
            createBlock(btn.dataset.kind);
            newBlockMenu.style.display = "none";
        });
    });

    propName.addEventListener("change", () => {
        if (!selectedId) return;
        const b = getBlock(selectedId);
        if (b && b.is_default) {
            propName.value = b.name;
            return;
        }
        patchBlock(selectedId, { name: propName.value.trim() || (b ? b.name : "Block") });
    });

    propColor.addEventListener("input", () => {
        if (!selectedId) return;
        patchBlock(selectedId, { color: propColor.value });
    });

    function attachBlockInteractions(el, handle) {
        el.addEventListener("click", (e) => {
            e.stopPropagation();
            selectBlock(Number(el.dataset.blockId));
        });

        el.addEventListener("contextmenu", (e) => {
            e.preventDefault();
            contextBlockId = Number(el.dataset.blockId);
            selectBlock(contextBlockId);
            contextMenu.style.left = e.clientX + "px";
            contextMenu.style.top = e.clientY + "px";
            contextMenu.style.display = "flex";
        });

        let dragging = false;
        let startX = 0;
        let startY = 0;
        let origX = 0;
        let origY = 0;

        el.addEventListener("pointerdown", (e) => {
            if (e.target === handle) return;
            dragging = true;
            el.setPointerCapture(e.pointerId);
            startX = e.clientX;
            startY = e.clientY;
            const b = getBlock(Number(el.dataset.blockId));
            origX = b.x;
            origY = b.y;
        });
        el.addEventListener("pointermove", (e) => {
            if (!dragging) return;
            const b = getBlock(Number(el.dataset.blockId));
            b.x = Math.max(0, origX + (e.clientX - startX));
            b.y = Math.max(0, origY + (e.clientY - startY));
            renderBlockEl(b);
        });
        el.addEventListener("pointerup", (e) => {
            if (!dragging) return;
            dragging = false;
            const b = getBlock(Number(el.dataset.blockId));
            patchBlock(b.id, { x: b.x, y: b.y });
        });

        let resizing = false;
        let rStartX = 0;
        let rStartY = 0;
        let origW = 0;
        let origH = 0;

        handle.addEventListener("pointerdown", (e) => {
            e.stopPropagation();
            resizing = true;
            handle.setPointerCapture(e.pointerId);
            rStartX = e.clientX;
            rStartY = e.clientY;
            const b = getBlock(Number(el.dataset.blockId));
            origW = b.width;
            origH = b.height;
        });
        handle.addEventListener("pointermove", (e) => {
            if (!resizing) return;
            e.stopPropagation();
            const b = getBlock(Number(el.dataset.blockId));
            b.width = Math.max(20, origW + (e.clientX - rStartX));
            b.height = Math.max(20, origH + (e.clientY - rStartY));
            renderBlockEl(b);
        });
        handle.addEventListener("pointerup", (e) => {
            if (!resizing) return;
            e.stopPropagation();
            resizing = false;
            const b = getBlock(Number(el.dataset.blockId));
            patchBlock(b.id, { width: b.width, height: b.height });
        });
    }

    document.addEventListener("click", () => {
        contextMenu.style.display = "none";
        newBlockMenu.style.display = "none";
    });

    contextDeleteBtn.addEventListener("click", () => {
        const b = getBlock(contextBlockId);
        if (!b || b.is_default) {
            contextMenu.style.display = "none";
            return;
        }
        api(`/api/studio/${projectId}/block/${b.id}/delete`, "POST").then((res) => {
            if (!res.ok) return;
            blocks = blocks.filter((x) => x.id !== b.id);
            if (selectedId === b.id) selectedId = blocks.length ? blocks[0].id : null;
            selectBlock(selectedId);
        });
        contextMenu.style.display = "none";
    });

    toggleCodeBtn.addEventListener("click", () => {
        codePanel.style.display = codePanel.style.display === "none" ? "flex" : "none";
    });
    codePanelClose.addEventListener("click", () => {
        codePanel.style.display = "none";
    });

    // --- Code panel: one shared DSL script for the whole game, with its
    // immutable "⇒" / "⇓" glyphs and inline ghost-text suggestions. ---
    const ARROW = "⇒";
    const END = "⇓";
    const TRIGGER_WORDS = ["touch", "click"];
    const EFFECT_WORDS = ["kill", "give", "move", "trampoline", "teleport", "transparents"];
    const COLLIDE_WORDS = ["canColide(.true)", "canColide(.false)"];
    const INFINITE_WORD = "infinit.true";

    function stripArrow(line) {
        return line.replace(new RegExp("^\\s*" + ARROW + "\\s?"), "");
    }

    function normalizeCode(raw, cursorPos) {
        const before = raw.slice(0, cursorPos);
        const cursorLineIndex = before.split("\n").length - 1;
        const cursorCol = before.length - (before.lastIndexOf("\n") + 1);

        const rawLines = raw.split("\n");
        const contentLines = rawLines.map((l) => {
            if (l.trim() === END) return { end: true, text: "" };
            return { end: false, text: stripArrow(l) };
        });

        const hasEndMarker = contentLines.some((l) => l.end);
        let finalized = hasEndMarker;

        if (!hasEndMarker) {
            const n = contentLines.length;
            if (n >= 3 && contentLines[n - 1].text === "" && contentLines[n - 2].text === "" &&
                contentLines.slice(0, n - 2).some((l) => l.text.trim() !== "")) {
                contentLines.splice(n - 2, 2);
                finalized = true;
            }
        }

        const outLines = [];
        let newCursorLine = 0;
        let newCursorCol = 0;
        let consumedEnd = false;
        contentLines.forEach((l, idx) => {
            if (l.end) {
                if (!consumedEnd) {
                    outLines.push(END);
                    consumedEnd = true;
                }
                return;
            }
            outLines.push(ARROW + " " + l.text);
            if (idx === cursorLineIndex) {
                newCursorLine = outLines.length - 1;
                newCursorCol = 2 + cursorCol;
            }
        });
        if (finalized && !consumedEnd) outLines.push(END);

        const text = outLines.join("\n");
        const lineStarts = [];
        let pos = 0;
        outLines.forEach((l) => {
            lineStarts.push(pos);
            pos += l.length + 1;
        });
        const clampedLine = Math.min(newCursorLine, lineStarts.length - 1);
        const newCursor = Math.min(
            text.length,
            lineStarts[clampedLine] + Math.min(newCursorCol, outLines[clampedLine].length)
        );
        return { text, cursor: newCursor };
    }

    function suggestCompletion(candidates, typed) {
        const lower = typed.toLowerCase();
        if (!lower) return candidates[0] || "";
        const match = candidates.find((c) => c.toLowerCase().startsWith(lower) && c.toLowerCase() !== lower);
        return match ? match.slice(typed.length) : "";
    }

    // Rules are two content lines now: `"Block"=trigger` then the effect
    // (optionally `=duration`), closed by canColide(...).
    function computeGhostSuggestion(fullText, cursorPos) {
        const before = fullText.slice(0, cursorPos);
        const lines = before.split("\n");
        const currentLineText = stripArrow(lines[lines.length - 1]);

        const priorLines = lines.slice(0, -1)
            .map((l) => stripArrow(l).trim())
            .filter((l) => l && l !== END);

        let sinceBoundary = [];
        for (const l of priorLines) {
            if (/canColide\s*\(/i.test(l)) {
                sinceBoundary = [];
            } else {
                sinceBoundary.push(l);
            }
        }

        const hasInfinite = sinceBoundary.length > 0 && /^infinit\.true$/i.test(sinceBoundary[0]);
        const slot = hasInfinite ? sinceBoundary.length - 1 : sinceBoundary.length;

        if (slot === 0) {
            const eqIdx = currentLineText.indexOf("=");
            if (eqIdx === -1) {
                const candidates = blocks.map((b) => `"${b.name}"`).concat([INFINITE_WORD]);
                return suggestCompletion(candidates, currentLineText);
            }
            return suggestCompletion(TRIGGER_WORDS.concat([","]), currentLineText.slice(eqIdx + 1));
        }
        if (slot === 1) {
            if (!/[\s="]/.test(currentLineText)) {
                return suggestCompletion(EFFECT_WORDS, currentLineText);
            }
            return "";
        }
        if (slot === 2) {
            return suggestCompletion(COLLIDE_WORDS, currentLineText);
        }
        return "";
    }

    function escapeHtml(text) {
        return text
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
    }

    function updateGhost() {
        const cursor = codeTextarea.selectionStart;
        currentSuggestion = codeTextarea.selectionStart === codeTextarea.selectionEnd
            ? computeGhostSuggestion(codeTextarea.value, cursor)
            : "";
        const before = codeTextarea.value.slice(0, cursor);
        const after = codeTextarea.value.slice(cursor);
        codeGhost.innerHTML = escapeHtml(before) +
            (currentSuggestion ? `<span class="ghost-suggestion">${escapeHtml(currentSuggestion)}</span>` : "") +
            escapeHtml(after);
    }

    function acceptSuggestion() {
        if (!currentSuggestion) return false;
        const cursor = codeTextarea.selectionStart;
        const value = codeTextarea.value;
        codeTextarea.value = value.slice(0, cursor) + currentSuggestion + value.slice(cursor);
        const newCursor = cursor + currentSuggestion.length;
        codeTextarea.setSelectionRange(newCursor, newCursor);
        currentSuggestion = "";
        return true;
    }

    function saveScript() {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            api(`/api/studio/${projectId}/script`, "POST", { script_code: codeTextarea.value });
        }, 500);
    }

    codeTextarea.addEventListener("input", () => {
        const result = normalizeCode(codeTextarea.value, codeTextarea.selectionStart);
        codeTextarea.value = result.text;
        codeTextarea.setSelectionRange(result.cursor, result.cursor);
        updateGhost();
        saveScript();
    });

    codeTextarea.addEventListener("keydown", (e) => {
        if ((e.key === "Tab" || e.key === "ArrowRight") && currentSuggestion) {
            const cursor = codeTextarea.selectionStart;
            const atEnd = cursor === codeTextarea.selectionEnd &&
                (e.key === "Tab" || codeTextarea.value.slice(cursor, cursor + 1).match(/^($|\n)/));
            if (atEnd) {
                e.preventDefault();
                if (acceptSuggestion()) {
                    updateGhost();
                    saveScript();
                }
            }
        }
    });
    codeTextarea.addEventListener("keyup", (e) => {
        if (e.key === "Tab" || e.key === "ArrowRight") return;
        updateGhost();
    });
    codeTextarea.addEventListener("click", updateGhost);
    codeTextarea.addEventListener("scroll", () => {
        codeGhost.scrollTop = codeTextarea.scrollTop;
        codeGhost.scrollLeft = codeTextarea.scrollLeft;
    });

    (function makeDraggable() {
        let dragging = false;
        let startX = 0;
        let startY = 0;
        let origLeft = 0;
        let origTop = 0;
        codePanelHeader.addEventListener("pointerdown", (e) => {
            if (e.target === codePanelClose) return;
            dragging = true;
            codePanelHeader.setPointerCapture(e.pointerId);
            startX = e.clientX;
            startY = e.clientY;
            const rect = codePanel.getBoundingClientRect();
            origLeft = rect.left;
            origTop = rect.top;
        });
        codePanelHeader.addEventListener("pointermove", (e) => {
            if (!dragging) return;
            codePanel.style.left = Math.max(0, origLeft + (e.clientX - startX)) + "px";
            codePanel.style.top = Math.max(0, origTop + (e.clientY - startY)) + "px";
        });
        codePanelHeader.addEventListener("pointerup", () => { dragging = false; });
    })();

    (function makeResizable() {
        let resizing = false;
        let startX = 0;
        let startY = 0;
        let origW = 0;
        let origH = 0;
        codePanelResize.addEventListener("pointerdown", (e) => {
            resizing = true;
            codePanelResize.setPointerCapture(e.pointerId);
            startX = e.clientX;
            startY = e.clientY;
            const rect = codePanel.getBoundingClientRect();
            origW = rect.width;
            origH = rect.height;
        });
        codePanelResize.addEventListener("pointermove", (e) => {
            if (!resizing) return;
            codePanel.style.width = Math.max(260, origW + (e.clientX - startX)) + "px";
            codePanel.style.height = Math.max(180, origH + (e.clientY - startY)) + "px";
        });
        codePanelResize.addEventListener("pointerup", () => { resizing = false; });
    })();

    loadState();
})();
