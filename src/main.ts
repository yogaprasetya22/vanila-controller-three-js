import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import { CharacterController } from './character/character-controller.ts';
import { BossController } from './character/BossController.ts';
import { DayCycleManager } from './day-cycle-manager.ts';
import { onPlayerJoin, insertCoin, isHost, myPlayer, RPC, setState, getState, onBossDamaged } from './network/NetworkManager.ts';
import { ProjectileSystem } from './character/projectile-system.ts';
import { SkillsSystem } from './character/skills-system.ts';

import { CartoonBlueGasExplosionNativeVFX } from './graphics/effects/CartoonBlueGasExplosionNative.ts';
import { CartoonBlueFlamethrowerNativeVFX } from './graphics/effects/CartoonBlueFlamethrowerNative.ts';
import { Subemitter2NativeVFX } from './graphics/effects/Subemitter2Native.ts';
import { CartoonTornadoNativeVFX } from './graphics/effects/CartoonTornadoNative.ts';
import { updateFX } from './graphics/effects/FXCore';
import { dispatchSkillFX } from './graphics/effects/FXRouter';
import { WindEffectManager } from './graphics/effects/WindLines.ts';
import { SceneryWindLines } from './graphics/effects/SceneryWindLines.ts';
import { damageHUDBatcher } from './graphics/effects/DamageHUDBatcher.ts';

// Extend THREE prototypes with BVH acceleration
(THREE.BufferGeometry.prototype as any).computeBoundsTree = computeBoundsTree;
(THREE.BufferGeometry.prototype as any).disposeBoundsTree = disposeBoundsTree;
(THREE.Mesh.prototype as any).raycast = acceleratedRaycast;

// ── Error Overlays ────────────────────────────────────────────────────────────
window.addEventListener('error', (e) => {
  const el = document.createElement('div');
  el.style.cssText = 'position:absolute;bottom:100px;left:20px;background:rgba(255,0,0,0.85);color:white;padding:15px;border-radius:5px;font-family:monospace;font-size:12px;z-index:9999;max-width:80%';
  el.innerText = `Error: ${e.message}\nAt: ${e.filename}:${e.lineno}`;
  document.body.appendChild(el);
});

window.addEventListener('unhandledrejection', (e) => {
  const el = document.createElement('div');
  el.style.cssText = 'position:absolute;bottom:200px;left:20px;background:rgba(255,100,0,0.85);color:white;padding:15px;border-radius:5px;font-family:monospace;font-size:12px;z-index:9999;max-width:80%';
  el.innerText = `Promise Error: ${e.reason?.message ?? e.reason ?? 'Unknown Reason'}`;
  document.body.appendChild(el);
});

import { setScene, setCamera } from './graphics/core/scene';

// ── Scene ─────────────────────────────────────────────────────────────────────
const container = document.getElementById('canvas-container') as HTMLDivElement;
const scene = new THREE.Scene();
setScene(scene);
scene.fog = new THREE.Fog(0x050505, 50, 200);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
setCamera(camera);
camera.position.set(0, 15, 30);

const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
const renderer = new THREE.WebGLRenderer({ antialias: !isMobile, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(isMobile ? 1.0 : Math.min(window.devicePixelRatio, 1.5));
renderer.setClearColor(scene.fog.color);
container.appendChild(renderer.domElement);

// ── Controls & Lighting ───────────────────────────────────────────────────────
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.maxPolarAngle = Math.PI / 2 - 0.05;
controls.mouseButtons = { LEFT: -1 as any, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };

let controllerMode: 'player' | 'orbit' = 'player';
controls.enabled = false;

const ambientLight = new THREE.AmbientLight(0x444444);
scene.add(ambientLight);
const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(10, 20, 10);
scene.add(dirLight);

const dayCycle = new DayCycleManager(scene, 60);
dayCycle.setDirectionalLight(dirLight);
dayCycle.setAmbientLight(ambientLight);

// Time of Day HUD
const timeLabel = document.createElement('div');
timeLabel.style.cssText = 'position:absolute;top:20px;left:450px;background:rgba(10,10,15,0.75);color:#00ffaa;border:1px solid rgba(0,255,170,0.3);padding:10px 15px;border-radius:5px;font-family:sans-serif;font-weight:bold;z-index:9999;backdrop-filter:blur(5px);pointer-events:none;transition:all 0.3s;';
timeLabel.innerText = 'Waktu: Pagi';
document.body.appendChild(timeLabel);

// ── Environment & BVH Collider ────────────────────────────────────────────────
const environmentGeometries: THREE.BufferGeometry[] = [];

const groundGeo = new THREE.BoxGeometry(100, 2, 100);
const groundMesh = new THREE.Mesh(groundGeo);
groundMesh.position.y = -1;
groundMesh.updateMatrixWorld();
environmentGeometries.push(groundGeo.clone().applyMatrix4(groundMesh.matrixWorld));
const visualGround = new THREE.Mesh(groundGeo, new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.8 }));
visualGround.position.copy(groundMesh.position);
scene.add(visualGround);

