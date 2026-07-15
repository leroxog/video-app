const PhotoTextOverlay = (function () {
    function attach(wrapperEl, imgEl) {
        const entries = [];

        function renderEntries() {
            wrapperEl.querySelectorAll(".photo-text-entry").forEach((el) => el.remove());
            entries.forEach((entry, index) => {
                const el = document.createElement("div");
                el.className = "photo-text-entry";
                el.style.left = entry.xPct + "%";
                el.style.top = entry.yPct + "%";
                el.textContent = entry.text;
                el.title = "Zum Entfernen antippen";
                el.addEventListener("click", (event) => {
                    event.stopPropagation();
                    entries.splice(index, 1);
                    renderEntries();
                });
                wrapperEl.appendChild(el);
            });
        }

        wrapperEl.addEventListener("click", (event) => {
            if (event.target !== imgEl && event.target !== wrapperEl) return;
            const rect = wrapperEl.getBoundingClientRect();
            const xPct = ((event.clientX - rect.left) / rect.width) * 100;
            const yPct = ((event.clientY - rect.top) / rect.height) * 100;

            const existingInput = wrapperEl.querySelector(".photo-text-input");
            if (existingInput) existingInput.remove();

            const input = document.createElement("input");
            input.type = "text";
            input.className = "photo-text-input";
            input.style.left = xPct + "%";
            input.style.top = yPct + "%";
            input.placeholder = "Text eingeben...";
            input.maxLength = 80;
            wrapperEl.appendChild(input);
            input.focus();

            function commit() {
                const text = input.value.trim();
                input.remove();
                if (text) {
                    entries.push({ xPct, yPct, text });
                    renderEntries();
                }
            }

            input.addEventListener("keydown", (e) => {
                if (e.key === "Enter") { e.preventDefault(); commit(); }
                if (e.key === "Escape") { e.preventDefault(); input.remove(); }
            });
            input.addEventListener("blur", commit);
            input.addEventListener("click", (e) => e.stopPropagation());
        });

        renderEntries();
        return { entries };
    }

    function compositeToBlob(file, entries) {
        return new Promise((resolve, reject) => {
            if (!entries || entries.length === 0) {
                resolve(file);
                return;
            }
            const img = new Image();
            const url = URL.createObjectURL(file);
            img.onload = () => {
                const canvas = document.createElement("canvas");
                canvas.width = img.naturalWidth;
                canvas.height = img.naturalHeight;
                const ctx = canvas.getContext("2d");
                ctx.drawImage(img, 0, 0);

                const fontSize = Math.max(18, Math.round(canvas.width * 0.045));
                ctx.font = `bold ${fontSize}px sans-serif`;
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.lineWidth = Math.max(3, fontSize * 0.12);
                ctx.strokeStyle = "rgba(0,0,0,0.85)";
                ctx.fillStyle = "#ffffff";

                entries.forEach((entry) => {
                    const x = (entry.xPct / 100) * canvas.width;
                    const y = (entry.yPct / 100) * canvas.height;
                    ctx.strokeText(entry.text, x, y);
                    ctx.fillText(entry.text, x, y);
                });

                canvas.toBlob((blob) => {
                    URL.revokeObjectURL(url);
                    resolve(blob);
                }, file.type && file.type.startsWith("image/") ? file.type : "image/png", 0.92);
            };
            img.onerror = () => {
                URL.revokeObjectURL(url);
                reject(new Error("image_load_failed"));
            };
            img.src = url;
        });
    }

    return { attach, compositeToBlob };
})();
