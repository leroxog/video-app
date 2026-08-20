import * as THREE from "./vendor/three.module.js";
import { buildCharacter } from "./autotrain-character.js";

(() => {
  const canvasHost = document.getElementById("atPreviewCanvas");
  const nameInput = document.getElementById("atNameInput");
  const genderBtns = document.querySelectorAll(".at-gender-btn");
  const createName = document.getElementById("atCreateName");
  const createGender = document.getElementById("atCreateGender");
  const joinName = document.getElementById("atJoinName");
  const joinGender = document.getElementById("atJoinGender");

  let gender = "m";

  function syncHiddenFields() {
    const name = nameInput.value.trim();
    createName.value = name;
    joinName.value = name;
    createGender.value = gender;
    joinGender.value = gender;
  }
  nameInput.addEventListener("input", syncHiddenFields);
  syncHiddenFields();

  // --- Three.js live preview: a slowly rotating turntable of the chosen character ---
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1e1033);

  const width = canvasHost.clientWidth || 260;
  const height = canvasHost.clientHeight || 320;
  const camera = new THREE.PerspectiveCamera(32, width / height, 0.1, 20);
  camera.position.set(0, 1.05, 2.6);
  camera.lookAt(0, 0.95, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  canvasHost.appendChild(renderer.domElement);

  const ambient = new THREE.AmbientLight(0xffffff, 0.55);
  scene.add(ambient);
  const key = new THREE.DirectionalLight(0xffffff, 1.1);
  key.position.set(2, 3, 2);
  key.castShadow = true;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xa855f7, 0.5);
  rim.position.set(-2, 1.5, -1.5);
  scene.add(rim);

  const pedestal = new THREE.Mesh(
    new THREE.CylinderGeometry(0.55, 0.6, 0.08, 32),
    new THREE.MeshStandardMaterial({ color: 0x33195e, roughness: 0.8 })
  );
  pedestal.position.y = 0.04;
  pedestal.receiveShadow = true;
  scene.add(pedestal);

  let character = null;
  function rebuildCharacter() {
    if (character) scene.remove(character);
    character = buildCharacter(gender);
    character.position.y = 0.08;
    scene.add(character);
  }
  rebuildCharacter();

  genderBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      genderBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      gender = btn.dataset.gender;
      rebuildCharacter();
      syncHiddenFields();
      if (window.leroxGamesSounds) window.leroxGamesSounds.click();
    });
  });

  function animate() {
    requestAnimationFrame(animate);
    if (character) character.rotation.y += 0.012;
    renderer.render(scene, camera);
  }
  animate();

  window.addEventListener("resize", () => {
    const w = canvasHost.clientWidth || width;
    const h = canvasHost.clientHeight || height;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  });
})();
