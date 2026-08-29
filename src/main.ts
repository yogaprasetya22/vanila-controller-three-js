import './style.css';
import * as THREE from 'three';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import { LocalPlayer } from './entities/player/LocalPlayer.ts';
import { BaseEnemyController } from './entities/enemy/BaseEnemyController.ts';
import { DayCycleManager } from './day-cycle-manager.ts';
import { NetworkDebugger } from './systems/netcode/NetworkDebugger.ts';
import { insertCoin, isHost, myPlayer, RPC, setState, getState, onBossDamaged, NetworkManager } from './network/NetworkManager.ts';
import { ProjectileSystem } from './systems/combat/ProjectileSystem.ts';
import { SkillsSystem } from './systems/combat/SkillsSystem.ts';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
// @ts-ignore
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

import { CartoonBlueGasExplosionNativeVFX } from './graphics/effects/CartoonBlueGasExplosionNative.ts';
import { CartoonBlueFlamethrowerNativeVFX } from './graphics/effects/CartoonBlueFlamethrowerNative.ts';
import { Subemitter2NativeVFX } from './graphics/effects/Subemitter2Native.ts';
import { CartoonTornadoNativeVFX } from './graphics/effects/CartoonTornadoNative.ts';
import { updateFX } from './graphics/effects/FXCore';
import { WindEffectManager } from './graphics/scenery/WindLines.ts';
import { SceneryWindLines } from './graphics/effects/SceneryWindLines.ts';
import { damageHUDBatcher } from './graphics/effects/DamageHUDBatcher.ts';
import { setScene } from './graphics/core/scene';
import { World } from './graphics/scenery/World.ts';

// Import Modular Managers
import { AssetLoader } from './core/AssetLoader.ts';
import { UIManager } from './ui/UIManager.ts';
import { InputManager } from './systems/InputManager.ts';
import { RendererSetup } from './graphics/core/RendererSetup.ts';
import { NPCManager } from './systems/NPCManager.ts';
import { PlayerManager } from './systems/PlayerManager.ts';
import { LODManager } from './graphics/core/LODManager.ts';
import { CombatTracker } from './systems/combat/CombatTracker.ts';
import { Minimap } from './graphics/core/Minimap.ts';

// Extend THREE prototypes with BVH acceleration
(THREE.BufferGeometry.prototype as any).computeBoundsTree = computeBoundsTree;
(THREE.BufferGeometry.prototype as any).disposeBoundsTree = disposeBoundsTree;
(THREE.Mesh.prototype as any).raycast = acceleratedRaycast;

// ── Initialize Managers ──
const container = document.getElementById('canvas-container') as HTMLDivElement;
const scene = new THREE.Scene();
setScene(scene);
scene.fog = new THREE.Fog(0x050505, 50, 200);

AssetLoader.init();
UIManager.init();
RendererSetup.init(scene, container);
Minimap.init();
Minimap.attachLight(scene);
CombatTracker.init();

const camera = RendererSetup.camera;
const renderer = RendererSetup.renderer;
const controls = RendererSetup.controls;
const dirLight = RendererSetup.dirLight;
const ambientLight = RendererSetup.ambientLight;

const dayCycle = new DayCycleManager(scene, 60);
dayCycle.setDirectionalLight(dirLight);
dayCycle.setAmbientLight(ambientLight);

// ── Environment & BVH Collider ──
const gltfLoader = new GLTFLoader();
gltfLoader.setMeshoptDecoder(MeshoptDecoder);

const world = new World(scene, gltfLoader, camera);
const colliderMesh = world.getColliderMesh();

// Rebuild BVH collider meshes and layers traversal
world.rebuildCollider((newColliderMesh) => {
  colliderMesh.geometry.dispose();
  colliderMesh.geometry = newColliderMesh.geometry;
  (colliderMesh.geometry as any).boundsTree = (newColliderMesh.geometry as any).boundsTree;
  if (character) {
    character.setEnvironment(colliderMesh);
  }

  scene.traverse((child) => {
    if ((child as THREE.Mesh).isMesh || (child as any).isInstancedMesh) {
      if (!child.layers.isEnabled(1) || child.layers.isEnabled(0)) {
        child.layers.enable(1);
      }
    }
  });
});

