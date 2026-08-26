import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
// @ts-ignore
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { CHARACTER_CONFIG } from './PlayerConfig';
import { ProjectileSystem } from '../../systems/combat/ProjectileSystem';
import { getTerrainHeight } from '../../simulation/constants';
import { TargetingManager } from '../../systems/targeting/TargetingManager';
import { MovementInterpolator } from '../../systems/netcode/MovementInterpolator';

const gltfLoader = new GLTFLoader();
gltfLoader.setMeshoptDecoder(MeshoptDecoder);

const gltfCache = new Map<string, Promise<any>>();
function loadGLTFWithCache(url: string): Promise<any> {
  let p = gltfCache.get(url);
  if (!p) {
    p = gltfLoader.loadAsync(url);
    gltfCache.set(url, p);
  }
  return p;
}


// Module-level scratch vectors — zero heap allocation in hot attack/targeting paths
const _scratchTargetPos = new THREE.Vector3();
const _scratchSpawnPos = new THREE.Vector3();
const _scratchDir = new THREE.Vector3();
const _upVec = new THREE.Vector3(0, 1, 0);
const _weaponPos = new THREE.Vector3();
const _fallbackOffset = new THREE.Vector3();
const _forwardVec = new THREE.Vector3();
const _upAxis = new THREE.Vector3(0, 1, 0);


export class LocalPlayer {
  // THREE.js elements
  public playerGroup: THREE.Group;
  public playerMesh: THREE.Object3D | null = null;
  private camera: THREE.PerspectiveCamera;
  private scene: THREE.Scene;
  private environmentMesh: THREE.Mesh | null = null;
  private projectileSystem: ProjectileSystem | null = null;
  public teamId: number = 0;

  public setProjectileSystem(ps: ProjectileSystem): void {
    this.projectileSystem = ps;
  }

  // Animation system
  private mixer: THREE.AnimationMixer | null = null;
  private actions: { [key: string]: THREE.AnimationAction } = {};
  public currentActionName = '';
  private bowMesh: THREE.Group | null = null;
  private quiverMesh: THREE.Group | null = null;

  // Controller parameters
  public radius = 0.5;
  public height = 1.6;
  public velocity = new THREE.Vector3();
  public position = new THREE.Vector3(0, getTerrainHeight(0, 0), 0);
  public isGrounded = false;

  // Movement parameters (Ecctrl inspired)
  public speed = CHARACTER_CONFIG.physics.speed;
  public sprintMultiplier = CHARACTER_CONFIG.physics.sprintMultiplier;
  public jumpForce = CHARACTER_CONFIG.physics.jumpForce;
  public gravity = CHARACTER_CONFIG.physics.gravity;

  // Camera Settings (Spring arm / Orbit style)
  public cameraOffset = new THREE.Vector3(0, 2.5, 5);
  public cameraDistance = 11.0; // Comfort follow range (zoom default)
  private cameraTargetRotation = new THREE.Euler(0, 0, 0, 'YXZ');
  private mouseSensitivity = 0.002;
  private smoothedLookAt = new THREE.Vector3();

  // Input states
  private keys: { [key: string]: boolean } = {
    KeyW: false,
    KeyA: false,
    KeyS: false,
    KeyD: false,
    Space: false,
    ShiftLeft: false,
  };

  private lastTapTimes: { [key: string]: number } = {
    KeyW: 0,
    KeyA: 0,
    KeyS: 0,
    KeyD: 0,
  };
  private isDodging = false;
  private dodgeDirection = new THREE.Vector3();
  private dodgeTimeLeft = 0;
  private activeGhosts: Array<{
    ghost: THREE.Object3D;
    materials: THREE.Material[];
    update: (delta: number) => boolean;
  }> = [];
  private ghostSpawnTimer = 0;
  private nearestTargetCached: THREE.Object3D | null = null;
  private lastTargetCacheTime = -1;
  private dodgeCooldownLeft = 0;

  // Temp variables for math to avoid garbage collection
  private tempSegment = new THREE.Line3();
  private tempVector = new THREE.Vector3();
  private tempVector2 = new THREE.Vector3();
  private tempBox = new THREE.Box3();
  private tempTriPoint = new THREE.Vector3();
  private capsulePoint = new THREE.Vector3();

  // Smooth terrain-Y tracking: lerped toward getTerrainHeight each frame
  // Eliminates 0.5-unit grid quantization micro-jitter from height cache
  private _smoothTerrainY = 0;

  // Placeholder mesh (shown while loading GLTF assets)
  private placeholderMesh: THREE.Mesh;
  public isLocal: boolean;
  public playerId: string = '';
  public interpolator = new MovementInterpolator();
  public lodLevel: 'full' | 'name-only' | 'culled' = 'full';
  
  public setLODLevel(level: 'full' | 'name-only' | 'culled') {
    if (this.lodLevel === level) return;
    this.lodLevel = level;

    switch (level) {
      case 'full':
        this.playerGroup.visible = true;
        if (this.playerMesh) this.playerMesh.visible = true;
        if (this.placeholderMesh) this.placeholderMesh.visible = !this.playerMesh;
        if (this.nameTagSprite) this.nameTagSprite.visible = true;
        break;
      case 'name-only':
        this.playerGroup.visible = true;
        if (this.playerMesh) this.playerMesh.visible = false;
        if (this.placeholderMesh) this.placeholderMesh.visible = false;
        if (this.nameTagSprite) this.nameTagSprite.visible = true;
        break;
      case 'culled':
        this.playerGroup.visible = false;
        break;
    }
  }

  private bowSound: HTMLAudioElement | null = null;
  private lastAttackTime = 0;

