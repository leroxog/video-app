import { FilesetResolver, FaceLandmarker } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";

const video = document.getElementById("cameraVideo");
const canvas = document.getElementById("cameraCanvas");
const ctx = canvas.getContext("2d");
const errorEl = document.getElementById("cameraError");
const filterRow = document.getElementById("cameraFilterRow");
const shutterBtn = document.getElementById("cameraShutterBtn");
const liveWrap = document.getElementById("cameraLiveWrap");
const review = document.getElementById("cameraReview");
const reviewPhotoWrap = document.getElementById("cameraReviewPhotoWrap");
const reviewImg = document.getElementById("cameraReviewImg");
const nameInput = document.getElementById("cameraNameInput");
const retakeBtn = document.getElementById("cameraRetakeBtn");
const downloadBtn = document.getElementById("cameraDownloadBtn");
const shareBtn = document.getElementById("cameraShareBtn");
const uploadBtn = document.getElementById("cameraUploadBtn");
const reviewStatus = document.getElementById("cameraReviewStatus");
const shareBackdrop = document.getElementById("cameraShareBackdrop");
const shareCloseBtn = document.getElementById("cameraShareCloseBtn");
const shareTargetList = document.getElementById("cameraShareTargetList");
const shareStatus = document.getElementById("cameraShareStatus");

let currentFilter = "none";
let faceLandmarker = null;
let detectionReady = false;
let capturedBlob = null;
let textApi = null;
let sharePostId = null;
let uploadedPostId = null;

filterRow.addEventListener("click", (event) => {
    const btn = event.target.closest(".camera-filter-btn");
    if (!btn) return;
    currentFilter = btn.dataset.filter;
    [...filterRow.children].forEach((b) => b.classList.toggle("active", b === btn));
});

function landmarkToPoint(lm, w, h) {
    return { x: lm.x * w, y: lm.y * h };
}

function roundedRectPath(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
}

function drawEar(c, x, y, size, isLeft) {
    c.save();
    c.translate(x, y);
    c.rotate(isLeft ? -0.35 : 0.35);
    const grad = c.createLinearGradient(0, -size * 0.5, 0, size * 0.5);
    grad.addColorStop(0, "#8a5a2b");
    grad.addColorStop(1, "#5c3a1a");
    c.fillStyle = grad;
    c.beginPath();
    c.moveTo(0, -size * 0.5);
    c.quadraticCurveTo(size * 0.55 * (isLeft ? -1 : 1), -size * 0.1, size * 0.4 * (isLeft ? -1 : 1), size * 0.55);
    c.quadraticCurveTo(0, size * 0.35, 0, -size * 0.5);
    c.closePath();
    c.fill();
    c.fillStyle = "#d9a066";
    c.beginPath();
    c.ellipse(size * 0.12 * (isLeft ? -1 : 1), size * 0.05, size * 0.14, size * 0.22, 0, 0, Math.PI * 2);
    c.fill();
    c.restore();
}