const obstacleConfigs = [
  { size: [6, 4, 6],   pos: [10, 2, 10],   color: 0x374151 },
  { size: [12, 2, 8],  pos: [-12, 1, 5],   color: 0x4b5563 },
  { size: [4, 6, 4],   pos: [0, 3, -12],   color: 0x1f2937 },
  { size: [8, 0.5, 8], pos: [15, 0.25, -10],color: 0x4b5563 },
  { size: [3, 0.5, 3], pos: [-2, 0.25, -2], color: 0x374151 },
  { size: [3, 1.0, 3], pos: [-2, 0.5, -5],  color: 0x374151 },
  { size: [3, 1.5, 3], pos: [-2, 0.75, -8], color: 0x374151 },
];

for (const cfg of obstacleConfigs) {
  const geo = new THREE.BoxGeometry(cfg.size[0], cfg.size[1], cfg.size[2]);
  const mesh = new THREE.Mesh(geo);
  mesh.position.set(cfg.pos[0], cfg.pos[1], cfg.pos[2]);
  mesh.updateMatrixWorld();
  environmentGeometries.push(geo.clone().applyMatrix4(mesh.matrixWorld));
  const vis = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: cfg.color, roughness: 0.6 }));
  vis.position.copy(mesh.position);
  scene.add(vis);
}

scene.add(new THREE.GridHelper(100, 50, 0x374151, 0x1f2937));


const mergedGeometry = BufferGeometryUtils.mergeGeometries(environmentGeometries);
(mergedGeometry as any).computeBoundsTree();
const colliderMesh = new THREE.Mesh(mergedGeometry);

// ── Systems ───────────────────────────────────────────────────────────────────
let character: CharacterController | null = null;
let bossController: BossController | null = null;
const playersAndControllers: { player: any; controller: CharacterController }[] = [];
// Pre-built Set of player groups for O(1) friendly-fire check — updated on join/quit
const playerGroupSet = new Set<THREE.Object3D>();

const projectileSystem = new ProjectileSystem(scene);
const gasExplosionNative = new CartoonBlueGasExplosionNativeVFX(scene, camera);
const flamethrowerNative = new CartoonBlueFlamethrowerNativeVFX(scene, camera);
const subemitter2Native  = new Subemitter2NativeVFX(scene, camera);
const tornadoNative      = new CartoonTornadoNativeVFX(scene, camera);
const skillsSystem = new SkillsSystem(subemitter2Native, flamethrowerNative, tornadoNative);
const windEffect   = new WindEffectManager(scene);
if (!isMobile) windEffect.start();
const sceneryWindLines = new SceneryWindLines(scene);

// ── VFX Selection UI ──────────────────────────────────────────────────────────
let activeVFX = 'gas-native';
document.querySelectorAll('.vfx-option').forEach(opt => {
  opt.addEventListener('click', () => {
    document.querySelectorAll('.vfx-option').forEach(o => o.classList.remove('active'));
    opt.classList.add('active');
    activeVFX = opt.getAttribute('data-vfx') || 'gas-native';
  });
});

