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
    const newBlockBtn = document.getElementById("studioNewBlockBtn");
    const contextMenu = document.getElementById("studioContextMenu");
    const contextProgramBtn = document.getElementById("studioContextProgramBtn");
    const contextDeleteBtn = document.getElementById("studioContextDeleteBtn");
    const codePanel = document.getElementById("studioCodePanel");
    const codePanelHeader = document.getElementById("studioCodePanelHeader");
    const codePanelTitle = document.getElementById("studioCodePanelTitle");
    const codePanelClose = document.getElementById("studioCodePanelClose");
    const codeTextarea = document.getElementById("studioCodeTextarea");
    const codePanelResize = document.getElementById("studioCodePanelResize");

    let blocks = [];
    let selectedId = null;
    let contextBlockId = null;
    let codeBlockId = null;
    let saveTimer = null;

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
        el.querySelector(".studio-block-label").textContent = b.name;
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
        propColor.value = b.color;
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
        });
    }

    newBlockBtn.addEventListener("click", () => {
        api(`/api/studio/${projectId}/block`, "POST", { name: "Block" }).then((res) => {
            if (!res.ok) return;
            blocks.push(res.block);
            selectBlock(res.block.id);
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

    // --- Code panel: the DSL editor with its immutable "⇒" / "⇓" glyphs ---
    const ARROW = "⇒";
    const END = "⇓";

    function normalizeCode(raw, cursorPos) {
        const before = raw.slice(0, cursorPos);
        const cursorLineIndex = before.split("\n").length - 1;
        const cursorCol = before.length - (before.lastIndexOf("\n") + 1);

        const rawLines = raw.split("\n");
        const contentLines = rawLines.map((l) => {
            if (l.trim() === END) return { end: true, text: "" };
            return { end: false, text: l.replace(new RegExp("^\\s*" + ARROW + "\\s?"), "") };
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

    codeTextarea.addEventListener("input", () => {
        const result = normalizeCode(codeTextarea.value, codeTextarea.selectionStart);
        codeTextarea.value = result.text;
        codeTextarea.setSelectionRange(result.cursor, result.cursor);
        if (!codeBlockId) return;
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            api(`/api/studio/${projectId}/block/${codeBlockId}`, "POST", { script_code: codeTextarea.value });
        }, 500);
    });

    function openCodePanel(blockId) {
        const b = getBlock(blockId);
        if (!b) return;
        codeBlockId = blockId;
        codePanelTitle.textContent = "Programmierung: " + b.name;
        codeTextarea.value = b.script_code && b.script_code.trim() ? b.script_code : ARROW + " ";
        codePanel.style.display = "flex";
    }

    contextProgramBtn.addEventListener("click", () => {
        if (contextBlockId) openCodePanel(contextBlockId);
        contextMenu.style.display = "none";
    });

    codePanelClose.addEventListener("click", () => {
        codePanel.style.display = "none";
        codeBlockId = null;
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
