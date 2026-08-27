import "./style.css";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import * as BufferGeometryUtils from "three/addons/utils/BufferGeometryUtils.js";

// Extend THREE prototypes with BVH acceleration matching main.ts
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from "three-mesh-bvh";
(THREE.BufferGeometry.prototype as any).computeBoundsTree = computeBoundsTree;
(THREE.BufferGeometry.prototype as any).disposeBoundsTree = disposeBoundsTree;
(THREE.Mesh.prototype as any).raycast = acceleratedRaycast;

import { setScene, setCamera, referencePosition } from "./graphics/core/scene.ts";

// Setup Scene matching main.ts exactly
const container = document.getElementById("canvas-container") as HTMLDivElement;
const scene = new THREE.Scene();
setScene(scene);
scene.fog = new THREE.Fog(0x050505, 50, 200);
scene.background = scene.fog.color;

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
setCamera(camera);
camera.position.set(0, 15, 30);

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  powerPreference: "high-performance",
  precision: "mediump",
  depth: true
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setClearColor(scene.fog.color);
container.appendChild(renderer.domElement);

// Setup Orbit Controls
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.maxPolarAngle = Math.PI / 2 - 0.05;
controls.mouseButtons = { LEFT: -1 as any, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
controls.minDistance = 3;
controls.maxDistance = 80;

// Setup Lighting matching main.ts exactly
const ambientLight = new THREE.AmbientLight(0x444444);
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(10, 20, 10);
scene.add(dirLight);

// Import and Initialize MMORPG World
import { World } from "./graphics/scenery/World.ts";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";

const gltfLoader = new GLTFLoader();
gltfLoader.setMeshoptDecoder(MeshoptDecoder);

const world = new World(scene, gltfLoader);

// Use Floor terrain geometry for three-mesh-bvh precision raycasting
const colliderMesh = world.getColliderMesh();

// Import Native VFX implementations
import { CartoonBlueGasExplosionNativeVFX } from "./graphics/effects/CartoonBlueGasExplosionNative.ts";
import { CartoonBlueFlamethrowerNativeVFX } from "./graphics/effects/CartoonBlueFlamethrowerNative.ts";
import { Subemitter2NativeVFX } from "./graphics/effects/Subemitter2Native.ts";
import { CartoonTornadoNativeVFX } from "./graphics/effects/CartoonTornadoNative.ts";
import { dispatchSkillFX } from "./graphics/effects/FXRouter.ts";
import { updateFX } from "./graphics/effects/FXCore.ts";

const gasExplosionNative = new CartoonBlueGasExplosionNativeVFX(scene, camera);
const flamethrowerNative = new CartoonBlueFlamethrowerNativeVFX(scene, camera);
const subemitter2Native  = new Subemitter2NativeVFX(scene, camera);
const tornadoNative      = new CartoonTornadoNativeVFX(scene, camera);

// FPS Calculator
let fps = 0;
let lastTime = performance.now();
let frames = 0;
const fpsEl = document.getElementById("fps");

function updateFPS() {
  const now = performance.now();
  frames++;
  if (now > lastTime + 1000) {
    fps = Math.round((frames * 1000) / (now - lastTime));
    if (fpsEl) fpsEl.innerText = fps.toString();
    frames = 0;
    lastTime = now;
  }
}

// VFX Selection UI logic
let activeVFX = "gas-native";
document.querySelectorAll(".vfx-option").forEach((opt) => {
  opt.addEventListener("click", () => {
    document.querySelectorAll(".vfx-option").forEach((o) => o.classList.remove("active"));
    opt.classList.add("active");
    activeVFX = opt.getAttribute("data-vfx") || "gas-native";
  });
});

// Click Interaction for spawning VFX
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

renderer.domElement.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return; // Left click only

  // Stop click action if clicked on HTML overlay panels
  const target = e.target as HTMLElement;
  if (target.closest("#vfx-selector") || target.closest("#ui")) {
    return;
  }

  mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);
  const hit = raycaster.intersectObject(colliderMesh)[0];
  if (hit) {
    spawnActiveVFX(hit.point);
  }
});