// ── Mode Toggle ───────────────────────────────────────────────────────────────
const modeButton = document.createElement('button');
modeButton.innerText = 'Toggle Mode: Player (Active)';
modeButton.style.cssText = 'position:absolute;top:20px;left:250px;background:rgba(59,130,246,0.85);color:white;border:none;padding:10px 15px;border-radius:5px;font-family:sans-serif;font-weight:bold;cursor:pointer;z-index:9999;transition:background 0.2s';
modeButton.addEventListener('mouseover', () => modeButton.style.background = '#2563eb');
modeButton.addEventListener('mouseout',  () => modeButton.style.background = 'rgba(59,130,246,0.85)');
document.body.appendChild(modeButton);

const vfxSelectorPanel = document.getElementById('vfx-selector');
const playerGuide      = document.getElementById('player-guide');
const orbitGuide       = document.getElementById('orbit-guide');

function applyModeLayout() {
  const isPlayer = controllerMode === 'player';
  if (playerGuide)      playerGuide.style.display      = isPlayer ? 'block' : 'none';
  if (orbitGuide)       orbitGuide.style.display        = isPlayer ? 'none' : 'block';
  if (vfxSelectorPanel) vfxSelectorPanel.style.display  = isPlayer ? 'none' : 'block';
  skillsSystem.setVisible(isPlayer);
  if (character) character.playerGroup.visible = isPlayer;
}
applyModeLayout();

modeButton.addEventListener('click', () => {
  if (controllerMode === 'player') {
    controllerMode = 'orbit';
    controls.enabled = true;
    character?.resetInputs();
    if (character) character.enabled = false;
    isShooting = false;
    modeButton.innerText = 'Toggle Mode: Orbit Camera';
    modeButton.style.background = 'rgba(107,114,128,0.85)';
  } else {
    controllerMode = 'player';
    controls.enabled = false;
    if (character) { character.enabled = true; character.resetInputs(); }
    modeButton.innerText = 'Toggle Mode: Player (Active)';
    modeButton.style.background = 'rgba(59,130,246,0.85)';
  }
  applyModeLayout();
});

// ── Input ─────────────────────────────────────────────────────────────────────
const raycaster = new THREE.Raycaster();
const mouse     = new THREE.Vector2();
let isShooting  = false;

renderer.domElement.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  if (controllerMode === 'player') { isShooting = true; return; }
  mouse.x =  (e.clientX / window.innerWidth)  * 2 - 1;
  mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  const hit = raycaster.intersectObject(colliderMesh)[0];
  if (hit) spawnActiveVFX(hit.point);
});
window.addEventListener('pointerup', (e) => { if (e.button === 0) isShooting = false; });
window.addEventListener('contextmenu', (e) => e.preventDefault());

// Reset player input and shooting state when browser tab loses focus to prevent stuck characters
const resetLocalPlayerInput = () => {
  isShooting = false;
  if (character) {
    character.resetInputs();
  }
};
window.addEventListener('blur', resetLocalPlayerInput);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    resetLocalPlayerInput();
  }
});

function spawnActiveVFX(hit: THREE.Vector3) {
  const x = hit.x, y = hit.y, z = hit.z;
  switch (activeVFX) {
    case 'gas-native':          gasExplosionNative.spawn(x, y, z); break;
    case 'flamethrower-native': flamethrowerNative.spawn(x, y, z); break;
    case 'subemitter2-native':  subemitter2Native.spawn(x, y, z);  break;
    case 'tornado-native':      tornadoNative.spawn(x, y, z);      break;
    case 'skill-ironFortitude':  dispatchSkillFX(scene, { skill: 'ironFortitude',  x, y, z, team: 1 }); break;
    case 'skill-frostNova':      dispatchSkillFX(scene, { skill: 'frostNova',      x, y, z, team: 1 }); break;
    case 'skill-divineShield':   dispatchSkillFX(scene, { skill: 'divineShield',   tx: x, ty: y, tz: z, team: 1 }); break;
    case 'skill-holySanctuary':  dispatchSkillFX(scene, { skill: 'holySanctuary',  x, y, z, team: 1 }); break;
    case 'skill-taunt':          dispatchSkillFX(scene, { skill: 'taunt',          x: x-2, y, z: z-2, tx: x, ty: y, tz: z, team: 1 }); break;
    case 'skill-shieldBash':     dispatchSkillFX(scene, { skill: 'shieldBash',     x: x-2, y, z: z-2, tx: x, ty: y, tz: z, team: 1 }); break;
    case 'skill-chainLightning': dispatchSkillFX(scene, { skill: 'chainLightning', positions: [x, y+4, z, x+1.5, y+1, z+1.5, x-1.5, y+1, z-1.5, x+3, y, z+3], team: 1 }); break;
    case 'skill-arrowVolley':    dispatchSkillFX(scene, { skill: 'arrowVolley',    x, z, team: 1 }); break;
    case 'skill-fireball':       dispatchSkillFX(scene, { skill: 'fireball',       fx: x, fy: y+3, fz: z, tx: x, ty: y, tz: z, team: 1 }); break;
    case 'skill-doubleShot':     dispatchSkillFX(scene, { skill: 'doubleShot',     fx: x-5, fy: y+2, fz: z-5, tx: x, ty: y, tz: z, team: 1 }); break;
  }
}