function drawDogFilter(c, { forehead, noseTip, centerX, faceWidth, roll }) {
    c.save();
    c.translate(centerX, forehead.y);
    c.rotate(roll);
    const earSize = faceWidth * 0.42;
    drawEar(c, -faceWidth * 0.38, -earSize * 0.25, earSize, true);
    drawEar(c, faceWidth * 0.38, -earSize * 0.25, earSize, false);
    c.restore();

    c.save();
    c.translate(noseTip.x, noseTip.y);
    c.rotate(roll);
    const noseSize = faceWidth * 0.3;
    c.fillStyle = "#3b2415";
    c.beginPath();
    c.ellipse(0, 0, noseSize * 0.5, noseSize * 0.36, 0, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = "#000000";
    c.beginPath();
    c.ellipse(0, -noseSize * 0.05, noseSize * 0.28, noseSize * 0.2, 0, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = "#000000";
    c.lineWidth = Math.max(2, noseSize * 0.05);
    c.beginPath();
    c.moveTo(0, noseSize * 0.16);
    c.lineTo(0, noseSize * 0.5);
    c.moveTo(-noseSize * 0.22, noseSize * 0.5);
    c.lineTo(noseSize * 0.22, noseSize * 0.5);
    c.stroke();
    c.restore();
}

function drawMaskFilter(c, { forehead, chin, centerX, faceWidth, roll }) {
    const h = Math.hypot(chin.x - forehead.x, chin.y - forehead.y) * 1.35;
    const w = faceWidth * 1.25;
    const centerY = (forehead.y + chin.y) / 2;

    c.save();
    c.translate(centerX, centerY);
    c.rotate(roll);

    c.fillStyle = "#111111";
    roundedRectPath(c, -w / 2, -h / 2, w, h, w * 0.28);
    c.fill();

    c.globalCompositeOperation = "destination-out";
    const eyeY = -h * 0.12;
    const eyeSpacing = w * 0.24;
    c.beginPath();
    c.ellipse(-eyeSpacing, eyeY, w * 0.14, h * 0.09, 0, 0, Math.PI * 2);
    c.fill();
    c.beginPath();
    c.ellipse(eyeSpacing, eyeY, w * 0.14, h * 0.09, 0, 0, Math.PI * 2);
    c.fill();
    c.beginPath();
    c.ellipse(0, h * 0.28, w * 0.16, h * 0.08, 0, 0, Math.PI * 2);
    c.fill();
    c.globalCompositeOperation = "source-over";

    c.restore();
}

function drawFilters(faceLandmarksList, width, height) {
    if (currentFilter === "none") return;
    faceLandmarksList.forEach((landmarks) => {
        const forehead = landmarkToPoint(landmarks[10], width, height);
        const chin = landmarkToPoint(landmarks[152], width, height);
        const rightEdge = landmarkToPoint(landmarks[234], width, height);
        const leftEdge = landmarkToPoint(landmarks[454], width, height);
        const noseTip = landmarkToPoint(landmarks[1], width, height);
        const rightEye = landmarkToPoint(landmarks[33], width, height);
        const leftEye = landmarkToPoint(landmarks[263], width, height);

        const faceWidth = Math.hypot(leftEdge.x - rightEdge.x, leftEdge.y - rightEdge.y);
        const centerX = (leftEdge.x + rightEdge.x) / 2;
        const roll = Math.atan2(leftEye.y - rightEye.y, leftEye.x - rightEye.x);

        if (currentFilter === "dog") {
            drawDogFilter(ctx, { forehead, noseTip, centerX, faceWidth, roll });
        } else if (currentFilter === "mask") {
            drawMaskFilter(ctx, { forehead, chin, centerX, faceWidth, roll });
        }
    });
}

let animationHandle = null;

function renderLoop() {
    if (video.readyState >= 2 && canvas.width > 0) {
        ctx.save();
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        if (detectionReady) {
            const results = faceLandmarker.detectForVideo(video, performance.now());
            if (results && results.faceLandmarks) {
                drawFilters(results.faceLandmarks, canvas.width, canvas.height);
            }
        }
        ctx.restore();
    }
    animationHandle = requestAnimationFrame(renderLoop);
}

async function initCamera() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
        video.srcObject = stream;
        await video.play();
        canvas.width = video.videoWidth || 480;
        canvas.height = video.videoHeight || 640;
    } catch (err) {
        errorEl.textContent = "Kein Zugriff auf die Kamera. Bitte erlaube den Kamerazugriff in deinem Browser.";
        errorEl.style.display = "block";
        return false;
    }
    return true;
}

async function initFaceLandmarker() {
    try {
        const filesetResolver = await FilesetResolver.forVisionTasks(
            "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
        );
        faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
            baseOptions: {
                modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
                delegate: "GPU",
            },
            outputFaceBlendshapes: false,
            runningMode: "VIDEO",
            numFaces: 4,
        });
        detectionReady = true;
    } catch (err) {
        detectionReady = false;
        console.warn("Gesichtserkennung konnte nicht geladen werden, Kamera funktioniert ohne Filter.", err);
    }
}

