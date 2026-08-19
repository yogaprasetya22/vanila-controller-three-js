import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import { VFXManager } from './vfx-manager.ts';
import { CharacterController } from './character/character-controller.ts';
import { DayCycleManager } from './day-cycle-manager.ts';

// Add three-mesh-bvh extension functions to prototypes
(THREE.BufferGeometry.prototype as any).computeBoundsTree = computeBoundsTree;
(THREE.BufferGeometry.prototype as any).disposeBoundsTree = disposeBoundsTree;
(THREE.Mesh.prototype as any).raycast = acceleratedRaycast;

// Folder-structured imports
import { CartoonBlueGasExplosionNativeVFX } from './vfx/cartoon-blue-gas-explosion/Native.ts';
import { CartoonBlueGasExplosionQuarksVFX } from './vfx/cartoon-blue-gas-explosion/Quarks.ts';
import { CartoonBlueFlamethrowerNativeVFX } from './vfx/cartoon-blue-flamethrower/Native.ts';
import { CartoonBlueFlamethrowerQuarksVFX } from './vfx/cartoon-blue-flamethrower/Quarks.ts';
import { Subemitter2NativeVFX } from './vfx/subemitter2/Native.ts';
import { Subemitter2QuarksVFX } from './vfx/subemitter2/Quarks.ts';
import { CartoonTornadoNativeVFX } from './vfx/tornado/Native.ts';

import { updateFX } from './graphics/effects/FXCore';
import { dispatchSkillFX } from './graphics/effects/FXRouter';

// On-screen error overlay to quickly diagnose WebGL/Runtime issues
window.addEventListener('error', (e) => {
  const el = document.createElement('div');
  el.style.cssText = 'position:absolute;bottom:100px;left:20px;background:rgba(255,0,0,0.85);color:white;padding:15px;border-radius:5px;font-family:monospace;font-size:12px;z-index:9999;max-width:80%';
  el.innerText = `Error: ${e.message}\nAt: ${e.filename}:${e.lineno}`;
  document.body.appendChild(el);
});

window.addEventListener('unhandledrejection', (e) => {
  const el = document.createElement('div');
  el.style.cssText = 'position:absolute;bottom:200px;left:20px;background:rgba(255,100,0,0.85);color:white;padding:15px;border-radius:5px;font-family:monospace;font-size:12px;z-index:9999;max-width:80%';
  el.innerText = `Promise Error: ${e.reason ? (e.reason.message || e.reason) : 'Unknown Reason'}`;
  document.body.appendChild(el);
});

import { setScene, setCamera } from './graphics/core/scene';

// ── Scene ────────────────────────────────────────────────────────────────────
const container = document.getElementById('canvas-container') as HTMLDivElement;
const scene = new THREE.Scene();
setScene(scene);
// Switch to THREE.Fog to support linear fog distance pushing/pulling in DayCycleManager
scene.fog = new THREE.Fog(0x050505, 50, 200);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
setCamera(camera);
camera.position.set(0, 15, 30);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(scene.fog.color);
container.appendChild(renderer.domElement);

// ── Controls & Lighting ──────────────────────────────────────────────────────
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.maxPolarAngle = Math.PI / 2 - 0.05;
// Disable left-click rotation. Right-click to rotate, Middle-click to zoom/dolly.
controls.mouseButtons = { LEFT: -1 as any, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };

// Disable OrbitControls camera updates when in Player mode
let controllerMode: 'player' | 'orbit' = 'player';
controls.enabled = false;

const ambientLight = new THREE.AmbientLight(0x444444);
scene.add(ambientLight);
const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(10, 20, 10);
scene.add(dirLight);

// ── Day Cycle Manager Setup (60s cycle duration) ──
const dayCycle = new DayCycleManager(scene, 60);
dayCycle.setDirectionalLight(dirLight);
dayCycle.setAmbientLight(ambientLight);

// Time of Day HUD Overlay Label
const timeLabel = document.createElement('div');
timeLabel.style.cssText = 'position:absolute;top:20px;left:450px;background:rgba(10,10,15,0.75);color:#00ffaa;border:1px solid rgba(0,255,170,0.3);padding:10px 15px;border-radius:5px;font-family:sans-serif;font-weight:bold;z-index:9999;backdrop-filter:blur(5px);pointer-events:none;transition:all 0.3s;';
timeLabel.innerText = 'Waktu: Pagi';
document.body.appendChild(timeLabel);

// ── Environment & BVH Level Setup ───────────────────────────────────────────
const environmentGeometries: THREE.BufferGeometry[] = [];