// ── Boss HP Bar UI ────────────────────────────────────────────────────────────
const bossUiContainer = document.createElement('div');
bossUiContainer.id = 'boss-ui-container';
bossUiContainer.style.cssText = `
  position: absolute; top: 24px; left: 50%; transform: translateX(-50%);
  width: 420px; background: rgba(10, 5, 5, 0.65);
  backdrop-filter: blur(12px) saturate(180%); border: 1px solid rgba(239, 68, 68, 0.45);
  border-radius: 12px; padding: 10px 16px;
  box-shadow: 0 8px 32px rgba(239, 68, 68, 0.15), 0 0 16px rgba(0, 0, 0, 0.8);
  color: white; font-family: 'Outfit', sans-serif; z-index: 9999; display: none;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
`;
bossUiContainer.innerHTML = `
  <div style="font-weight:800;font-size:14px;text-transform:uppercase;color:#ef4444;letter-spacing:2px;text-shadow:0 0 8px rgba(239,68,68,0.8);margin-bottom:6px;text-align:center;font-family:'Press Start 2P',monospace;">Giant Chief Barbarian</div>
  <div style="position:relative;width:100%;height:18px;background:rgba(30,5,5,0.9);border-radius:6px;overflow:hidden;border:1.5px solid rgba(255,255,255,0.12);">
    <div id="boss-hp-bar-fg" style="width:100%;height:100%;background:linear-gradient(90deg,#b91c1c,#ef4444,#f87171);box-shadow:0 0 8px #ef4444;transition:width 0.1s ease-out;"></div>
    <div id="boss-hp-bar-text" style="position:absolute;width:100%;height:100%;top:0;left:0;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:900;text-shadow:1px 1px 2px black;font-family:monospace;letter-spacing:1px;">10000000 / 10000000</div>
  </div>
`;
document.body.appendChild(bossUiContainer);

// Cache Boss HP bar DOM refs — queried once, never again in the hot loop
const bossHpBarFg   = document.getElementById('boss-hp-bar-fg')   as HTMLDivElement;
const bossHpBarText = document.getElementById('boss-hp-bar-text') as HTMLDivElement;

// ── FPS Counter ───────────────────────────────────────────────────────────────
const fpsEl = document.getElementById('fps') as HTMLSpanElement;
let frameCount = 0;
let lastFpsTime = performance.now();
const clock = new THREE.Clock();
 
// ── DPS Tracker Variables ─────────────────────────────────────────────────────
let totalDamageDealt = 0;
let totalAttacksCount = 0;
let combatStartTime = 0;
const damageTimestamps: { time: number; amount: number }[] = [];
const attackTimestamps: number[] = [];

const dpsValEl   = document.getElementById('dps-val') as HTMLSpanElement;
const dpsAvgEl   = document.getElementById('dps-avg') as HTMLSpanElement;
const apsValEl   = document.getElementById('aps-val') as HTMLSpanElement;
const apsAvgEl   = document.getElementById('aps-avg') as HTMLSpanElement;
const dpsTotalEl = document.getElementById('dps-total') as HTMLSpanElement;
const dpsTimeEl  = document.getElementById('dps-time') as HTMLSpanElement;
const dpsResetBtn = document.getElementById('dps-reset') as HTMLButtonElement;