  constructor(scene: THREE.Scene, camera: THREE.PerspectiveCamera, isLocal: boolean = true) {
    this.scene = scene;
    this.camera = camera;
    this.isLocal = isLocal;

    // Create player representation group
    this.playerGroup = new THREE.Group();
    this.playerGroup.position.copy(this.position);
    this.scene.add(this.playerGroup);

    // Initial placeholder (blue box)
    const geo = new THREE.BoxGeometry(this.radius * 2, this.height, this.radius * 2);
    const mat = new THREE.MeshStandardMaterial({ color: 0x3b82f6, roughness: 0.4 });
    this.placeholderMesh = new THREE.Mesh(geo, mat);
    this.placeholderMesh.position.y = this.height / 2;
    this.playerGroup.add(this.placeholderMesh);

    // Setup input listeners
    if (this.isLocal) {
      this.initInputs();
      this.initMouseLook();
      this.bowSound = new Audio('/sounds/bow_1.mp3');
    }

    // Start loading GLTF Assets asynchronously
    this.loadAssets();
  }

  public setEnvironment(mesh: THREE.Mesh) {
    this.environmentMesh = mesh;
  }

  private initInputs() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;

      if (e.code === 'KeyW' || e.code === 'ArrowUp') this.keys.KeyW = true;
      if (e.code === 'KeyA' || e.code === 'ArrowLeft') this.keys.KeyA = true;
      if (e.code === 'KeyS' || e.code === 'ArrowDown') this.keys.KeyS = true;
      if (e.code === 'KeyD' || e.code === 'ArrowRight') this.keys.KeyD = true;
      // E key dodge removed per request (now Right-Click triggers dodge)