function capturePhoto() {
    canvas.toBlob((blob) => {
        capturedBlob = blob;
        textApi = null;
        reviewImg.src = URL.createObjectURL(blob);
        liveWrap.style.display = "none";
        review.style.display = "block";
        reviewStatus.textContent = "";
        uploadedPostId = null;
        reviewImg.onload = () => {
            textApi = PhotoTextOverlay.attach(reviewPhotoWrap, reviewImg);
        };
    }, "image/png");
}

shutterBtn.addEventListener("click", capturePhoto);
canvas.addEventListener("click", capturePhoto);

retakeBtn.addEventListener("click", () => {
    capturedBlob = null;
    review.style.display = "none";
    liveWrap.style.display = "block";
});

async function getFinalBlob() {
    if (textApi && textApi.entries.length > 0) {
        return await PhotoTextOverlay.compositeToBlob(capturedBlob, textApi.entries);
    }
    return capturedBlob;
}

downloadBtn.addEventListener("click", async () => {
    const blob = await getFinalBlob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "foto.png";
    a.click();
});

async function uploadCapture() {
    if (uploadedPostId) return uploadedPostId;
    const blob = await getFinalBlob();
    const formData = new FormData();
    formData.append("caption", nameInput.value.trim());
    formData.append("hashtags", "");
    formData.append("photos", blob, "kamera.png");
    const res = await fetch("/upload", { method: "POST", body: formData });
    if (!res.redirected) {
        reviewStatus.textContent = "Hochladen fehlgeschlagen.";
        return null;
    }
    const url = new URL(res.url);
    uploadedPostId = url.searchParams.get("post_id");
    return uploadedPostId;
}

uploadBtn.addEventListener("click", async () => {
    uploadBtn.disabled = true;
    reviewStatus.textContent = "Wird hochgeladen...";
    const postId = await uploadCapture();
    if (postId) {
        window.location.href = `/feed?post_id=${postId}`;
    } else {
        uploadBtn.disabled = false;
    }
});

shareBtn.addEventListener("click", async () => {
    shareBtn.disabled = true;
    reviewStatus.textContent = "Wird vorbereitet...";
    sharePostId = await uploadCapture();
    reviewStatus.textContent = "";
    shareBtn.disabled = false;
    if (!sharePostId) return;

    shareBackdrop.classList.add("show");
    shareStatus.textContent = "";
    shareTargetList.innerHTML = "Lade...";

    const res = await fetch("/api/conversations");
    const data = await res.json();
    shareTargetList.innerHTML = "";
    if (!data.ok || data.conversations.length === 0) {
        shareTargetList.innerHTML = "<p>Du hast noch keine Chats. Schreib zuerst jemandem, dem du folgst und der dir auch folgt.</p>";
        return;
    }
    data.conversations.forEach((conv) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "share-target-btn";
        btn.textContent = conv.name;
        btn.addEventListener("click", async () => {
            const shareRes = await fetch(`/api/posts/${sharePostId}/share`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ conversation_id: conv.id }),
            });
            const shareData = await shareRes.json();
            shareStatus.textContent = shareData.ok ? `An "${conv.name}" gesendet!` : "Fehlgeschlagen.";
            shareStatus.className = shareData.ok ? "create-code-status success" : "create-code-status error";
        });
        shareTargetList.appendChild(btn);
    });
});

shareCloseBtn.addEventListener("click", () => shareBackdrop.classList.remove("show"));
shareBackdrop.addEventListener("click", (e) => {
    if (e.target === shareBackdrop) shareBackdrop.classList.remove("show");
});

(async function main() {
    const camOk = await initCamera();
    if (camOk) {
        renderLoop();
        initFaceLandmarker();
    }
})();