if (dpsResetBtn) {
  dpsResetBtn.addEventListener('click', () => {
    totalDamageDealt = 0;
    totalAttacksCount = 0;
    combatStartTime = 0;
    damageTimestamps.length = 0;
    attackTimestamps.length = 0;
    if (dpsValEl) dpsValEl.innerText = '0';
    if (dpsAvgEl) dpsAvgEl.innerText = '0';
    if (apsValEl) apsValEl.innerText = '0';
    if (apsAvgEl) apsAvgEl.innerText = '0';
    if (dpsTotalEl) dpsTotalEl.innerText = '0';
    if (dpsTimeEl) dpsTimeEl.innerText = '0s';
  });
}

// ── Scratch vectors for remote lerp — zero alloc ──────────────────────────────
const _remotePos = new THREE.Vector3();
const _spawnDir  = new THREE.Vector3();
const _tgtPos    = new THREE.Vector3();

// ── Animate Loop ──────────────────────────────────────────────────────────────
function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();

  if (character && controllerMode === 'player') {
    character.update(delta);

    // Update local nametag HP
    const localHp = myPlayer().getState('hp') ?? 100;
    character.updateNameTag(localHp / 100);

    // Boss projectile damage scan (player-owned projectiles already filtered by ownerId)
    for (let i = projectileSystem.projectiles.length - 1; i >= 0; i--) {
      const p = projectileSystem.projectiles[i];
      if (p.age <= 0.15) continue;                         // Prevent spawn self-collision
      if (p.ownerId !== undefined) continue;                // Friendly Fire: skip all player projectiles

      if (p.mesh.position.distanceTo(character.position) < 1.2) {
        gasExplosionNative.spawn(p.mesh.position.x, p.mesh.position.y, p.mesh.position.z);
        damageHUDBatcher.spawn({ skill: 'normal', value: 10, position: [character.position.x, character.position.y, character.position.z], isCrit: false, isMagic: false });
        const nextHp = Math.max(0, localHp - 10);
        myPlayer().setState('hp', nextHp === 0 ? 100 : nextHp);
        p.mesh.visible = false;
        // Swap-pop O(1) removal (consistent with projectileSystem internals)
        projectileSystem.projectiles[i] = projectileSystem.projectiles[projectileSystem.projectiles.length - 1];
        projectileSystem.projectiles.length--;
      }
    }

    // Local attack
    if (isShooting) {
      while (character.attackCooldown <= 0 && character.triggerAttack()) {
        const spawnPos = character.getWeaponWorldPosition('hand_l', 1.0);
        const target   = character.getNearestTarget();
        let dir        = character.getForwardVector();
        if (target) {
          target.getWorldPosition(_tgtPos);
          _tgtPos.y += 0.5;
          dir = _tgtPos.sub(spawnPos).normalize();
        }
        projectileSystem.spawn(spawnPos, dir, 40, target, -1, myPlayer().id);

        const nowSec = performance.now() / 1000;
        if (totalDamageDealt === 0 && totalAttacksCount === 0) {
          combatStartTime = nowSec;
        }
        totalAttacksCount++;
        attackTimestamps.push(nowSec);
      }
    }
  } else {
    controls.update();
  }

  // Remote players
  for (const { player, controller } of playersAndControllers) {
    if (player.id === myPlayer().id) continue;

    const pos = player.getState('pos');
    if (pos) {
      _remotePos.set(pos.x, pos.y, pos.z);
      controller.position.lerp(_remotePos, 0.2);
    }

    const rot = player.getState('rot');
    if (rot !== undefined && controller.playerMesh) {
      // Shortest-angle lerp for rotation without Math.sin/cos allocation
      let diff = rot - controller.playerMesh.rotation.y;
      diff -= Math.round(diff / (Math.PI * 2)) * (Math.PI * 2); // wrap to [-π, π]
      controller.playerMesh.rotation.y += diff * 0.2;
    }

    const action = player.getState('action');
    if (action) controller.playAnimationState(action);
    controller.update(delta);
    controller.updateNameTag((player.getState('hp') ?? 100) / 100);

    // Remote player attack visual
    if (player.getState('isShooting') && controller.triggerAttack()) {
      const spawnPos = controller.getWeaponWorldPosition('hand_l', 1.0);
      const target   = controller.getNearestTarget();
      let dir        = controller.getForwardVector();
      if (target) {
        target.getWorldPosition(_tgtPos);
        _tgtPos.y += 0.5;
        dir = _tgtPos.sub(spawnPos).normalize();
      }
      projectileSystem.spawn(spawnPos, dir, 40, target, -1, player.id);
    }
  }

  // Send local state to server
  if (character) {
    const me = myPlayer(); // cache — avoids 4 fn calls per frame
    me.setState('pos', { x: character.position.x, y: character.position.y, z: character.position.z });
    me.setState('rot', character.playerMesh?.rotation.y ?? 0);
    me.setState('action', character.currentActionName);
    me.setState('isShooting', isShooting);
  }

  // Projectile update + hit callback
  projectileSystem.update(delta, colliderMesh, (hitPoint, target) => {
    if (target && playerGroupSet.has(target)) return; // O(1) friendly-fire check
    const isBoss = bossController !== null && target === bossController.playerGroup;
    if (isBoss) {
      // Send hit event to server. Server calculates damage authoritatively and broadcasts back.
      bossController!.takeDamage(12000, hitPoint.x, hitPoint.y, hitPoint.z);
    } else {
      damageHUDBatcher.spawn({ skill: 'normal', value: 100, position: [hitPoint.x, hitPoint.y, hitPoint.z], isCrit: Math.random() > 0.8 });
    }
  });

  // Boss update + HP bar sync
  if (bossController) {
    bossController.update(delta, playersAndControllers);
    bossUiContainer.style.display = bossController.hp > 0 ? 'block' : 'none';
    const ratio = Math.max(0, bossController.hp / bossController.maxHp);
    bossHpBarFg.style.width    = `${ratio * 100}%`;
    bossHpBarText.innerText    = `${bossController.hp} / ${bossController.maxHp}`;
  }

  skillsSystem.update(delta, character ?? undefined);

  // Day cycle
  if (isHost()) {
    dayCycle.update();
    setState('dayCycleStartTime', (dayCycle as any).startTime);
  } else {
    const hostTime = getState('dayCycleStartTime');
    if (hostTime !== undefined) (dayCycle as any).startTime = hostTime;
    dayCycle.update();
  }
  timeLabel.innerText = `Waktu: ${dayCycle.getCurrentPeriod()}`;

  gasExplosionNative.update(delta);
  flamethrowerNative.update(delta);
  subemitter2Native.update(delta);
  tornadoNative.update(delta);
  updateFX(delta);
  damageHUDBatcher.update(delta);
  if (!isMobile) {
    windEffect.update(delta);
    sceneryWindLines.update(delta, clock.getElapsedTime());
  }

  renderer.render(scene, camera);

  frameCount++;
  const now = performance.now();
  if (now - lastFpsTime >= 1000) {
    fpsEl.textContent = frameCount.toString();
    frameCount = 0;
    lastFpsTime = now;
  }

  // Update DPS UI (Sliding window 3.0s)
  const nowSec = performance.now() / 1000;
  const threeSecAgo = nowSec - 3.0;
  let rollingSum = 0;
  
  for (let i = damageTimestamps.length - 1; i >= 0; i--) {
    if (damageTimestamps[i].time < threeSecAgo) {
      damageTimestamps.splice(0, i + 1);
      break;
    }
  }
  for (let i = 0; i < damageTimestamps.length; i++) {
    rollingSum += damageTimestamps[i].amount;
  }

  for (let i = attackTimestamps.length - 1; i >= 0; i--) {
    if (attackTimestamps[i] < threeSecAgo) {
      attackTimestamps.splice(0, i + 1);
      break;
    }
  }

  if (totalDamageDealt > 0 || totalAttacksCount > 0) {
    const duration = nowSec - combatStartTime;
    const currentDps = rollingSum / Math.max(1, Math.min(duration, 3.0));
    const averageDps = totalDamageDealt / Math.max(0.1, duration);
    const currentAps = attackTimestamps.length / Math.max(1, Math.min(duration, 3.0));
    const averageAps = totalAttacksCount / Math.max(0.1, duration);

    if (dpsValEl) dpsValEl.innerText = Math.round(currentDps).toLocaleString();
    if (dpsAvgEl) dpsAvgEl.innerText = Math.round(averageDps).toLocaleString();
    if (apsValEl) apsValEl.innerText = currentAps.toFixed(1);
    if (apsAvgEl) apsAvgEl.innerText = averageAps.toFixed(1);
    if (dpsTotalEl) dpsTotalEl.innerText = totalDamageDealt.toLocaleString();
    if (dpsTimeEl) dpsTimeEl.innerText = `${Math.round(duration)}s`;
  } else {
    if (dpsValEl) dpsValEl.innerText = '0';
    if (dpsAvgEl) dpsAvgEl.innerText = '0';
    if (apsValEl) apsValEl.innerText = '0';
    if (apsAvgEl) apsAvgEl.innerText = '0';
    if (dpsTotalEl) dpsTotalEl.innerText = '0';
    if (dpsTimeEl) dpsTimeEl.innerText = '0s';
  }
}