// ── Systems ──
let character: LocalPlayer | null = null;
const projectileSystem = new ProjectileSystem(scene);
const gasExplosionNative = new CartoonBlueGasExplosionNativeVFX(scene, camera);
const flamethrowerNative = new CartoonBlueFlamethrowerNativeVFX(scene, camera);
const subemitter2Native  = new Subemitter2NativeVFX(scene, camera);
const tornadoNative      = new CartoonTornadoNativeVFX(scene, camera);
const skillsSystem = new SkillsSystem(subemitter2Native, flamethrowerNative, tornadoNative);
const windEffect   = new WindEffectManager(scene);
const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);

if (!isMobile) windEffect.start();
const sceneryWindLines = new SceneryWindLines(scene);

// Initialize Input Manager
InputManager.init(() => character, skillsSystem);

// ── Game Stats & Loop Setup ──
const fpsEl = document.getElementById('fps') as HTMLSpanElement;
let frameCount = 0;
let lastFpsTime = performance.now();
const clock = new THREE.Clock();
const netDebugger = new NetworkDebugger();

// Scratch vectors for slerps/aiming - zero alloc
const _tgtPos = new THREE.Vector3();

// ponytail: dayCycleStartTime only changes when host time resets — send max 1x per 5s
// Ceiling: reduce to 2s if clock drift becomes noticeable across clients.
let _lastDayCycleStartSent = 0;
let _lastDayCycleStartTime = -1;

