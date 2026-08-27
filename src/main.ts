import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import { LocalPlayer } from './entities/player/LocalPlayer.ts';
import { RemotePlayer } from './entities/player/RemotePlayer.ts';
import { BaseEnemyController } from './entities/enemy/BaseEnemyController.ts';
import { EnemyFactory } from './entities/enemy/EnemyFactory.ts';
import { CHARACTER_CONFIG } from './entities/player/PlayerConfig.ts';
import { TargetingManager } from './systems/targeting/TargetingManager.ts';
import { DayCycleManager } from './day-cycle-manager.ts';
import { NetworkDebugger } from './systems/netcode/NetworkDebugger.ts';
import { onPlayerJoin, insertCoin, isHost, myPlayer, RPC, setState, getState, onBossDamaged, NetworkManager } from './network/NetworkManager.ts';
import { ProjectileSystem } from './systems/combat/ProjectileSystem.ts';
import { SkillsSystem } from './systems/combat/SkillsSystem.ts';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
// @ts-ignore
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { BossGroundSlamFX } from './graphics/effects/BossGroundSlamFX.ts';

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

import { setScene, setCamera, referencePosition } from './graphics/core/scene';

// ── Scene ─────────────────────────────────────────────────────────────────────
const container = document.getElementById('canvas-container') as HTMLDivElement;
const scene = new THREE.Scene();
setScene(scene);
scene.fog = new THREE.Fog(0x050505, 50, 200);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
setCamera(camera);
camera.position.set(0, 15, 30);

const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
const renderer = new THREE.WebGLRenderer({
  antialias: !isMobile,
  powerPreference: 'high-performance',
  precision: 'mediump',
  stencil: false,
  alpha: false,
  depth: true
});
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
import { World } from './graphics/scenery/World.ts';

const gltfLoader = new GLTFLoader();
gltfLoader.setMeshoptDecoder(MeshoptDecoder);

const world = new World(scene, gltfLoader, camera);

// Use Floor terrain geometry for three-mesh-bvh precision raycasting and collision
const colliderMesh = world.getColliderMesh();

// ── Systems ───────────────────────────────────────────────────────────────────
let character: LocalPlayer | null = null;
const npcControllers = new Map<string, BaseEnemyController>();
const npcPathLines = new Map<string, THREE.Line>();
const playersAndControllers: { player: any; controller: LocalPlayer }[] = [];
// Pre-built Set of player groups for O(1) friendly-fire check — updated on join/quit
const playerGroupSet = new Set<THREE.Object3D>();

const projectileSystem = new ProjectileSystem(scene);
const gasExplosionNative = new CartoonBlueGasExplosionNativeVFX(scene, camera);
const flamethrowerNative = new CartoonBlueFlamethrowerNativeVFX(scene, camera);
const subemitter2Native  = new Subemitter2NativeVFX(scene, camera);
const tornadoNative      = new CartoonTornadoNativeVFX(scene, camera);
const skillsSystem = new SkillsSystem(subemitter2Native, flamethrowerNative, tornadoNative);
const windEffect   = new WindEffectManager(scene);