// Ground plane
const groundGeo = new THREE.BoxGeometry(100, 2, 100);
const groundMesh = new THREE.Mesh(groundGeo);
groundMesh.position.y = -1;
groundMesh.updateMatrixWorld();
environmentGeometries.push(groundGeo.clone().applyMatrix4(groundMesh.matrixWorld));

// Add visual ground mesh
const visualGround = new THREE.Mesh(groundGeo, new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.8 }));
visualGround.position.copy(groundMesh.position);
scene.add(visualGround);

// Add custom obstacles
const obstacleConfigs = [
  { size: [6, 4, 6], pos: [10, 2, 10], color: 0x374151 },
  { size: [12, 2, 8], pos: [-12, 1, 5], color: 0x4b5563 },
  { size: [4, 6, 4], pos: [0, 3, -12], color: 0x1f2937 },
  // Sloped block to test slope sliding / climbing
  { size: [8, 0.5, 8], pos: [15, 0.25, -10], color: 0x4b5563 },
  // Steps/stairs obstacles
  { size: [3, 0.5, 3], pos: [-2, 0.25, -2], color: 0x374151 },
  { size: [3, 1.0, 3], pos: [-2, 0.5, -5], color: 0x374151 },
  { size: [3, 1.5, 3], pos: [-2, 0.75, -8], color: 0x374151 }
];

obstacleConfigs.forEach(cfg => {
  const geo = new THREE.BoxGeometry(cfg.size[0], cfg.size[1], cfg.size[2]);
  const mesh = new THREE.Mesh(geo);
  mesh.position.set(cfg.pos[0], cfg.pos[1], cfg.pos[2]);
  mesh.updateMatrixWorld();
  environmentGeometries.push(geo.clone().applyMatrix4(mesh.matrixWorld));

  // Visual mesh representation
  const visualMesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: cfg.color, roughness: 0.6 }));
  visualMesh.position.copy(mesh.position);
  scene.add(visualMesh);
});

// Grid helper overlay
const gridHelper = new THREE.GridHelper(100, 50, 0x374151, 0x1f2937);
gridHelper.position.y = 0.01;
scene.add(gridHelper);

// ── Training Dummy (Samsak) ──
const dummyGeo = new THREE.CylinderGeometry(0.5, 0.5, 2.0, 16);
const dummyMat = new THREE.MeshStandardMaterial({ color: 0x991b1b, roughness: 0.5 }); // Dark Red padded post
const dummyMesh = new THREE.Mesh(dummyGeo, dummyMat);
dummyMesh.position.set(0, 1.0, -8); // 8 meters in front of center
scene.add(dummyMesh);

// Add to environment geometries for arrow collision detection
dummyMesh.updateMatrixWorld();
environmentGeometries.push(dummyGeo.clone().applyMatrix4(dummyMesh.matrixWorld));

// Merge geometries to create a single static collider geometry for three-mesh-bvh
const mergedGeometry = BufferGeometryUtils.mergeGeometries(environmentGeometries);
(mergedGeometry as any).computeBoundsTree();
const colliderMesh = new THREE.Mesh(mergedGeometry);

// ── Character Controller & Systems ───────────────────────────────────────────
import { ProjectileSystem } from './character/projectile-system.ts';
import { SkillsSystem } from './character/skills-system.ts';

const character = new CharacterController(scene, camera);
character.setEnvironment(colliderMesh);
character.setTargets([dummyMesh]); // Register Samsak as seekable target

const projectileSystem = new ProjectileSystem(scene);

// ── VFX Managers ─────────────────────────────────────────────────────────────
const sabVfx              = new VFXManager(50000);
scene.add(sabVfx.pointsMesh);

const gasExplosionNative  = new CartoonBlueGasExplosionNativeVFX(scene, camera);
const gasExplosionQuarks  = new CartoonBlueGasExplosionQuarksVFX(scene);
const flamethrowerNative  = new CartoonBlueFlamethrowerNativeVFX(scene, camera);
const flamethrowerQuarks  = new CartoonBlueFlamethrowerQuarksVFX(scene);
const subemitter2Native   = new Subemitter2NativeVFX(scene, camera);
const subemitter2Quarks   = new Subemitter2QuarksVFX(scene);
const tornadoNative       = new CartoonTornadoNativeVFX(scene, camera);

// Initialize Skills System with native VFX models
const skillsSystem = new SkillsSystem(subemitter2Native, flamethrowerNative, tornadoNative);

// ── VFX Selection UI Hook ────────────────────────────────────────────────────
let activeVFX = 'gas-native';
const options = document.querySelectorAll('.vfx-option');

options.forEach(opt => {
  opt.addEventListener('click', () => {
    options.forEach(o => o.classList.remove('active'));
    opt.classList.add('active');
    activeVFX = opt.getAttribute('data-vfx') || 'gas-native';
  });
});