// ── Skill Hotkeys ─────────────────────────────────────────────────────────────
window.addEventListener('keydown', (e) => {
  if (!character || controllerMode !== 'player') return;
  const playerPos = character.position;
  const forward   = character.getForwardVector();
  if (skillsSystem.handleInput(e.code, playerPos, forward, character)) {
    RPC.call('cast_skill', {
      skillCode: e.code,
      playerPos: { x: playerPos.x, y: playerPos.y, z: playerPos.z },
      forward:   { x: forward.x,   y: forward.y,   z: forward.z   },
      playerId:  myPlayer().id,
    }, RPC.Mode.OTHERS);
  }
});

// ── Bootstrap ─────────────────────────────────────────────────────────────────
const loadingOverlay = document.createElement('div');
loadingOverlay.id = 'loading-overlay';
loadingOverlay.style.cssText = `
  position: absolute;
  top: 0; left: 0; width: 100%; height: 100%;
  background: radial-gradient(circle at 50% 40%, #1a0505 0%, #050202 100%);
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  z-index: 100000;
  transition: opacity 0.5s ease-out;
  color: white;
  font-family: 'Outfit', sans-serif;
`;
loadingOverlay.innerHTML = `
  <div style="font-weight: 800; font-size: 22px; text-transform: uppercase; color: #ef4444; letter-spacing: 4px; text-shadow: 0 0 16px rgba(239, 68, 68, 0.7); margin-bottom: 18px; font-family: 'Press Start 2P', monospace;">Loading Game</div>
  <div style="font-size: 12px; color: rgba(255,255,255,0.6); letter-spacing: 2px; font-family: monospace; margin-bottom: 14px;" id="loading-status">Menghubungkan ke server...</div>
  <div style="width: 260px; height: 6px; background: rgba(255,255,255,0.08); border-radius: 4px; overflow: hidden; position: relative; border: 1px solid rgba(239,68,68,0.2);">
    <div id="loading-bar" style="height: 100%; width: 0%; background: linear-gradient(90deg, #b91c1c, #ef4444, #f87171); box-shadow: 0 0 12px #ef4444; border-radius: 4px; transition: width 0.25s ease-out;"></div>
  </div>
  <div id="loading-pct" style="font-size: 11px; color: rgba(255,255,255,0.35); margin-top: 8px; font-family: monospace;">0%</div>
`;
document.body.appendChild(loadingOverlay);