// Helper to sync NPCs list dynamically — called every frame from render loop
// NPC state now arrives via world_snapshot (not room_state_update) at 30Hz
function syncNPCs() {
  const npcsState = getState("npcs");
  if (!npcsState) return;

  // serverTs embedded by broadcastWorldSnapshot() — 0 = fallback to clock offset
  const snapshotServerTs: number = (npcsState as any)._snapshotServerTs ?? 0;

  for (const id in npcsState) {
    if (id === '_snapshotServerTs') continue; // skip metadata key
    const data = npcsState[id];
    let ctrl = npcControllers.get(id);
    if (!ctrl) {
      ctrl = EnemyFactory.create(scene, id, data.type, data.name, data.maxHp, data.hp, skillsSystem);
      ctrl.setEnvironment(colliderMesh);
      npcControllers.set(id, ctrl);
    }
    ctrl.hp = data.hp;
    ctrl.maxHp = data.maxHp;
    if (typeof data.level === 'number') {
      ctrl.level = data.level;
    }
    ctrl.speed = data.speed;
    if (data.fsm && typeof data.fsm.state === 'number') {
      ctrl.fsmState = data.fsm.state;
    }
    ctrl.interpolator.addSnapshot(data.x, data.y, data.z, data.rot, data.action, snapshotServerTs);

    // ── Visual Path Line Rendering ──
    // Render dynamic path segments if the NPC has waypoints
    if (data.path && Array.isArray(data.path) && data.path.length > 0) {
      const points: THREE.Vector3[] = [];
      // Start path representation from the NPC's current visual position
      points.push(new THREE.Vector3(ctrl.playerGroup.position.x, 0.05, ctrl.playerGroup.position.z));
      
      for (const wpt of data.path) {
        if (typeof wpt.x === 'number' && typeof wpt.z === 'number') {
          points.push(new THREE.Vector3(wpt.x, 0.05, wpt.z));
        }
      }

      // Escape steering state is 1, normal is 0 or 2
      const isEscaping = data.fsm && data.fsm.state === 1;
      const lineColor = isEscaping ? 0xff3333 : 0x33ffff; // Red if escaping, Cyan if normal pathfinding

      let line = npcPathLines.get(id);
      if (line) {
        line.geometry.setFromPoints(points);
        (line.material as THREE.LineBasicMaterial).color.setHex(lineColor);
      } else {
        const geom = new THREE.BufferGeometry().setFromPoints(points);
        const mat = new THREE.LineBasicMaterial({ color: lineColor, linewidth: 2 });
        line = new THREE.Line(geom, mat);
        scene.add(line);
        npcPathLines.set(id, line);
      }
    } else {
      // Clear path if no path returned or empty
      const line = npcPathLines.get(id);
      if (line) {
        scene.remove(line);
        line.geometry.dispose();
        (line.material as THREE.Material).dispose();
        npcPathLines.delete(id);
      }
    }
  }

  for (const id of npcControllers.keys()) {
    if (id === '_snapshotServerTs') continue;
    if (!npcsState[id]) {
      const ctrl = npcControllers.get(id);
      if (ctrl) {
        scene.remove(ctrl.playerGroup);
        if (ctrl.nameTagSprite) {
          ctrl.playerGroup.remove(ctrl.nameTagSprite);
        }
        ctrl.dispose();
      }
      npcControllers.delete(id);

      // Clean up path lines on remove
      const line = npcPathLines.get(id);
      if (line) {
        scene.remove(line);
        line.geometry.dispose();
        (line.material as THREE.Material).dispose();
        npcPathLines.delete(id);
      }
    }
  }
}

if (!isMobile) windEffect.start();
const sceneryWindLines = new SceneryWindLines(scene);

// ── Input ─────────────────────────────────────────────────────────────────────
let isShooting  = false;

renderer.domElement.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  isShooting = true;
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
const netDebugger = new NetworkDebugger();

// ── WebGL Profiler HUD ────────────────────────────────────────────────────────
const webglStatsEl = document.createElement('div');
webglStatsEl.id = 'webgl-stats';
webglStatsEl.style.cssText = `
  position: fixed;
  top: 60px;
  left: 20px;
  background: rgba(10, 10, 15, 0.75);
  color: #00ffaa;
  border: 1px solid rgba(0, 255, 170, 0.3);
  padding: 8px 12px;
  border-radius: 6px;
  font-family: monospace;
  font-size: 11px;
  z-index: 9999;
  pointer-events: none;
  backdrop-filter: blur(5px);
  line-height: 1.4;
`;
document.body.appendChild(webglStatsEl);

 
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
const _scratchQuat = new THREE.Quaternion();
const _axisY = new THREE.Vector3(0, 1, 0); // ponytail: pre-alloc, avoids new Vector3 per-frame in fallback path