// ── Mode Selector UI (Orbit vs Player) ───────────────────────────────────────
const modeButton = document.createElement('button');
modeButton.innerText = 'Toggle Mode: Player (Active)';
modeButton.style.cssText = 'position:absolute;top:20px;left:250px;background:rgba(59,130,246,0.85);color:white;border:none;padding:10px 15px;border-radius:5px;font-family:sans-serif;font-weight:bold;cursor:pointer;z-index:9999;transition:background 0.2s';
modeButton.addEventListener('mouseover', () => modeButton.style.background = '#2563eb');
modeButton.addEventListener('mouseout', () => modeButton.style.background = 'rgba(59,130,246,0.85)');
document.body.appendChild(modeButton);

const vfxSelectorPanel = document.getElementById('vfx-selector');
const playerGuide = document.getElementById('player-guide');
const orbitGuide = document.getElementById('orbit-guide');

function applyModeLayout() {
  if (controllerMode === 'player') {
    // Show player elements
    if (playerGuide) playerGuide.style.display = 'block';
    skillsSystem.setVisible(true);
    character.playerGroup.visible = true;
    dummyMesh.visible = true;

    // Hide orbit elements
    if (vfxSelectorPanel) vfxSelectorPanel.style.display = 'none';
    if (orbitGuide) orbitGuide.style.display = 'none';
  } else {
    // Show orbit elements
    if (vfxSelectorPanel) vfxSelectorPanel.style.display = 'block';
    if (orbitGuide) orbitGuide.style.display = 'block';

    // Hide player elements
    if (playerGuide) playerGuide.style.display = 'none';
    skillsSystem.setVisible(false);
    character.playerGroup.visible = false;
    dummyMesh.visible = false;
  }
}

// Initial layout setup
applyModeLayout();

modeButton.addEventListener('click', () => {
  if (controllerMode === 'player') {
    controllerMode = 'orbit';
    controls.enabled = true;
    character.enabled = false;
    character.resetInputs(); // Reset WASD states & velocity
    isShooting = false;      // Reset shooting state
    modeButton.innerText = 'Toggle Mode: Orbit Camera';
    modeButton.style.background = 'rgba(107,114,128,0.85)';
  } else {
    controllerMode = 'player';
    controls.enabled = false;
    character.enabled = true;
    character.resetInputs();
    modeButton.innerText = 'Toggle Mode: Player (Active)';
    modeButton.style.background = 'rgba(59,130,246,0.85)';
  }
  applyModeLayout();
});

// ── Interaction ──────────────────────────────────────────────────────────────
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let isShooting = false;

renderer.domElement.addEventListener('pointerdown', (e) => {
  // Only register pointer down on left-clicks
  if (e.button !== 0) return;

  // Basic Attack in Player Mode: enable continuous shooting flag
  if (controllerMode === 'player') {
    isShooting = true;
    return;
  }

  mouse.x =  (e.clientX / window.innerWidth)  * 2 - 1;
  mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  
  // Raycast against environment static collider
  const intersects = raycaster.intersectObject(colliderMesh);
  if (intersects.length > 0) {
    const hit = intersects[0].point;
    spawnActiveVFX(hit);
  }
});

window.addEventListener('pointerup', (e) => {
  if (e.button === 0) {
    isShooting = false;
  }
});