function spawnActiveVFX(point: THREE.Vector3) {
  const x = point.x;
  const y = point.y;
  const z = point.z;

  const baseY = y + 0.05;

  switch (activeVFX) {
    case "gas-native":
      gasExplosionNative.spawn(x, baseY, z);
      break;
    case "flamethrower-native":
      flamethrowerNative.spawn(x, baseY, z);
      break;
    case "subemitter-native":
      subemitter2Native.spawn(x, baseY, z);
      break;
    case "tornado-native":
      tornadoNative.spawn(x, baseY + 1.0, z);
      break;
    case "skill-ironFortitude":
      dispatchSkillFX(scene, { skill: "ironFortitude", x, y: baseY, z, team: 1, forceShow: true });
      break;
    case "skill-frostNova":
      dispatchSkillFX(scene, { skill: "frostNova", x, y: baseY, z, team: 1, forceShow: true });
      break;
    case "skill-divineShield":
      dispatchSkillFX(scene, { skill: "divineShield", tx: x, ty: baseY + 2.5, tz: z, team: 1, forceShow: true });
      break;
    case "skill-holySanctuary":
      dispatchSkillFX(scene, { skill: "holySanctuary", x, y: baseY + 3.0, z, team: 1, forceShow: true });
      break;
    case "skill-taunt":
      dispatchSkillFX(scene, { skill: "taunt", x: x - 2, y: baseY, z: z - 2, tx: x, ty: baseY, tz: z, team: 1, forceShow: true });
      break;
    case "skill-shieldBash":
      dispatchSkillFX(scene, { skill: "shieldBash", x: x - 2, y: baseY, z: z - 2, tx: x, ty: baseY, tz: z, team: 1, forceShow: true });
      break;
    case "skill-chainLightning":
      dispatchSkillFX(scene, {
        skill: "chainLightning",
        positions: [x, baseY + 4, z, x + 1.5, baseY + 1, z + 1.5, x - 1.5, baseY + 1, z - 1.5, x + 3, baseY, z + 3],
        team: 1,
        forceShow: true
      });
      break;
    case "skill-arrowVolley":
      dispatchSkillFX(scene, { skill: "arrowVolley", x, z, team: 1, forceShow: true });
      break;
    case "skill-fireball":
      dispatchSkillFX(scene, { skill: "fireball", fx: x, fy: baseY + 3, fz: z, tx: x, ty: baseY, tz: z, team: 1, forceShow: true });
      break;
    case "skill-doubleShot":
      dispatchSkillFX(scene, { skill: "doubleShot", fx: x - 5, fy: baseY + 2, fz: z - 5, tx: x, ty: baseY, tz: z, team: 1, forceShow: true });
      break;
    case "skill-darkVoidAura":
      dispatchSkillFX(scene, { skill: "darkVoidAura", x, y: baseY, z, radius: 4.0, forceShow: true });
      break;
    case "skill-backstab":
      dispatchSkillFX(scene, { skill: "backstab", fx: x - 2, fy: baseY + 1.0, fz: z - 2, tx: x, ty: baseY, tz: z, team: 1, forceShow: true });
      break;
    case "skill-poisonBlade":
      dispatchSkillFX(scene, { skill: "poisonBlade", tx: x, ty: baseY + 0.5, tz: z, forceShow: true });
      break;
    case "skill-shadowStep":
      dispatchSkillFX(scene, { skill: "shadowStep", fx: x - 6, fy: baseY + 1.0, fz: z - 6, tx: x, ty: baseY, tz: z, team: 1, forceShow: true });
      break;
    case "skill-highNoon":
      dispatchSkillFX(scene, { skill: "highNoon", fx: x - 10, fy: baseY + 1.5, fz: z - 10, tx: x, ty: baseY, tz: z, team: 1, forceShow: true });
      break;
    case "skill-smokeBomb":
      dispatchSkillFX(scene, { skill: "smokeBomb", x, y: baseY, z, team: 1, forceShow: true });
      break;
    case "skill-meteorStrike":
      dispatchSkillFX(scene, { skill: "meteorStrike", x, y: baseY, z, team: 1, forceShow: true });
      break;
    case "skill-thunderClap":
      dispatchSkillFX(scene, { skill: "thunderClap", x, y: baseY, z, team: 1, forceShow: true });
      break;
    case "skill-arcaneNova":
      dispatchSkillFX(scene, { skill: "arcaneNova", x, y: baseY, z, team: 1, forceShow: true });
      break;
    case "skill-soulHarvest":
      dispatchSkillFX(scene, { skill: "soulHarvest", x, y: baseY, z, team: 1, forceShow: true });
      break;
    case "skill-blizzard":
      dispatchSkillFX(scene, { skill: "blizzard", x, y: baseY, z, team: 1, forceShow: true });
      break;
  }
}

// Render loop
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();

  // Set references
  referencePosition.copy(camera.position);

  // Update VFX instances
  gasExplosionNative.update(delta);
  flamethrowerNative.update(delta);
  subemitter2Native.update(delta);
  tornadoNative.update(delta);
  updateFX(delta);

  // Update World animations (wind, water waves, turret angles)
  world.update(delta, camera.position, camera);

  controls.update();
  renderer.render(scene, camera);
  updateFPS();
}

animate();

// Resize handler
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