// LOD sort throttle — sort only runs every 500ms, not every frame
let _lodSortTimer = 0;

// ── Animate Loop ──────────────────────────────────────────────────────────────
function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();
  netDebugger.update();

  // ── Level of Detail (LOD) Calculations ─────────────────────────────────────────
  // Sort and evaluate LOD levels every 250ms — sorting 20+ entities every frame is wasteful.
  const refPos = (controllerMode === 'player' && character) ? character.position : camera.position;
  referencePosition.copy(refPos);

  _lodSortTimer += delta;
  if (_lodSortTimer >= 0.25) {
    _lodSortTimer = 0;

    const remotePlayers = playersAndControllers.filter(p => p.player.id !== myPlayer().id).map(p => p.controller);
    const enemies = Array.from(npcControllers.values());
    const allEntities = [...remotePlayers, ...enemies];
    const totalEntities = allEntities.length;

    // 1. Calculate distances to reference position
    allEntities.forEach(e => {
      (e as any)._distToLocal = e.position.distanceTo(referencePosition);
    });

    // 2. Count how many entities are strictly inside the 10m radius
    let entitiesInside10m = 0;
    allEntities.forEach(e => {
      if ((e as any)._distToLocal <= 10.0) {
        entitiesInside10m++;
      }
    });

    // 3. Apply LOD states based on distance and crowd density constraints
    allEntities.forEach(e => {
      const dist = (e as any)._distToLocal;
      
      if (dist > 40.0) {
        e.setLODLevel('culled');
      } else if (dist <= 10.0 || totalEntities <= 10) {
        e.setLODLevel('full');
      } else {
        // Default behavior for entities outside 10m under high crowd conditions
        e.setLODLevel('name-only');
      }
    });

    // If less than 10 entities are within the 10m radius, guarantee that the closest 10
    // entities in the room (which are <= 40m) are rendered in 'full' detail to maximize visual quality.
    if (entitiesInside10m <= 10 && totalEntities > 10) {
      allEntities.sort((a, b) => (a as any)._distToLocal - (b as any)._distToLocal);
      allEntities.forEach((e, index) => {
        const dist = (e as any)._distToLocal;
        if (dist <= 40.0) {
          if (index < 10) {
            e.setLODLevel('full');
          } else if (dist > 10.0) {
            e.setLODLevel('name-only');
          }
        } else {
          e.setLODLevel('culled');
        }
      });
    }
  }

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

  // Remote players — pre-alloc scratch to avoid GC per-frame
  // ponytail: one shared quat is safe; interpolator writes to outQuaternion which is controller.playerMesh.quaternion directly
  for (const { player, controller } of playersAndControllers) {
    if (player.id === myPlayer().id) continue;

    const pos = player.getState('pos');
    const rot = player.getState('rot') ?? 0;
    const serverTs = player.getState('_serverTs') ?? 0;

    // Always push snapshot so position buffer stays current even for LOD-off players
    if (pos) {
      controller.interpolator.addSnapshot(pos.x, pos.y, pos.z, rot, player.getState('action') ?? 'idle', serverTs);
    }

    // LOD-off: skip heavy per-frame work (animation blending, slerp calculations, weapon visuals)
    if (controller.lodLevel === 'culled') {
      controller.update(delta);
      continue;
    }

    if (controller.lodLevel === 'name-only') {
      if (pos) {
        controller.position.set(pos.x, pos.y, pos.z);
        controller.playerGroup.position.copy(controller.position);
      }
      controller.update(delta);
      controller.updateNameTag((player.getState('hp') ?? 100) / 100);
      continue;
    }

    let animTimeScale = 1.0;
    const outQuat = controller.playerMesh ? controller.playerMesh.quaternion : _scratchQuat;
    const state = controller.interpolator.update(delta, controller.position, outQuat);
    if (state) {
      controller.playerGroup.position.copy(controller.position);
      if (state.action === 'walk') {
        const baseWalkSpeed = 4.0;
        animTimeScale = Math.max(0.1, state.velocity / baseWalkSpeed);
      }
      controller.playAnimationState(state.action, 0.15, animTimeScale);
    } else {
      // Fallback
      if (pos) {
        controller.position.set(pos.x, pos.y, pos.z);
        controller.playerGroup.position.copy(controller.position);
      }
      if (controller.playerMesh) {
        controller.playerMesh.quaternion.setFromAxisAngle(_axisY, rot);
      }
      controller.playAnimationState(player.getState('action') ?? 'idle');
    }
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

  // Sync NPCs dynamically from server state
  syncNPCs();

  // Projectile update + hit callback
  projectileSystem.update(delta, colliderMesh, (hitPoint, target) => {
    if (target && playerGroupSet.has(target)) return; // O(1) friendly-fire check

    // Find which NPC was hit
    let hitNPC: BaseEnemyController | null = null;
    for (const ctrl of npcControllers.values()) {
      if (target === ctrl.playerGroup) {
        hitNPC = ctrl;
        break;
      }
    }

    if (hitNPC) {
      // Send hit event targeting this specific NPC
      hitNPC.takeDamage(12000, hitPoint.x, hitPoint.y, hitPoint.z);
    }
  });

  // Update all NPC controllers and determine which main boss to show on top global HP HUD
  let mainBoss: BaseEnemyController | null = null;
  for (const ctrl of npcControllers.values()) {
    ctrl.update(delta);
    if (ctrl.hp > 0) {
      if (ctrl.npcType === 'world_boss') {
        mainBoss = ctrl;
      } else if (ctrl.npcType === 'raid_boss' && (!mainBoss || mainBoss.npcType !== 'world_boss')) {
        mainBoss = ctrl;
      }
    }
  }

  if (mainBoss) {
    bossUiContainer.style.display = 'block';
    const ratio = Math.max(0, mainBoss.hp / mainBoss.maxHp);
    bossHpBarFg.style.width    = `${ratio * 100}%`;
    bossHpBarText.innerText    = `${mainBoss.npcName}: ${mainBoss.hp} / ${mainBoss.maxHp}`;
    const nConfig = CHARACTER_CONFIG.npcs[mainBoss.npcType as 'mob' | 'raid_boss' | 'world_boss'] || CHARACTER_CONFIG.npcs.mob;
    bossHpBarFg.style.backgroundColor = nConfig.hudColor;
  } else {
    bossUiContainer.style.display = 'none';
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

  // Update dynamic World elements (water waves, wind lines, turrets)
  world.update(delta, camera.position, camera, character?.position);

  renderer.render(scene, camera);

  frameCount++;
  const now = performance.now();
  if (now - lastFpsTime >= 1000) {
    fpsEl.textContent = frameCount.toString();
    
    // Update WebGL Memory & Render Statistics
    const memoryInfo = renderer.info.memory;
    const renderInfo = renderer.info.render;
    const ping = NetworkManager.ping;
    const pingStr = ping < 1.0 ? "&lt;1" : Math.round(ping).toString();
    webglStatsEl.innerHTML = `
      <b style="color:#ffffff;">PERFORMANCE HUD</b><br/>
      FPS: <span style="color:#00ffaa; font-weight:bold;">${frameCount}</span><br/>
      Ping: <span style="color:#3b82f6; font-weight:bold;">${pingStr} ms</span><br/>
      Geometries: ${memoryInfo.geometries}<br/>
      Textures: ${memoryInfo.textures}<br/>
      Draw Calls: ${renderInfo.calls}<br/>
      Triangles: ${renderInfo.triangles}
    `;

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
  if (e.repeat) return;
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

// Pre-fetch all game assets and pre-warm GPU shader materials to eliminate combat micro-stuttering
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

  // Parallel fetch with progress (fetches from 10% to 75% progress)
  await Promise.all(assets.map(url =>
    fetch(url)
      .then(r => r.arrayBuffer()) // force into browser cache
      .catch(() => {})
      .finally(() => {
        done++;
        setLoadingProgress(10 + (done / total) * 65, `Memuat aset: ${done}/${total}`);
      })
  ));

  // GPU Shader Pre-compilation / Pre-warming
  setLoadingProgress(80, 'Mengompilasi shader GPU...');

  const dummyScene = new THREE.Scene();
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);

  // Load models into dummy scene
  try {
    const gltfs = await Promise.all([
      loader.loadAsync('/character/characters/Ranger.glb'),
      loader.loadAsync('/character/characters/Barbarian.glb')
    ]);
    gltfs.forEach(gltf => {
      dummyScene.add(gltf.scene);
    });
  } catch (e) {
    console.warn("Shader pre-warm model load skipped:", e);
  }

  // Pre-warm active particle VFX
  const dummyGas = new CartoonBlueGasExplosionNativeVFX(dummyScene, camera);
  const dummyFlame = new CartoonBlueFlamethrowerNativeVFX(dummyScene, camera);
  const dummyTornado = new CartoonTornadoNativeVFX(dummyScene, camera);
  const dummySub = new Subemitter2NativeVFX(dummyScene, camera);

  dummyGas.spawn(0, 0, 0);
  dummyFlame.spawn(0, 0, 0);
  dummyTornado.spawn(0, 0, 0);

  // Pre-warm Boss telegraph SDF warning geometries/materials
  const dummyTelegraph = new BossGroundSlamFX(dummyScene);
  dummyTelegraph.spawn(0, 0, 8.0, 1.5, null, 0, false, 0, 0xff0000); // circle
  dummyTelegraph.spawn(0, 0, 8.0, 1.5, null, 1, false, 0, 0xff0000); // cone
  dummyTelegraph.spawn(0, 0, 8.0, 1.5, null, 2, false, 0, 0xff0000); // line
  dummyTelegraph.spawn(0, 0, 8.0, 1.5, null, 3, false, 0, 0xff0000); // ring
  dummyTelegraph.spawn(0, 0, 8.0, 1.5, null, 4, false, 0, 0xff0000); // cross

  // Force GPU driver to compile all shader code immediately
  renderer.compile(dummyScene, camera);

  // Safely dispose pre-warmed structures
  dummyScene.traverse((node) => {
    if (node instanceof THREE.Mesh) {
      if (node.geometry) node.geometry.dispose();
      if (Array.isArray(node.material)) {
        node.material.forEach(m => m.dispose());
      } else if (node.material) {
        node.material.dispose();
      }
    }
  });

  setLoadingProgress(90, 'Shader siap!');
}

setLoadingProgress(10, 'Memuat aset game...');
preloadGameAssets().then(async () => {
  const usernameInput  = document.getElementById("lobby-username") as HTMLInputElement;
  const passwordInput  = document.getElementById("lobby-password") as HTMLInputElement;
  const roleSelect     = document.getElementById("lobby-role") as HTMLSelectElement;
  const roomInput      = document.getElementById("lobby-room") as HTMLInputElement;
  const roomInputSess  = document.getElementById("lobby-room-session") as HTMLInputElement;
  const submitButtonAuth = document.getElementById("lobby-submit-auth") as HTMLButtonElement;
  const submitButtonSess = document.getElementById("lobby-submit-session") as HTMLButtonElement;
  const lobbyOverlay   = document.getElementById("lobby-overlay");
  const authPanel      = document.getElementById("lobby-auth-panel");
  const sessionPanel   = document.getElementById("lobby-session-panel");
  const errorEl        = document.getElementById("lobby-error");
  const logoutBtn      = document.getElementById("lobby-logout-btn");

  const showError = (msg: string, type: "error"|"info" = "error") => {
    if (!errorEl) return;
    errorEl.textContent = msg;
    errorEl.className = type;
    errorEl.style.display = "block";
  };
  const hideError = () => { if (errorEl) errorEl.style.display = "none"; };

  const httpBase = import.meta.env.VITE_API_URL || `${window.location.protocol}//${window.location.hostname}:8080`;
  let hasValidSession = false;
  let savedName = "";
  let savedRole = "archer";

  // Check existing session — use credentials: include & Authorization Bearer header fallback
  try {
    const headers: Record<string, string> = {};
    const localToken = localStorage.getItem("authToken");
    if (localToken) {
      headers["Authorization"] = `Bearer ${localToken}`;
    }
    const sessionResp = await fetch(`${httpBase}/auth/session`, { 
      credentials: "include",
      headers
    });
    if (sessionResp.ok) {
      const sd = await sessionResp.json();
      if (sd.authenticated) {
        hasValidSession = true;
        savedName = sd.username;
        savedRole = sd.role;
        // Populate welcome panel elements
        const welcomeAvatar = document.getElementById("welcome-avatar");
        const welcomeName   = document.getElementById("welcome-name");
        const welcomeRole   = document.getElementById("welcome-role");
        const wsRole        = document.getElementById("ws-role");
        if (welcomeAvatar) welcomeAvatar.textContent = savedName.charAt(0).toUpperCase();
        if (welcomeName)   welcomeName.textContent   = savedName;
        if (welcomeRole)   welcomeRole.textContent   = savedRole.toUpperCase();
        if (wsRole)        wsRole.textContent        = savedRole.toUpperCase();
      }
    }
  } catch (e) {
    console.log("[Auth] No active session:", e);
  }

  // Switch to correct panel
  if (hasValidSession && sessionPanel && authPanel) {
    authPanel.style.display  = "none";
    sessionPanel.style.display = "block";
    localStorage.setItem("playerName", savedName);
    localStorage.setItem("playerRole", savedRole);
  }

  // Hide loading overlay — show lobby
  loadingOverlay.style.display = "none";

  let finalUsername = savedName;
  let finalPassword = "";

  // Logout → reload to reset session
  logoutBtn?.addEventListener("click", () => {
    document.cookie = "token=; Max-Age=0; path=/";
    localStorage.removeItem("authToken");
    localStorage.removeItem("playerName");
    localStorage.removeItem("playerRole");
    window.location.reload();
  });

  await new Promise<void>((resolve) => {
    const handleConnect = async (isSession: boolean) => {
      hideError();
      if (submitButtonAuth) submitButtonAuth.disabled = true;
      if (submitButtonSess) submitButtonSess.disabled = true;

      if (isSession) {
        finalUsername = savedName;
        finalPassword = "";
        const rval = roomInputSess?.value || "";
        if (rval) window.location.hash = rval;
        if (lobbyOverlay) lobbyOverlay.style.display = "none";
        loadingOverlay.style.display = "flex";
        resolve();
        return;
      }

      finalUsername = usernameInput?.value?.trim() || "";
      finalPassword = passwordInput?.value || "";

      if (!finalUsername || !finalPassword) {
        showError("Username and password are required.");
        if (submitButtonAuth) submitButtonAuth.disabled = false;
        if (submitButtonSess) submitButtonSess.disabled = false;
        return;
      }

      if (roleSelect)  localStorage.setItem("playerRole", roleSelect.value);
      if (usernameInput) localStorage.setItem("playerName", finalUsername);
      if (roomInput?.value) window.location.hash = roomInput.value;

      if (lobbyOverlay) lobbyOverlay.style.display = "none";
      loadingOverlay.style.display = "flex";
      resolve();
    };

    submitButtonAuth?.addEventListener("click", () => handleConnect(false));
    submitButtonSess?.addEventListener("click", () => handleConnect(true));

    // Offline VFX Test bypass handler - redirect to dedicated vfx.html sandbox
    const bypassBtn = document.getElementById("lobby-bypass-btn");
    bypassBtn?.addEventListener("click", () => {
      window.location.href = "/vfx.html" + window.location.hash;
    });
  });

  setLoadingProgress(90, 'Menghubungkan ke server...');
  try {
    // If username is VFX_Tester, bypass the network connection call to support local offline testing
    if (finalUsername !== "VFX_Tester") {
      await insertCoin(finalUsername, finalPassword);
    } else {
      console.log("[Lobby] Offline VFX Test mode active. Skipping server websocket insertCoin.");
    }
  } catch (err: any) {
    // Show error back in lobby instead of blunt reload
    loadingOverlay.style.display = "none";
    if (lobbyOverlay) lobbyOverlay.style.display = "flex";
    showError(err?.message || "Login failed. Please check your credentials.");
    if (submitButtonAuth) submitButtonAuth.disabled = false;
    if (submitButtonSess) submitButtonSess.disabled = false;
    return;
  }
  setLoadingProgress(95, 'Memulai game...');

  // Brief yield so browser can paint the 95% bar before the heavy setup
  await new Promise(r => setTimeout(r, 80));
  setLoadingProgress(100, 'Siap!');
  NetworkManager.startPingInterval();

  // Sync damage HUD for everyone (server-authoritative damage broadcast)
  onBossDamaged((data: any) => {
    const isAttackerLocal = data.attackerId === myPlayer().id;
    damageHUDBatcher.spawn({
      skill: data.isCrit ? 'boss' : 'normal',
      value: data.damage,
      position: [data.x, data.y + 0.8, data.z],
      isCrit: data.isCrit,
      forceShow: isAttackerLocal,
    });
    const targetNPC = npcControllers.get(data.npcId);
    if (targetNPC && targetNPC.hp > 0) {
      targetNPC.playHit();
      targetNPC.flash(0.12, data.isCrit ? 0xffffff : 0xff3333);
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
    const charCtrl = isLocal ? new LocalPlayer(scene, camera) : new RemotePlayer(scene, camera);
    charCtrl.playerId = player.id;
    charCtrl.setEnvironment(colliderMesh);

    const username = player.getProfile()?.name || (isLocal ? 'You' : 'Player');
    charCtrl.initNameTag(username);

    if (isLocal) {
      character = charCtrl;
      player.setState('hp', 100);
    }

    playerGroupSet.add(charCtrl.playerGroup); // Register in O(1) friendly-fire set

    // Register Player in decoupled static TargetingManager
    const playerEntity = {
      id: player.id,
      type: 'player' as const,
      position: charCtrl.playerGroup.position,
      playerGroup: charCtrl.playerGroup,
      radius: 0.6,
      get hp() { return player.getState('hp') || 100; }
    };
    TargetingManager.registerEntity(playerEntity);

    player.onQuit(() => {
      scene.remove(charCtrl.playerGroup);
      playerGroupSet.delete(charCtrl.playerGroup);
      TargetingManager.unregisterEntity(player.id);
      const idx = playersAndControllers.findIndex(p => p.player.id === player.id);
      if (idx !== -1) playersAndControllers.splice(idx, 1);
    });

    playersAndControllers.push({ player, controller: charCtrl });
  });

  animate();

  // Fade out loading overlay now that everything is warm and running
  loadingOverlay.style.opacity = '0';
  setTimeout(() => {
    loadingOverlay.remove();
    // Show hidden game UI
    const uiEl = document.getElementById("ui");
    const statsEl = document.getElementById("stats");
    const dpsEl = document.getElementById("dps-panel");
    if (uiEl) uiEl.style.display = "block";
    if (statsEl) statsEl.style.display = "block";
    if (dpsEl) dpsEl.style.display = "block";
  }, 500);
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