function setLoadingProgress(pct: number, label: string) {
  const bar  = document.getElementById('loading-bar');
  const pctEl = document.getElementById('loading-pct');
  const statusEl = document.getElementById('loading-status');
  if (bar) bar.style.width = `${Math.round(pct)}%`;
  if (pctEl) pctEl.innerText = `${Math.round(pct)}%`;
  if (statusEl) statusEl.innerText = label;
}

// Pre-fetch all game assets so GPU shader compiles happen BEFORE animate() starts
async function preloadGameAssets() {
  const assets = [
    '/character/characters/Ranger.glb',
    '/character/characters/Barbarian.glb',
    '/character/animation/Rig_Medium_General.glb',
    '/character/animation/Rig_Medium_MovementAdvanced.glb',
    '/character/animation/Rig_Medium_CombatRanged.glb',
    '/character/animation/Rig_Medium_CombatMelee.glb',
    '/character/animation/Rig_Medium_MovementBasic.glb',
    '/character/animation/Running_Forward_Flip.glb',
    '/character/weapons/bow_withString.glb',
    '/character/weapons/quiver.glb',
  ];
  const total = assets.length;
  let done = 0;

  // Parallel fetch with progress — browser caches the responses so GLTFLoader.loadAsync hits cache
  await Promise.all(assets.map(url =>
    fetch(url)
      .then(r => r.arrayBuffer()) // force into browser cache
      .catch(() => {}) // non-blocking: if file missing, GLTFLoader handles the real error
      .finally(() => {
        done++;
        setLoadingProgress(20 + (done / total) * 70, `Memuat aset: ${done}/${total}`);
      })
  ));
}