// ── Unified Render Loop ──
function animate() {
  requestAnimationFrame(animate);
  // ponytail: cap delta at 50ms — prevents physics overshoot when tab unfocused or lag spike.
  // Cache elapsed once — clock.getElapsedTime() recalculates internally each call.
  const rawDelta = clock.getDelta();
  const delta = rawDelta > 0.05 ? 0.05 : rawDelta;
  const elapsed = clock.elapsedTime; // already updated by getDelta()
  netDebugger.update();

  // Update level of detail (LOD) dynamically
  LODManager.update(delta, 'player', character, camera, PlayerManager.playersAndControllers, NPCManager.npcControllers);

  if (character) {
    character.update(delta);
    character.resolveObstacleCollisions(world.trees, world.rocks, world.vegetation);

    const localHp = myPlayer().getState('hp') ?? 100;
    character.updateNameTag(localHp / 100);

    // Boss projectile collision check
    for (let i = projectileSystem.projectiles.length - 1; i >= 0; i--) {
      const p = projectileSystem.projectiles[i];
      if (p.age <= 0.15) continue;
      if (p.ownerId !== undefined) continue; // friendly-fire: skip player projectiles

      if (p.mesh.position.distanceTo(character.position) < 1.2) {
        gasExplosionNative.spawn(p.mesh.position.x, p.mesh.position.y, p.mesh.position.z);
        damageHUDBatcher.spawn({ 
          skill: 'normal', 
          value: 10, 
          position: [character.position.x, character.position.y, character.position.z], 
          isCrit: false, 
          isMagic: false 
        });
        const nextHp = Math.max(0, localHp - 10);
        myPlayer().setState('hp', nextHp === 0 ? 100 : nextHp);
        p.mesh.visible = false;
        
        projectileSystem.projectiles[i] = projectileSystem.projectiles[projectileSystem.projectiles.length - 1];
        projectileSystem.projectiles.length--;
      }
    }

    // Local shooting
    if (InputManager.isShooting) {
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
        CombatTracker.recordAttack();
      }
    }
  } else {
    controls.update();
  }

  // Update Remote Players movement Advanced Interpolations
  PlayerManager.updateRemotePlayers(delta);

  // Send local state to server
  if (character) {
    const me = myPlayer();
    me.setState('pos', { x: character.position.x, y: character.position.y, z: character.position.z });
    me.setState('rot', character.playerMesh?.rotation.y ?? 0);
    me.setState('action', character.currentActionName);
    me.setState('isShooting', InputManager.isShooting);
  }

  // Sync NPCs list dynamically
  NPCManager.syncNPCs(scene, colliderMesh, skillsSystem);

  // Projectile system update
  projectileSystem.update(delta, colliderMesh, (hitPoint, target) => {
    if (target && PlayerManager.playerGroupSet.has(target)) return; // friendly-fire

    let hitNPC: BaseEnemyController | null = null;
    for (const ctrl of NPCManager.npcControllers.values()) {
      if (target === ctrl.playerGroup) {
        hitNPC = ctrl;
        break;
      }
    }
    if (hitNPC) {
      hitNPC.takeDamage(12000, hitPoint.x, hitPoint.y, hitPoint.z);
    }
  });

  // Update NPCs and retrieve active World Boss
  const activeBoss = NPCManager.update(delta);
  let targetBoss: BaseEnemyController | null = null;
  if (activeBoss && character) {
    const target = character.getNearestTarget();
    if (target === activeBoss.playerGroup) {
      targetBoss = activeBoss;
    }
  }
  UIManager.updateBossHP(targetBoss);

  skillsSystem.update(delta, character ?? undefined);

  // Day cycle
  if (isHost()) {
    dayCycle.update();
    // ponytail: only broadcast startTime when it actually changed, throttled to 5s.
    // NetworkManager.setState is not batched — every call is a direct WebSocket send.
    const _now2 = performance.now();
    const _st = (dayCycle as any).startTime;
    if (_st !== _lastDayCycleStartTime && _now2 - _lastDayCycleStartSent > 5000) {
      setState('dayCycleStartTime', _st);
      _lastDayCycleStartTime = _st;
      _lastDayCycleStartSent = _now2;
    }
  } else {
    const hostTime = getState('dayCycleStartTime');
    if (hostTime !== undefined) (dayCycle as any).startTime = hostTime;
    dayCycle.update();
  }
  UIManager.updateTimeLabel(dayCycle.getCurrentPeriod());

  gasExplosionNative.update(delta);
  flamethrowerNative.update(delta);
  subemitter2Native.update(delta);
  tornadoNative.update(delta);
  updateFX(delta);
  damageHUDBatcher.update(delta);

  if (!isMobile) {
    windEffect.update(delta, elapsed, camera.position);
    sceneryWindLines.update(delta, elapsed, camera.position);
  }

  world.update(delta, camera.position, camera, character?.position);

  // Render multi-viewport perspective + orthographic minimap viewports
  RendererSetup.render(scene);
  Minimap.render(renderer, scene, character ? character.position : null);

  // FPS HUD updates
  frameCount++;
  const now = performance.now();
  if (now - lastFpsTime >= 1000) {
    fpsEl.textContent = frameCount.toString();
    const ping = NetworkManager.ping;
    const pingStr = ping < 1.0 ? "&lt;1" : Math.round(ping).toString();
    
    UIManager.updatePerformanceHUD(frameCount, pingStr, renderer.info.memory, renderer.info.render);
    
    frameCount = 0;
    lastFpsTime = now;
  }

  // Update DPS HUD stats (sliding window 3.0s)
  CombatTracker.update();
}