function spawnActiveVFX(hit: THREE.Vector3) {
  switch (activeVFX) {
    case 'gas-native':
      gasExplosionNative.spawn(hit.x, hit.y, hit.z);
      break;
    case 'gas-quarks':
      gasExplosionQuarks.spawn(hit.x, hit.y, hit.z);
      break;
    case 'flamethrower-native':
      flamethrowerNative.spawn(hit.x, hit.y, hit.z);
      break;
    case 'flamethrower-quarks':
      flamethrowerQuarks.spawn(hit.x, hit.y, hit.z);
      break;
    case 'subemitter2-native':
      subemitter2Native.spawn(hit.x, hit.y, hit.z);
      break;
    case 'subemitter2-quarks':
      subemitter2Quarks.spawn(hit.x, hit.y, hit.z);
      break;
    case 'tornado-native':
      tornadoNative.spawn(hit.x, hit.y, hit.z);
      break;
    case 'sab-worker':
      const r = 0.5 + Math.random() * 0.5;
      const g = 0.2 + Math.random() * 0.8;
      const b = 0.8 + Math.random() * 0.2;
      sabVfx.spawn(hit.x, hit.y, hit.z, 1000, [r, g, b]);
      break;
    case 'skill-ironFortitude':
      dispatchSkillFX(scene, { skill: 'ironFortitude', x: hit.x, y: hit.y, z: hit.z, team: 1 });
      break;
    case 'skill-frostNova':
      dispatchSkillFX(scene, { skill: 'frostNova', x: hit.x, y: hit.y, z: hit.z, team: 1 });
      break;
    case 'skill-divineShield':
      dispatchSkillFX(scene, { skill: 'divineShield', tx: hit.x, ty: hit.y, tz: hit.z, team: 1 });
      break;
    case 'skill-holySanctuary':
      dispatchSkillFX(scene, { skill: 'holySanctuary', x: hit.x, y: hit.y, z: hit.z, team: 1 });
      break;
    case 'skill-taunt':
      dispatchSkillFX(scene, { skill: 'taunt', x: hit.x - 2, y: hit.y, z: hit.z - 2, tx: hit.x, ty: hit.y, tz: hit.z, team: 1 });
      break;
    case 'skill-shieldBash':
      dispatchSkillFX(scene, { skill: 'shieldBash', x: hit.x - 2, y: hit.y, z: hit.z - 2, tx: hit.x, ty: hit.y, tz: hit.z, team: 1 });
      break;
    case 'skill-chainLightning': {
      const positions = [
        hit.x, hit.y + 4, hit.z,
        hit.x + 1.5, hit.y + 1, hit.z + 1.5,
        hit.x - 1.5, hit.y + 1, hit.z - 1.5,
        hit.x + 3, hit.y, hit.z + 3
      ];
      dispatchSkillFX(scene, { skill: 'chainLightning', positions, team: 1 });
      break;
    }
    case 'skill-arrowVolley':
      dispatchSkillFX(scene, { skill: 'arrowVolley', x: hit.x, z: hit.z, team: 1 });
      break;
    case 'skill-fireball':
      dispatchSkillFX(scene, { skill: 'fireball', fx: hit.x, fy: hit.y + 3, fz: hit.z, tx: hit.x, ty: hit.y, tz: hit.z, team: 1 });
      break;
    case 'skill-doubleShot':
      dispatchSkillFX(scene, { skill: 'doubleShot', fx: hit.x - 5, fy: hit.y + 2, fz: hit.z - 5, tx: hit.x, ty: hit.y, tz: hit.z, team: 1 });
      break;
  }
}

window.addEventListener('contextmenu', (e) => e.preventDefault());

// ── Stats ────────────────────────────────────────────────────────────────────
const fpsEl = document.getElementById('fps') as HTMLSpanElement;
let frameCount = 0;
let lastFpsTime = performance.now();
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();

  if (controllerMode === 'player') {
    character.update(delta);
    
    // Continuous attack trigger at 193 ASPD when Left-Click is held down
    if (isShooting) {
      if (character.triggerAttack()) {
        // Query exact left hand (bow) bone position for spawning, fallback to chest height (1.0m offset)
        const spawnPos = character.getWeaponWorldPosition('hand_l', 1.0);
        const target = character.getNearestTarget();

        // If there's a target, aim directly at its center regardless of Y height difference
        let dir = character.getForwardVector();
        if (target) {
          const targetWorldPos = new THREE.Vector3();
          target.getWorldPosition(targetWorldPos);
          targetWorldPos.y += 0.5; // aim at body center
          dir = targetWorldPos.sub(spawnPos).normalize();
        }

        projectileSystem.spawn(spawnPos, dir, 40, target);
      }
    }

    projectileSystem.update(delta, colliderMesh, (hitPoint) => {
      // Spawn hit impact explosion
      gasExplosionNative.spawn(hitPoint.x, hitPoint.y, hitPoint.z);
    });
    skillsSystem.update(delta);
  } else {
    controls.update();
  }

  // Update Day Cycle variables (Morning -> Noon -> Afternoon -> Night)
  dayCycle.update();
  timeLabel.innerText = `Waktu: ${dayCycle.getCurrentPeriod()}`;

  sabVfx.update();
  gasExplosionNative.update(delta);
  gasExplosionQuarks.update(delta);
  flamethrowerNative.update(delta);
  flamethrowerQuarks.update(delta);
  subemitter2Native.update(delta);
  subemitter2Quarks.update(delta);
  tornadoNative.update(delta);
  updateFX(delta);

  renderer.render(scene, camera);

  frameCount++;
  const now = performance.now();
  if (now - lastFpsTime >= 1000) {
    fpsEl.textContent = frameCount.toString();
    frameCount = 0;
    lastFpsTime = now;
  }
}

// Allow spawning VFX at character position when walking around and pressing 'E'
// Also route 1, 2, 3 skills keys
window.addEventListener('keydown', (e) => {
  if (controllerMode === 'player') {
    const playerPos = character.position;
    const forward = character.getForwardVector();
    skillsSystem.handleInput(e.code, playerPos, forward, character);
  }
});

animate();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