insertCoin().then(async () => {
  setLoadingProgress(10, 'Server terhubung! Memuat aset...');
  await preloadGameAssets();
  setLoadingProgress(95, 'Memulai game...');

  // Brief yield so browser can paint the 95% bar before the heavy setup
  await new Promise(r => setTimeout(r, 80));
  setLoadingProgress(100, 'Siap!');

  bossController = new BossController(scene, skillsSystem);
  bossController.setEnvironment(colliderMesh);

  // Sync damage HUD for everyone (server-authoritative damage broadcast)
  onBossDamaged((data: any) => {
    damageHUDBatcher.spawn({
      skill: data.isCrit ? 'boss' : 'normal',
      value: data.damage,
      position: [data.x, data.y + 0.8, data.z],
      isCrit: data.isCrit,
    });
    if (bossController && bossController.hp > 0) {
      bossController.playHit();
      // Trigger white flash for Crit, red flash for normal hits
      bossController.flash(0.12, data.isCrit ? 0xffffff : 0xff3333);
      // Spawn hit impact particle sparks at the hit coordinates
      gasExplosionNative.spawn(data.x, data.y + 0.5, data.z);
    }
    // Update local player's DPS Tracker authoritatively
    if (data.attackerId === myPlayer().id) {
      const nowSec = performance.now() / 1000;
      if (totalDamageDealt === 0) {
        combatStartTime = nowSec;
      }
      totalDamageDealt += data.damage;
      damageTimestamps.push({ time: nowSec, amount: data.damage });
    }
  });

  RPC.register('boss_cast_skill', (data: any) => {
    skillsSystem.triggerNetworkVFX(data.skillType, data.targetPos.x, data.targetPos.z);
    return Promise.resolve();
  });

  RPC.register('cast_skill', (data: any) => {
    const caster = playersAndControllers.find(p => p.player.id === data.playerId)?.controller;
    skillsSystem.triggerNetworkVFX(data.skillCode, data.playerPos.x, data.playerPos.z, caster?.playerMesh ?? undefined);
    return Promise.resolve();
  });

  onPlayerJoin((player) => {
    const isLocal = player.id === myPlayer().id;
    const charCtrl = new CharacterController(scene, camera, isLocal);
    charCtrl.setEnvironment(colliderMesh);

    const targets: THREE.Object3D[] = [];
    if (bossController?.playerGroup) targets.push(bossController.playerGroup);
    charCtrl.setTargets(targets);

    const username = player.getProfile()?.name || (isLocal ? 'You' : 'Player');
    charCtrl.initNameTag(username);

    if (isLocal) {
      character = charCtrl;
      player.setState('hp', 100);
      applyModeLayout();
    }

    playerGroupSet.add(charCtrl.playerGroup); // Register in O(1) friendly-fire set

    player.onQuit(() => {
      scene.remove(charCtrl.playerGroup);
      playerGroupSet.delete(charCtrl.playerGroup);
      const idx = playersAndControllers.findIndex(p => p.player.id === player.id);
      if (idx !== -1) playersAndControllers.splice(idx, 1);
    });

    playersAndControllers.push({ player, controller: charCtrl });
  });

  animate();

  // Fade out loading overlay now that everything is warm and running
  loadingOverlay.style.opacity = '0';
  setTimeout(() => loadingOverlay.remove(), 500);
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