      if (e.code === 'Space') {
        this.keys.Space = true;
        this.onSpacePressed();
      }
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.keys.ShiftLeft = true;
    });

    window.addEventListener('keyup', (e) => {
      if (e.code === 'KeyW' || e.code === 'ArrowUp') this.keys.KeyW = false;
      if (e.code === 'KeyA' || e.code === 'ArrowLeft') this.keys.KeyA = false;
      if (e.code === 'KeyS' || e.code === 'ArrowDown') this.keys.KeyS = false;
      if (e.code === 'KeyD' || e.code === 'ArrowRight') this.keys.KeyD = false;
      if (e.code === 'Space') this.keys.Space = false;
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.keys.ShiftLeft = false;
    });
  }

  public enabled = true;

  public resetInputs() {
    for (const key in this.keys) {
      this.keys[key] = false;
    }
    this.velocity.set(0, 0, 0);
    // Exit pointer lock if active when disabling
    if (document.pointerLockElement) {
      document.exitPointerLock?.();
    }
  }

  private initMouseLook() {
    // Lock pointer only on right-click (button === 2) on canvas in Player Mode
    window.addEventListener('mousedown', (e) => {
      if (e.button !== 2) return;
      
      if (this.isLocal) {
        this.triggerDodgeByKey();
      }

      const canvas = document.querySelector('canvas');
      if (this.enabled && e.target === canvas) {
        (canvas as any)?.requestPointerLock?.()?.catch?.((err: any) => {
          console.warn("Pointer lock request throttled/prevented:", err);
        });
      }
    });

    // Prevent default context menu on right-click on the canvas
    window.addEventListener('contextmenu', (e) => {
      const canvas = document.querySelector('canvas');
      if (this.enabled && e.target === canvas) {
        e.preventDefault();
      }
    });

    window.addEventListener('mousemove', (e) => {
      const canvas = document.querySelector('canvas');
      // Rotate camera if pointer is locked
      if (this.enabled && document.pointerLockElement === canvas) {
        this.cameraTargetRotation.y -= e.movementX * this.mouseSensitivity;
        this.cameraTargetRotation.x -= e.movementY * this.mouseSensitivity;
        this.cameraTargetRotation.x = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, this.cameraTargetRotation.x));
      }
    });

    window.addEventListener('wheel', (e) => {
      if (this.enabled) {
        // Zoom in/out based on scroll delta
        this.cameraDistance += e.deltaY * 0.007;
        // Apply boundaries (min 3.0m, max 20.0m)
        this.cameraDistance = Math.max(3.0, Math.min(20.0, this.cameraDistance));
      }
    }, { passive: true });
  }

  private async loadAssets() {
    try {
      // 1. Load character model, animations and weapons in parallel
      const [charGLTF, generalAnim, advancedAnim, combatAnim, basicAnim, flipAnim, bowGLTF, quiverGLTF] = await Promise.all([
        loadGLTFWithCache('/character/characters/Ranger.glb'),
        loadGLTFWithCache('/character/animation/Rig_Medium_General.glb'),
        loadGLTFWithCache('/character/animation/Rig_Medium_MovementAdvanced.glb'),
        loadGLTFWithCache('/character/animation/Rig_Medium_CombatRanged.glb'),
        loadGLTFWithCache('/character/animation/Rig_Medium_MovementBasic.glb'),
        loadGLTFWithCache('/character/animation/Running_Forward_Flip.glb'),
        loadGLTFWithCache('/character/weapons/bow_withString.glb'),
        loadGLTFWithCache('/character/weapons/quiver.glb')
      ]);

      // Remove placeholder mesh
      this.playerGroup.remove(this.placeholderMesh);
      this.placeholderMesh.geometry.dispose();
      if (Array.isArray(this.placeholderMesh.material)) {
        this.placeholderMesh.material.forEach((m) => m.dispose());
      } else {
        this.placeholderMesh.material.dispose();
      }

      // 2. Add Character Mesh to the player group
      this.playerMesh = SkeletonUtils.clone(charGLTF.scene);
      this.playerMesh.scale.setScalar(0.42); // Proporsional scale for Archer
      this.playerMesh.visible = (this.lodLevel === 'full');
      this.playerGroup.add(this.playerMesh);

      // Enable casting/receiving shadows and set hero layer for player meshes
      this.playerMesh.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          child.castShadow = false;
          child.receiveShadow = false;
          child.layers.enable(1); // Enable hero lighting layer
        }
      });

      // 3. Attach Weapons to character bones (bow_withString -> hand_l, quiver -> spine)
      this.bowMesh = this.attachWeaponToBone(this.playerMesh, bowGLTF.scene, 'hand_l', {
        pos: [0.01, 0.15, 0.0],
        rot: [0.0, -0.112, 1.458],
        scale: [1.0, 1.0, 1.0]
      });

      this.quiverMesh = this.attachWeaponToBone(this.playerMesh, quiverGLTF.scene, 'spine', {
        pos: [0.0, 0.15, -0.1],
        rot: [0, 0, 0],
        scale: [0.8, 0.8, 0.8]
      });

      // 4. Setup Skeletal Animation
      this.mixer = new THREE.AnimationMixer(this.playerMesh);

      // Combine animation clips from multiple rigs
      const allClips = [
        ...generalAnim.animations,
        ...advancedAnim.animations,
        ...combatAnim.animations,
        ...basicAnim.animations,
        ...flipAnim.animations
      ];
      
      // Filter out root node animation tracks to prevent overriding playerMesh position/rotation/orientation
      allClips.forEach((clip) => {
        clip.tracks = clip.tracks.filter((track: any) => {
          const name = track.name;
          const isRootTrack = name.startsWith('.position') || 
                              name.startsWith('.rotation') || 
                              name.startsWith('.quaternion') ||
                              name.startsWith('.scale') ||
                              name.startsWith('Scene.') ||
                              name.startsWith('OSG_Scene.') ||
                              name.startsWith('RootNode.');
          return !isRootTrack;
        });
      });
      
      const pickClip = (candidates: string[]) => {
        for (const name of candidates) {
          const found = allClips.find((c) => c.name === name);
          if (found) return found;
        }
        return allClips[0];
      };

      // Select bow-specific animations and multi-phase jump clips
      const idleClip = pickClip(["Ranged_Bow_Idle"]);
      const walkClip = pickClip(["Running_HoldingBow"]);
      const runClip = pickClip(["Running_HoldingBow"]);
      const jumpStartClip = pickClip(["Jump_Start"]);
      const jumpIdleClip = pickClip(["Jump_Idle"]);
      const jumpLandClip = pickClip(["Jump_Land"]);
      const doubleJumpClip = flipAnim.animations[0];

      // Automatically retarget/rename doubleJumpClip track names to match target bone names
      if (doubleJumpClip && allClips.length > 0) {
        let targetPrefix = "";
        const targetTrackSample = allClips[0].tracks.find((t: any) => t.name.toLowerCase().includes('hips'));
        if (targetTrackSample) {
          const parts = targetTrackSample.name.split('.');
          const bonePath = parts[0];
          const hipsIndex = bonePath.toLowerCase().indexOf('hips');
          if (hipsIndex !== -1) {
            targetPrefix = bonePath.substring(0, hipsIndex);
          }
        }

        let sourcePrefix = "";
        const sourceTrackSample = doubleJumpClip.tracks.find((t: any) => t.name.toLowerCase().includes('hips'));
        if (sourceTrackSample) {
          const parts = sourceTrackSample.name.split('.');
          const bonePath = parts[0];
          const hipsIndex = bonePath.toLowerCase().indexOf('hips');
          if (hipsIndex !== -1) {
            sourcePrefix = bonePath.substring(0, hipsIndex);
          }
        }

        if (sourcePrefix !== targetPrefix) {
          doubleJumpClip.tracks.forEach((track: any) => {
            const parts = track.name.split('.');
            let bonePath = parts[0];
            const property = parts[1];
            if (bonePath.startsWith(sourcePrefix)) {
              bonePath = targetPrefix + bonePath.substring(sourcePrefix.length);
            }
            track.name = bonePath + '.' + property;
          });
        }
      }

      const attackClip = pickClip(["Ranged_Bow_Aiming_Idle", "Ranged_Bow_Release"]);

      if (idleClip) this.actions['idle'] = this.mixer.clipAction(idleClip);
      if (walkClip) this.actions['walk'] = this.mixer.clipAction(walkClip);
      if (runClip) {
        this.actions['run'] = this.mixer.clipAction(runClip);
        this.actions['run'].timeScale = 1.25; // Scale speed of running animation by 1.25
      }
      if (jumpStartClip) this.actions['jump_start'] = this.mixer.clipAction(jumpStartClip);
      if (jumpIdleClip) this.actions['jump_idle'] = this.mixer.clipAction(jumpIdleClip);
      if (jumpLandClip) {
        this.actions['jump_land'] = this.mixer.clipAction(jumpLandClip);
        this.actions['jump_land'].setLoop(THREE.LoopOnce, 1);
        this.actions['jump_land'].clampWhenFinished = true;
      }
      if (doubleJumpClip) {
        this.actions['double_jump'] = this.mixer.clipAction(doubleJumpClip);
        this.actions['double_jump'].setLoop(THREE.LoopOnce, 1);
        this.actions['double_jump'].clampWhenFinished = true;
        this.actions['double_jump'].timeScale = 1.2; // Slightly speed up flip
      }
      if (attackClip) {
        this.actions['attack'] = this.mixer.clipAction(attackClip);
        this.actions['attack'].setLoop(THREE.LoopRepeat, Infinity);
        this.actions['attack'].clampWhenFinished = false;
        this.actions['attack'].timeScale = 1.0; // Steady timescale for aiming pose
      }

      const dodgeForwardClip = pickClip(["Dodge_Forward"]);
      const dodgeBackwardClip = pickClip(["Dodge_Backward"]);
      const dodgeLeftClip = pickClip(["Dodge_Left"]);
      const dodgeRightClip = pickClip(["Dodge_Right"]);

      const setDodgeAction = (actionName: string, clip: THREE.AnimationClip) => {
        if (!this.mixer) return;
        const act = this.mixer.clipAction(clip);
        act.setLoop(THREE.LoopOnce, 1);
        act.clampWhenFinished = true;
        act.timeScale = 1.35;
        this.actions[actionName] = act;
      };

      if (dodgeForwardClip) setDodgeAction('dodge_forward', dodgeForwardClip);
      if (dodgeBackwardClip) setDodgeAction('dodge_backward', dodgeBackwardClip);
      if (dodgeLeftClip) setDodgeAction('dodge_left', dodgeLeftClip);
      if (dodgeRightClip) setDodgeAction('dodge_right', dodgeRightClip);

      // Start by playing idle animation
      this.playAnimationState('idle');

    } catch (error: any) {
      console.error('Error loading character assets:', error);
      const el = document.createElement('div');
      el.style.cssText = 'position:absolute;top:100px;left:20px;background:rgba(255,0,0,0.85);color:white;padding:15px;border-radius:5px;font-family:monospace;font-size:12px;z-index:9999;max-width:80%';
      el.innerText = `Asset Load Error: ${error.message || error}\nStack: ${error.stack || ''}`;
      document.body.appendChild(el);
    }
  }

  private findBone(root: THREE.Object3D, pattern: string): THREE.Bone | null {
    let found: THREE.Bone | null = null;
    const lowerPattern = pattern.toLowerCase();

    // Fallback names matching the structure inside GLB files
    const fallbackBones = lowerPattern.includes('hand_r')
      ? ['handr', 'hand_r', 'armature.hand.r', 'r_hand', 'right_hand']
      : lowerPattern.includes('hand_l')
      ? ['handl', 'hand_l', 'armature.hand.l', 'l_hand', 'left_hand']
      : ['spine', 'armature.spine', 'armature.chest', 'chest', 'torso'];

    root.traverse((child) => {
      if (child instanceof THREE.Bone) {
        const boneNameLower = child.name.toLowerCase();
        if (boneNameLower.includes(lowerPattern) || fallbackBones.some((fb) => boneNameLower.includes(fb))) {
          found = child;
        }
      }
    });

    return found;
  }

  private attachWeaponToBone(
    characterRoot: THREE.Object3D,
    weaponScene: THREE.Group,
    handPattern: string,
    transform: { pos: number[]; rot: number[]; scale: number[] }
  ): THREE.Group | null {
    const bone = this.findBone(characterRoot, handPattern);
    if (!bone) {
      console.warn(`Bone matching hand pattern: ${handPattern} not found on character.`);
      return null;
    }

    const weaponClone = SkeletonUtils.clone(weaponScene) as THREE.Group;
    weaponClone.position.set(transform.pos[0], transform.pos[1], transform.pos[2]);
    weaponClone.rotation.set(transform.rot[0], transform.rot[1], transform.rot[2]);
    weaponClone.scale.set(transform.scale[0], transform.scale[1], transform.scale[2]);

    weaponClone.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        child.castShadow = false;
        child.receiveShadow = false;
        child.layers.enable(1); // Enable hero lighting layer for weapons
      }
    });

    bone.add(weaponClone);
    return weaponClone;
  }

  public playAnimationState(name: string, crossfadeDuration = 0.15, timeScale = 1.0) {
    // Dynamically scale down crossfade duration at high attack speeds to prevent muddy animation transitions
    if (name === 'attack' && timeScale > 2.0) {
      crossfadeDuration = Math.max(0.02, 0.15 / timeScale);
    }

    if (this.currentActionName === name) {
      // Still allow timeScale updates even when already in this state
      const action = this.actions[name];
      if (action) {
        action.setEffectiveTimeScale(timeScale);
      }
      return;
    }

    const currentAction = this.actions[this.currentActionName];
    const targetAction = this.actions[name];

    if (!targetAction) return;

    targetAction.reset();
    targetAction.setEffectiveTimeScale(timeScale);
    targetAction.play();

    if (currentAction) {
      currentAction.crossFadeTo(targetAction, crossfadeDuration, true);
    }

    this.currentActionName = name;
  }

  private triggerDodgeByKey() {
    if (this.isDodging || this.dodgeCooldownLeft > 0) return;

    let animName = 'dodge_backward'; // Default if no key is pressed
    let localDir = new THREE.Vector3(0, 0, 1); // Default backward

    const moveX = (this.keys.KeyD ? 1 : 0) - (this.keys.KeyA ? 1 : 0);
    const moveZ = (this.keys.KeyS ? 1 : 0) - (this.keys.KeyW ? 1 : 0);

    if (moveX !== 0 || moveZ !== 0) {
      localDir.set(moveX, 0, moveZ).normalize();
      
      // Determine dominant animation based on current active movement input keys
      if (Math.abs(moveX) >= Math.abs(moveZ)) {
        animName = moveX > 0 ? 'dodge_right' : 'dodge_left';
      } else {
        animName = moveZ > 0 ? 'dodge_backward' : 'dodge_forward';
      }
    }

    const camRotationY = this.cameraTargetRotation.y;
    this.dodgeDirection.copy(localDir).normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), camRotationY);

    this.isDodging = true;
    this.dodgeTimeLeft = 0.45;
    this.animationLockTime = 0.45;
    this.dodgeCooldownLeft = CHARACTER_CONFIG.physics.dodgeCooldown ?? 0.5;

    if (this.playerMesh) {
      this.playerMesh.rotation.y = Math.atan2(this.dodgeDirection.x, this.dodgeDirection.z);
    }

    this.playAnimationState(animName);

    this.ghostSpawnTimer = 0.05;
    this.spawnGhostTrail();
  }

  private triggerDodge(key: string) {
    if (this.isDodging || this.dodgeCooldownLeft > 0) return;

    let animName = 'dodge_forward';
    let localDir = new THREE.Vector3(0, 0, -1); // W

    if (key === 'KeyS') {
      animName = 'dodge_backward';
      localDir.set(0, 0, 1);
    } else if (key === 'KeyA') {
      animName = 'dodge_left';
      localDir.set(-1, 0, 0);
    } else if (key === 'KeyD') {
      animName = 'dodge_right';
      localDir.set(1, 0, 0);
    }

    const camRotationY = this.cameraTargetRotation.y;
    this.dodgeDirection.copy(localDir).normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), camRotationY);

    this.isDodging = true;
    this.dodgeTimeLeft = 0.45;
    this.animationLockTime = 0.45;
    this.dodgeCooldownLeft = CHARACTER_CONFIG.physics.dodgeCooldown || 1.0;

    if (this.playerMesh) {
      this.playerMesh.rotation.y = Math.atan2(this.dodgeDirection.x, this.dodgeDirection.z);
    }

    this.playAnimationState(animName);

    this.ghostSpawnTimer = 0.05;
    this.spawnGhostTrail();
  }

  private spawnGhostTrail() {
    if (!this.playerMesh) return;
    const ghost = SkeletonUtils.clone(this.playerMesh);
    ghost.position.copy(this.position);
    ghost.rotation.copy(this.playerMesh.rotation);
    this.scene.add(ghost);

    const materials: THREE.Material[] = [];
    ghost.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        const ghostMat = new THREE.MeshBasicMaterial({
          color: 0x00dfff,
          transparent: true,
          opacity: 0.35,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        mesh.material = ghostMat;
        materials.push(ghostMat);
      }
    });

    let age = 0;
    const duration = 0.38;
    const scene = this.scene;
    this.activeGhosts.push({
      ghost,
      materials,
      update(delta: number) {
        age += delta;
        const t = age / duration;
        if (t >= 1) {
          scene.remove(ghost);
          materials.forEach(m => m.dispose());
          return false;
        }
        materials.forEach(m => {
          m.opacity = 0.35 * (1.0 - t);
        });
        return true;
      }
    });
  }

  private airTime = 0;
  private animationLockTime = 0;
  private jumpCount = 0;
  public speedBuff = 1.0;
  private speedBuffDuration = 0;

  public applySpeedBuff(multiplier: number, duration: number) {
    this.speedBuff = multiplier;
    this.speedBuffDuration = duration;
  }

  public faceNearestTarget() {
    const target = this.getNearestTarget();
    if (target && this.playerMesh) {
      const targetPos = new THREE.Vector3();
      target.getWorldPosition(targetPos);
      const dx = targetPos.x - this.position.x;
      const dz = targetPos.z - this.position.z;
      this.playerMesh.rotation.y = Math.atan2(dx, dz);
    }
  }

  private onSpacePressed() {
    if (!this.enabled) return;

    // Coyote time tolerance: allow first jump if grounded or if in the air for less than 0.15s (fixes micro-floats at high speed)
    if (this.isGrounded || (this.jumpCount === 0 && this.airTime < 0.15)) {
      // First Jump
      this.velocity.y = this.jumpForce;
      this.isGrounded = false;
      this.airTime = 0.01;
      this.jumpCount = 1;
      this.animationLockTime = 0; // Clear landing animation lock instantly to allow instant consecutive jumps
      this.playAnimationState('jump_start');
    } else if (this.jumpCount === 1) {
      // Double Jump Flip!
      this.velocity.y = this.jumpForce * 1.1; // slightly higher impulse
      this.jumpCount = 2;
      this.playAnimationState('double_jump');
      this.animationLockTime = 0.65; // Lock state for flip duration (0.65s)
    }
  }

  public update(delta: number) {
    if (delta > 0.1) delta = 0.1;

    if (!this.isLocal) {
      if (this.lodLevel === 'full' && this.mixer) {
        this.mixer.update(delta);
      }
      this.playerGroup.position.copy(this.position);
      if (this.attackCooldown > 0) {
        this.attackCooldown -= delta;
      }
      
      // Remote player updates: skip ghost trails entirely for extreme performance optimization

      // Update active ghost afterimages
      for (let i = this.activeGhosts.length - 1; i >= 0; i--) {
        if (!this.activeGhosts[i].update(delta)) {
          this.activeGhosts.splice(i, 1);
        }
      }
      return;
    }


    // Update active ghost afterimages
    for (let i = this.activeGhosts.length - 1; i >= 0; i--) {
      if (!this.activeGhosts[i].update(delta)) {
        this.activeGhosts.splice(i, 1);
      }
    }

    // Tick down dodge cooldown
    if (this.dodgeCooldownLeft > 0) {
      this.dodgeCooldownLeft -= delta;
    }

    // Tick down speed buff duration
    if (this.speedBuffDuration > 0) {
      this.speedBuffDuration -= delta;
      if (this.speedBuffDuration <= 0) this.speedBuff = 1.0;
    }

    // 1. Horizontal input — always applied
    const camRotationY = this.cameraTargetRotation.y;
    const moveX = (this.keys.KeyD ? 1 : 0) - (this.keys.KeyA ? 1 : 0);
    const moveZ = (this.keys.KeyS ? 1 : 0) - (this.keys.KeyW ? 1 : 0);
    const inputDirection = this.tempVector.set(moveX, 0, moveZ).normalize();
    inputDirection.applyAxisAngle(_upVec, camRotationY);

    if (this.isDodging) {
      this.dodgeTimeLeft -= delta;
      this.ghostSpawnTimer -= delta;
      if (this.ghostSpawnTimer <= 0) {
        this.ghostSpawnTimer = 0.14; // Halved frequency (from 0.07 to 0.14) to cut CPU clone overhead by 50%
        this.spawnGhostTrail();
      }

      // 1. Allow moderate steer control during dodge for high fluid responsiveness
      if (inputDirection.lengthSq() > 0.01) {
        this.dodgeDirection.lerp(inputDirection, delta * 5.0);
        this.dodgeDirection.normalize();
      }

      // 2. Snappy start with quadratic speed decay to prevent sticky sliding near walls
      const t = Math.max(0, Math.min(1, (0.45 - this.dodgeTimeLeft) / 0.45));
      const speedFactor = Math.pow(1 - t, 2.0); // 1.0 down to 0.0 quadratically
      const dodgeSpeed = this.speed * 5.5 * speedFactor;

      this.velocity.x = this.dodgeDirection.x * dodgeSpeed;
      this.velocity.z = this.dodgeDirection.z * dodgeSpeed;

      if (this.dodgeTimeLeft <= 0) {
        this.isDodging = false;
      }
    } else {
      const currentSpeed = this.speed * (this.keys.ShiftLeft ? this.sprintMultiplier : 1) * this.speedBuff;
      this.velocity.x = inputDirection.x * currentSpeed;
      this.velocity.z = inputDirection.z * currentSpeed;
    }

    // 2. Vertical — only integrate when airborne to avoid ping-pong jitter
    if (this.isGrounded) {
      // Grounded: reset air state, do NOT touch position.y here (terrain snap handles it)
      this.airTime = 0;
      this.jumpCount = 0;
      this.velocity.y = 0;
    } else {
      // Airborne: gravity accumulates, integrate Y
      this.velocity.y += this.gravity * delta;
      this.airTime += delta;
      this.position.y += this.velocity.y * delta;
    }

    // 3. Integrate horizontal position
    this.position.x += this.velocity.x * delta;
    this.position.z += this.velocity.z * delta;
    this.playerGroup.position.copy(this.position);
    // 4. Rotate Character Mesh towards movement direction
    if (this.isDodging) {
      if (this.playerMesh) {
        this.playerMesh.rotation.y = Math.atan2(this.dodgeDirection.x, this.dodgeDirection.z);
      }
    } else if (this.playerMesh) {
      const nowSec = performance.now() / 1000;
      const isShootingState = (nowSec - this.lastAttackTime < 0.8);
      
      if (isShootingState) {
        // Face the target only — no target means keep current rotation
        const target = this.getNearestTarget();
        if (target) {
          _scratchTargetPos.copy(target.position);
          const dx = _scratchTargetPos.x - this.position.x;
          const dz = _scratchTargetPos.z - this.position.z;
          const targetAngle = Math.atan2(dx, dz);
          const currentAngle = this.playerMesh.rotation.y;
          let diff = targetAngle - currentAngle;
          diff = Math.atan2(Math.sin(diff), Math.cos(diff));
          this.playerMesh.rotation.y += diff * 15 * delta;
        }
        // No target → keep facing current direction (e.g. after boss dies)
      } else if (inputDirection.lengthSq() > 0.01) {
        const targetAngle = Math.atan2(inputDirection.x, inputDirection.z);
        const currentAngle = this.playerMesh.rotation.y;
        let diff = targetAngle - currentAngle;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        this.playerMesh.rotation.y += diff * 12 * delta;
      }
    }

    // Record air-state for landing check
    const wasGrounded = this.isGrounded;
    const wasInAir = !wasGrounded && this.airTime > 0.15;

    // 5. Resolve Collisions (terrain snap + BVH)
    this.resolveCollisions(delta);

    // Trigger land animation if player just hit the ground from mid-air
    if (this.isGrounded && wasInAir) {
      this.playAnimationState('jump_land');
      this.animationLockTime = 0.35; // Lock state briefly to play landing animation
    }

    // Update animation lock time
    if (this.animationLockTime > 0) {
      this.animationLockTime -= delta;
    }

    // 7. Handle skeletal animation transitions
    if (this.mixer) {
      const isLocked = this.animationLockTime > 0;
      if (isLocked) {
        // Keep playing locked animations (attack, double_jump, jump_land)
      } else if (!this.isGrounded && this.airTime > 0.1) {
        // Multi-phase jump based on gravity vertical velocity
        if (this.velocity.y > 0.5) {
          this.playAnimationState('jump_start');
        } else {
          this.playAnimationState('jump_idle');
        }
      } else if (inputDirection.lengthSq() > 0.01) {
        if (this.keys.ShiftLeft) {
          this.playAnimationState('run');
        } else {
          this.playAnimationState('walk');
        }
      } else {
        this.playAnimationState('idle');
      }

      // Ensure mesh is always upright
      if (this.playerMesh) {
        this.playerMesh.rotation.x = 0;
      }

      // Weapon (bow) is always visible
      if (this.bowMesh) {
        this.bowMesh.visible = true;
      }

      this.mixer.update(delta);
    }

    // Tick attack cooldown down (allow negative values for frame-rate compensation, capped to prevent multi-shot bug when idle)
    const rateOfFire = CHARACTER_CONFIG.combat.rateOfFire || 0.05;
    this.attackCooldown = Math.max(-rateOfFire, this.attackCooldown - delta);

    // Update projectiles (gerak + expire + collision)
    if (this.projectileSystem) {
      this.projectileSystem.update(delta, this.environmentMesh);
    }

    // 8. Update Camera
    this.updateCamera(delta);
  }

  public attackCooldown = 0;
  private targets: THREE.Object3D[] = [];

  public setTargets(targets: THREE.Object3D[]) {
    this.targets = targets;
  }

  public getNearestTarget(): THREE.Object3D | null {
    const now = performance.now();
    if (now === this.lastTargetCacheTime) {
      return this.nearestTargetCached;
    }
    this.lastTargetCacheTime = now;

    const nearestEntity = TargetingManager.getNearestTarget(this.position, 'enemy');
    if (nearestEntity) {
      this.nearestTargetCached = nearestEntity.playerGroup;
      return nearestEntity.playerGroup;
    }
    
    this.nearestTargetCached = null;
    return null;
  }

  public triggerAttack(): boolean {
    if (this.isDodging) return false; // Dodge has absolute priority over attacks
    if (this.currentActionName === 'double_jump' && this.animationLockTime > 0) {
      return false;
    }
    if (this.attackCooldown > 0 || !this.actions['attack']) return false;

    // Get target once — reused for projectile aim
    const target = this.getNearestTarget();

    this.lastAttackTime = performance.now() / 1000;

    const rateOfFire = CHARACTER_CONFIG.combat.rateOfFire || 0.05;
    const animScale = CHARACTER_CONFIG.combat.attackAnimScale || 1.0;
    this.playAnimationState('attack', 0.08, animScale);
    // Lock animation to attack pose for 90% of the duration to prevent jittery transitions back to walk/idle
    this.animationLockTime = (rateOfFire * 0.9) || 0.18;
    if (this.attackCooldown <= 0) {
      this.attackCooldown += rateOfFire;
    } else {
      this.attackCooldown = rateOfFire;
    }

    if (this.bowSound) {
      this.bowSound.currentTime = 0.11;
      this.bowSound.play().catch(() => { });
    }

    if (this.projectileSystem) {
      const spawnPos = this.getWeaponWorldPosition('hand_l', 1.0); // uses scratch internally
      let dx = 0, dy = 0, dz = 1;
      if (target) {
        _scratchTargetPos.copy(target.position);
        _scratchTargetPos.y += 0.5;
        _scratchDir.copy(_scratchTargetPos).sub(spawnPos).normalize();
        dx = _scratchDir.x; dy = _scratchDir.y; dz = _scratchDir.z;
      } else {
        _scratchDir.copy(this.getForwardVector());
        dx = _scratchDir.x; dy = _scratchDir.y; dz = _scratchDir.z;
      }
      this.projectileSystem.spawn(spawnPos, _scratchDir, CHARACTER_CONFIG.projectiles.speed, target ?? null, this.teamId, this.playerId);
    }
    return true;
  }

  public getForwardVector(): THREE.Vector3 {
    const forward = _forwardVec;
    if (this.playerMesh) {
      this.playerMesh.getWorldDirection(forward);
    } else {
      forward.set(0, 0, -1).applyAxisAngle(_upAxis, this.cameraTargetRotation.y);
    }
    return forward.normalize();
  }

  public getWeaponWorldPosition(handPattern: string, fallbackOffset = 1.1): THREE.Vector3 {
    const pos = _weaponPos;
    const bone = this.playerMesh ? this.findBone(this.playerMesh, handPattern) : null;
    if (bone) {
      bone.getWorldPosition(pos);
    } else {
      _fallbackOffset.set(0, fallbackOffset, 0);
      pos.copy(this.position).add(_fallbackOffset);
    }
    return pos;
  }

  private resolveCollisions(delta = 0.016) {
    if (!this.environmentMesh || !this.environmentMesh.geometry.boundsTree) {
      const rawTerrainY = getTerrainHeight(this.position.x, this.position.z);

      // Lerp smoothTerrainY toward actual terrain height — removes 0.5m grid step artifacts
      // Factor 20 = tracks terrain in ~50ms (imperceptible lag, zero jitter)
      const t = Math.min(1, delta * 20);
      this._smoothTerrainY = this._smoothTerrainY + (rawTerrainY - this._smoothTerrainY) * t;

      if (this.position.y <= this._smoothTerrainY + 0.01) {
        this.position.y = this._smoothTerrainY;
        this.velocity.y = 0;
        this.isGrounded = true;
      } else {
        this.isGrounded = false;
      }
      this.playerGroup.position.copy(this.position);
      return;
    }

    const bvh = this.environmentMesh.geometry.boundsTree;

    const capsuleStart = this.tempSegment.start;
    const capsuleEnd = this.tempSegment.end;

    capsuleStart.copy(this.position).addScaledVector(_upVec, this.radius);
    capsuleEnd.copy(this.position).addScaledVector(_upVec, this.height - this.radius);

    this.tempBox.makeEmpty();
    this.tempBox.expandByPoint(capsuleStart);
    this.tempBox.expandByPoint(capsuleEnd);
    this.tempBox.min.subScalar(this.radius);
    this.tempBox.max.addScalar(this.radius);

    let groundedThisFrame = false;

    // Run collision resolution in 3 passes to handle corners and sliding smoothly
    for (let iter = 0; iter < 3; iter++) {
      capsuleStart.copy(this.position).addScaledVector(_upVec, this.radius);
      capsuleEnd.copy(this.position).addScaledVector(_upVec, this.height - this.radius);

      this.tempBox.makeEmpty();
      this.tempBox.expandByPoint(capsuleStart);
      this.tempBox.expandByPoint(capsuleEnd);
      this.tempBox.min.subScalar(this.radius);
      this.tempBox.max.addScalar(this.radius);

      bvh.shapecast({
        intersectsBounds: (box) => box.intersectsBox(this.tempBox),
        intersectsTriangle: (tri) => {
          const distance = tri.closestPointToSegment(this.tempSegment, this.tempTriPoint, this.capsulePoint);

          if (distance < this.radius) {
            const depth = this.radius - distance;
            const normal = this.tempVector2.copy(this.capsulePoint).sub(this.tempTriPoint).normalize();

            this.position.addScaledVector(normal, depth);

            // Immediately update the capsule segment start/end so subsequent triangle tests in this pass use the new position (prevents jitter)
            capsuleStart.copy(this.position).addScaledVector(_upVec, this.radius);
            capsuleEnd.copy(this.position).addScaledVector(_upVec, this.height - this.radius);

            if (normal.y > 0.5) {
              groundedThisFrame = true;
            }

            const dot = this.velocity.dot(normal);
            if (dot < 0) {
              if (Math.abs(normal.y) < 0.7) {
                // Wall/Slope collision: only cancel horizontal velocity to preserve vertical jump impulse
                const hNormalX = normal.x;
                const hNormalZ = normal.z;
                const hLen = Math.sqrt(hNormalX * hNormalX + hNormalZ * hNormalZ);
                if (hLen > 0.0001) {
                  const nx = hNormalX / hLen;
                  const nz = hNormalZ / hLen;
                  const hDot = this.velocity.x * nx + this.velocity.z * nz;
                  if (hDot < 0) {
                    this.velocity.x -= nx * hDot;
                    this.velocity.z -= nz * hDot;
                  }
                }
              } else {
                // Floor/Ceiling collision: cancel full velocity
                this.velocity.addScaledVector(normal, -dot);
              }
            }
          }
        }
      });
    }

    this.isGrounded = groundedThisFrame;
    this.playerGroup.position.copy(this.position);
  }

  private updateCamera(delta: number) {
    const targetLookAt = this.position.clone().add(new THREE.Vector3(0, this.height * 0.75, 0));
    
    // Initialize on first frame to prevent camera sliding in from (0,0,0)
    if (this.smoothedLookAt.lengthSq() === 0) {
      this.smoothedLookAt.copy(targetLookAt);
    } else {
      // Lerp look-at point with floatier vertical lag to dampen jumps/falls
      const lerpSpeed = 8 * delta;
      this.smoothedLookAt.x = THREE.MathUtils.lerp(this.smoothedLookAt.x, targetLookAt.x, lerpSpeed);
      this.smoothedLookAt.y = THREE.MathUtils.lerp(this.smoothedLookAt.y, targetLookAt.y, lerpSpeed * 0.6); // damp vertical movement
      this.smoothedLookAt.z = THREE.MathUtils.lerp(this.smoothedLookAt.z, targetLookAt.z, lerpSpeed);
    }

    // Calculate spherical coordinates based on cameraTargetRotation angles (Yaw/Pitch)
    const theta = this.cameraTargetRotation.y;
    const phi = Math.PI / 2 - this.cameraTargetRotation.x;
    const distance = this.cameraDistance;

    const relativeOffset = new THREE.Vector3(
      distance * Math.sin(phi) * Math.sin(theta),
      distance * Math.cos(phi),
      distance * Math.sin(phi) * Math.cos(theta)
    );

    const targetCameraPosition = this.smoothedLookAt.clone().add(relativeOffset);

    // Keep camera at least 0.5m above the ground level (Y=0)
    const minCameraHeight = 0.5;
    if (targetCameraPosition.y < minCameraHeight) {
      targetCameraPosition.y = minCameraHeight;
    }

    // Smoothly follow position
    this.camera.position.lerp(targetCameraPosition, 8 * delta);

    // Double check and apply safety clamp to actual camera position
    if (this.camera.position.y < minCameraHeight) {
      this.camera.position.y = minCameraHeight;
    }

    // Lock camera orientation onto the focus point (prevents rotation overshoot/jitter)
    this.camera.lookAt(this.smoothedLookAt);
  }

  private nameTagCanvas: HTMLCanvasElement | null = null;
  private nameTagTexture: THREE.CanvasTexture | null = null;
  public nameTagSprite: THREE.Sprite | null = null;
  public username = "Player";
  public hp = 100;
  private _lastHpRatio = -1; // ponytail: dirty-check to skip canvas redraw when HP unchanged

  public initNameTag(username: string) {
    this.username = username;
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    
    this.nameTagCanvas = canvas;
    this.nameTagTexture = new THREE.CanvasTexture(canvas);
    
    const material = new THREE.SpriteMaterial({ map: this.nameTagTexture, depthTest: true, depthWrite: false });
    this.nameTagSprite = new THREE.Sprite(material);
    this.nameTagSprite.scale.set(1.8, 0.45, 1);
    this.nameTagSprite.position.set(0, this.height + 0.35, 0);
    this.playerGroup.add(this.nameTagSprite);
    
    this.updateNameTag(1.0);
  }

  public updateNameTag(hpRatio: number) {
    if (this.lodLevel === 'culled') return;

    // Dirty check: skip expensive canvas 2D redraw when HP hasn't changed
    if (Math.abs(hpRatio - this._lastHpRatio) < 0.001) return;
    this._lastHpRatio = hpRatio;

    if (!this.nameTagCanvas || !this.nameTagTexture) return;
    const ctx = this.nameTagCanvas.getContext('2d')!;
    ctx.clearRect(0, 0, 256, 64);
    
    // Draw Username
    ctx.font = 'Bold 20px Arial';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
    ctx.shadowBlur = 4;
    ctx.fillText(this.username, 128, 26);
    
    // Draw HP Bar BG
    ctx.fillStyle = 'rgba(20, 20, 20, 0.85)';
    ctx.fillRect(28, 38, 200, 12);
    
    // Draw HP Bar FG
    ctx.fillStyle = '#22c55e'; // Green
    ctx.fillRect(28, 38, 200 * Math.max(0, Math.min(1, hpRatio)), 12);
    
    this.nameTagTexture.needsUpdate = true;
  }
}