// ── Bootstrap Preloading & Authentication Lobby ──
AssetLoader.preloadGameAssets(renderer, camera).then(async () => {
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
  const logoutBtn      = document.getElementById("lobby-logout-btn");

  const httpBase = import.meta.env.VITE_API_URL || `${window.location.protocol}//${window.location.hostname}:8080`;
  let hasValidSession = false;
  let savedName = "";
  let savedRole = "archer";

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

  if (hasValidSession && sessionPanel && authPanel) {
    authPanel.style.display  = "none";
    sessionPanel.style.display = "block";
    localStorage.setItem("playerName", savedName);
    localStorage.setItem("playerRole", savedRole);
  }

  // Remove loading screen overlay
  const loadingOverlay = document.getElementById('loading-overlay');
  if (loadingOverlay) loadingOverlay.style.display = 'none';

  let finalUsername = savedName;
  let finalPassword = "";

  logoutBtn?.addEventListener("click", () => {
    document.cookie = "token=; Max-Age=0; path=/";
    localStorage.removeItem("authToken");
    localStorage.removeItem("playerName");
    localStorage.removeItem("playerRole");
    window.location.reload();
  });

  await new Promise<void>((resolve) => {
    const handleConnect = async (isSession: boolean) => {
      UIManager.hideError();
      if (submitButtonAuth) submitButtonAuth.disabled = true;
      if (submitButtonSess) submitButtonSess.disabled = true;

      if (isSession) {
        finalUsername = savedName;
        finalPassword = "";
        const rval = roomInputSess?.value || "";
        if (rval) window.location.hash = rval;
        if (lobbyOverlay) lobbyOverlay.style.display = "none";
        
        const overlay = document.getElementById('loading-overlay');
        if (overlay) overlay.style.display = 'flex';
        resolve();
        return;
      }

      finalUsername = usernameInput?.value?.trim() || "";
      finalPassword = passwordInput?.value || "";

      if (!finalUsername || !finalPassword) {
        UIManager.showError("Username and password are required.");
        if (submitButtonAuth) submitButtonAuth.disabled = false;
        if (submitButtonSess) submitButtonSess.disabled = false;
        return;
      }

      if (roleSelect)  localStorage.setItem("playerRole", roleSelect.value);
      if (usernameInput) localStorage.setItem("playerName", finalUsername);
      if (roomInput?.value) window.location.hash = roomInput.value;

      if (lobbyOverlay) lobbyOverlay.style.display = "none";
      const overlay = document.getElementById('loading-overlay');
      if (overlay) overlay.style.display = 'flex';
      resolve();
    };

    submitButtonAuth?.addEventListener("click", () => handleConnect(false));
    submitButtonSess?.addEventListener("click", () => handleConnect(true));

    const bypassBtn = document.getElementById("lobby-bypass-btn");
    bypassBtn?.addEventListener("click", () => {
      window.location.href = "/vfx.html" + window.location.hash;
    });
  });

  AssetLoader.setProgress(90, 'Menghubungkan ke server...');
  try {
    if (finalUsername !== "VFX_Tester") {
      await insertCoin(finalUsername, finalPassword);
    }
  } catch (err: any) {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) overlay.style.display = "none";
    if (lobbyOverlay) lobbyOverlay.style.display = "flex";
    UIManager.showError(err?.message || "Login failed. Please check your credentials.");
    if (submitButtonAuth) submitButtonAuth.disabled = false;
    if (submitButtonSess) submitButtonSess.disabled = false;
    return;
  }
  AssetLoader.setProgress(95, 'Memulai game...');

  await new Promise(r => setTimeout(r, 80));
  AssetLoader.setProgress(100, 'Siap!');
  NetworkManager.startPingInterval();

  // Dynamic combat network callbacks
  onBossDamaged((data: any) => {
    const isAttackerLocal = data.attackerId === myPlayer().id;
    damageHUDBatcher.spawn({
      skill: data.isCrit ? 'boss' : 'normal',
      value: data.damage,
      position: [data.x, data.y + 0.8, data.z],
      isCrit: data.isCrit,
      forceShow: isAttackerLocal,
    });
    const targetNPC = NPCManager.npcControllers.get(data.npcId);
    if (targetNPC && targetNPC.hp > 0) {
      targetNPC.playHit();
      targetNPC.flash(0.12, data.isCrit ? 0xffffff : 0xff3333);
      gasExplosionNative.spawn(data.x, data.y + 0.5, data.z);
    }
    if (data.attackerId === myPlayer().id) {
      CombatTracker.recordDamage(data.damage);
    }
  });

  RPC.register('boss_cast_skill', (data: any) => {
    skillsSystem.triggerNetworkVFX(data.skillType, data.targetPos.x, data.targetPos.z);
    return Promise.resolve();
  });

  RPC.register('cast_skill', (data: any) => {
    const caster = PlayerManager.playersAndControllers.find(p => p.player.id === data.playerId)?.controller;
    skillsSystem.triggerNetworkVFX(data.skillCode, data.playerPos.x, data.playerPos.z, caster?.playerMesh ?? undefined);
    return Promise.resolve();
  });

  // Setup dynamic player synchronization callbacks
  PlayerManager.setupPlayerJoining(scene, camera, colliderMesh, (localChar) => {
    character = localChar;
  });

  animate();

  AssetLoader.fadeOut(() => {
    UIManager.showGameUI();
  });
});
