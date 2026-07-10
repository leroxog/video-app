const GigasRecorder = (function () {
    const DB_NAME = "gigas-recorder";
    const STORE = "recordings";
    const KEY = "pending";

    function openDb() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, 1);
            req.onupgradeneeded = () => {
                if (!req.result.objectStoreNames.contains(STORE)) {
                    req.result.createObjectStore(STORE);
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    async function savePending(blob) {
        const db = await openDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, "readwrite");
            tx.objectStore(STORE).put(blob, KEY);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    async function takePending() {
        const db = await openDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, "readwrite");
            const store = tx.objectStore(STORE);
            const getReq = store.get(KEY);
            getReq.onsuccess = () => {
                const blob = getReq.result;
                store.delete(KEY);
                resolve(blob || null);
            };
            getReq.onerror = () => reject(getReq.error);
        });
    }

    function isSupported() {
        return (
            typeof MediaRecorder !== "undefined" &&
            typeof HTMLCanvasElement !== "undefined" &&
            !!HTMLCanvasElement.prototype.captureStream
        );
    }

    function pickMimeType() {
        const candidates = [
            "video/mp4",
            "video/webm;codecs=vp9",
            "video/webm;codecs=vp8",
            "video/webm",
        ];
        for (const type of candidates) {
            if (MediaRecorder.isTypeSupported(type)) return type;
        }
        return "";
    }

    function attach(canvas, button) {
        if (!isSupported()) {
            if (button) button.style.display = "none";
            return;
        }

        let recorder = null;
        let chunks = [];

        button.addEventListener("click", () => {
            if (recorder && recorder.state === "recording") {
                recorder.stop();
                return;
            }

            const stream = canvas.captureStream(30);
            const mimeType = pickMimeType();
            recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
            const outputType = mimeType && mimeType.startsWith("video/mp4") ? "video/mp4" : "video/webm";
            chunks = [];

            recorder.ondataavailable = (event) => {
                if (event.data && event.data.size > 0) chunks.push(event.data);
            };

            recorder.onstop = async () => {
                const blob = new Blob(chunks, { type: outputType });
                button.textContent = "🔴 Aufnehmen";
                button.classList.remove("recording");
                if (blob.size > 0) {
                    await savePending(blob);
                    window.location.href = "/upload";
                }
            };

            recorder.start();
            button.textContent = "🔴 NIMMT AUF";
            button.classList.add("recording");
        });
    }

    return { attach, takePending, isSupported };
})();
