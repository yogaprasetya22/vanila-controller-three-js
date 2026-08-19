import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
// @ts-ignore
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { CHARACTER_CONFIG } from './character-config';
import { activeFX } from '../graphics/effects/FXCore';

export class CharacterController {
  // THREE.js elements
  public playerGroup: THREE.Group;
  public playerMesh: THREE.Object3D | null = null;
  private camera: THREE.PerspectiveCamera;
  private scene: THREE.Scene;
  private environmentMesh: THREE.Mesh | null = null;

  // Animation system
  private mixer: THREE.AnimationMixer | null = null;
  private actions: { [key: string]: THREE.AnimationAction } = {};
  private currentActionName = '';

  // Controller parameters
  public radius = 0.5;
  public height = 1.6;
  public velocity = new THREE.Vector3();
  public position = new THREE.Vector3(0, 5, 0);
  public isGrounded = false;

  // Movement parameters (Ecctrl inspired)
  public speed = CHARACTER_CONFIG.physics.speed;
  public sprintMultiplier = CHARACTER_CONFIG.physics.sprintMultiplier;
  public jumpForce = CHARACTER_CONFIG.physics.jumpForce;
  public gravity = CHARACTER_CONFIG.physics.gravity;

  // Camera Settings (Spring arm / Orbit style)
  public cameraOffset = new THREE.Vector3(0, 2.5, 5);
  private cameraTargetRotation = new THREE.Euler(0, 0, 0, 'YXZ');
  private mouseSensitivity = 0.002;
  private smoothedLookAt = new THREE.Vector3();

  // Dash Dodge parameters
  private isDodging = false;
  private dodgeTimeLeft = 0;
  private dodgeCooldownLeft = 0;
  private dodgeDirection = new THREE.Vector3();
  private lastTapTimes: { [key: string]: number } = { KeyW: 0, KeyA: 0, KeyS: 0, KeyD: 0 };
  private ghostSpawnTimer = 0;

  // Input states
  private keys: { [key: string]: boolean } = {
    KeyW: false,
    KeyA: false,
    KeyS: false,
    KeyD: false,
    Space: false,
    ShiftLeft: false,
  };

  // Temp variables for math to avoid garbage collection
  private tempSegment = new THREE.Line3();
  private tempVector = new THREE.Vector3();
  private tempVector2 = new THREE.Vector3();
  private tempBox = new THREE.Box3();
  private tempTriPoint = new THREE.Vector3();
  private capsulePoint = new THREE.Vector3();

  // Placeholder mesh (shown while loading GLTF assets)
  private placeholderMesh: THREE.Mesh;

  constructor(scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    this.scene = scene;
    this.camera = camera;

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
    this.initInputs();
    this.initMouseLook();

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

      if (['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)) {
        const now = performance.now();
        if (now - this.lastTapTimes[e.code] < 260) {
          this.triggerDodge(e.code);
        }
        this.lastTapTimes[e.code] = now;
      }

      if (e.code === 'KeyE') {
        this.triggerDodgeByKey();
      }

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
    // Lock pointer only on canvas click in Player Mode
    window.addEventListener('click', (e) => {
      const canvas = document.querySelector('canvas');
      if (this.enabled && e.target === canvas) {
        canvas?.requestPointerLock?.();
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
  }

  private async loadAssets() {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);

    try {
      // 1. Load character model, animations and weapons in parallel
      const [charGLTF, generalAnim, advancedAnim, combatAnim, basicAnim, flipAnim, bowGLTF, quiverGLTF] = await Promise.all([
        loader.loadAsync('/character/characters/Ranger.glb'),
        loader.loadAsync('/character/animation/Rig_Medium_General.glb'),
        loader.loadAsync('/character/animation/Rig_Medium_MovementAdvanced.glb'),
        loader.loadAsync('/character/animation/Rig_Medium_CombatRanged.glb'),
        loader.loadAsync('/character/animation/Rig_Medium_MovementBasic.glb'),
        loader.loadAsync('/character/animation/Running_Forward_Flip.glb'),
        loader.loadAsync('/character/weapons/bow_withString.glb'),
        loader.loadAsync('/character/weapons/quiver.glb')
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
      this.playerGroup.add(this.playerMesh);

      // Enable casting/receiving shadows and set hero layer for player meshes
      this.playerMesh.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
          child.layers.enable(1); // Enable hero lighting layer
        }
      });

      // 3. Attach Weapons to character bones (bow_withString -> hand_l, quiver -> spine)
      this.attachWeaponToBone(this.playerMesh, bowGLTF.scene, 'hand_l', {
        pos: [0.01, 0.15, 0.0],
        rot: [0.0, -0.112, 1.458],
        scale: [1.0, 1.0, 1.0]
      });

      this.attachWeaponToBone(this.playerMesh, quiverGLTF.scene, 'spine', {
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
        clip.tracks = clip.tracks.filter((track) => {
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
      const runClip = pickClip(["Running_HoldingRifle", "Running_HoldingBow"]);
      const jumpStartClip = pickClip(["Jump_Start"]);
      const jumpIdleClip = pickClip(["Jump_Idle"]);
      const jumpLandClip = pickClip(["Jump_Land"]);
      const doubleJumpClip = flipAnim.animations[0];

      // Automatically retarget/rename doubleJumpClip track names to match target bone names
      if (doubleJumpClip && allClips.length > 0) {
        let targetPrefix = "";
        const targetTrackSample = allClips[0].tracks.find(t => t.name.toLowerCase().includes('hips'));
        if (targetTrackSample) {
          const parts = targetTrackSample.name.split('.');
          const bonePath = parts[0];
          const hipsIndex = bonePath.toLowerCase().indexOf('hips');
          if (hipsIndex !== -1) {
            targetPrefix = bonePath.substring(0, hipsIndex);
          }
        }

        let sourcePrefix = "";
        const sourceTrackSample = doubleJumpClip.tracks.find(t => t.name.toLowerCase().includes('hips'));
        if (sourceTrackSample) {
          const parts = sourceTrackSample.name.split('.');
          const bonePath = parts[0];
          const hipsIndex = bonePath.toLowerCase().indexOf('hips');
          if (hipsIndex !== -1) {
            sourcePrefix = bonePath.substring(0, hipsIndex);
          }
        }

        if (sourcePrefix !== targetPrefix) {
          doubleJumpClip.tracks.forEach(track => {
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

      const attackClip = pickClip(["Ranged_Bow_Release"]);

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
        this.actions['attack'].setLoop(THREE.LoopOnce, 1);
        this.actions['attack'].clampWhenFinished = true;
        this.actions['attack'].timeScale = CHARACTER_CONFIG.combat.attackAnimScale; // Configured speed scale for 193 ASPD
      }

      // Dodge animations
      const dodgeBackwardClip = pickClip(["Dodge_Backward"]);
      const dodgeForwardClip = pickClip(["Dodge_Forward"]);
      const dodgeLeftClip = pickClip(["Dodge_Left"]);
      const dodgeRightClip = pickClip(["Dodge_Right"]);

      if (dodgeBackwardClip) {
        this.actions['dodge_backward'] = this.mixer.clipAction(dodgeBackwardClip);
        this.actions['dodge_backward'].setLoop(THREE.LoopOnce, 1);
        this.actions['dodge_backward'].clampWhenFinished = true;
      }
      if (dodgeForwardClip) {
        this.actions['dodge_forward'] = this.mixer.clipAction(dodgeForwardClip);
        this.actions['dodge_forward'].setLoop(THREE.LoopOnce, 1);
        this.actions['dodge_forward'].clampWhenFinished = true;
      }
      if (dodgeLeftClip) {
        this.actions['dodge_left'] = this.mixer.clipAction(dodgeLeftClip);
        this.actions['dodge_left'].setLoop(THREE.LoopOnce, 1);
        this.actions['dodge_left'].clampWhenFinished = true;
      }
      if (dodgeRightClip) {
        this.actions['dodge_right'] = this.mixer.clipAction(dodgeRightClip);
        this.actions['dodge_right'].setLoop(THREE.LoopOnce, 1);
        this.actions['dodge_right'].clampWhenFinished = true;
      }

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
  ) {
    const bone = this.findBone(characterRoot, handPattern);
    if (!bone) {
      console.warn(`Bone matching hand pattern: ${handPattern} not found on character.`);
      return;
    }

    const weaponClone = SkeletonUtils.clone(weaponScene) as THREE.Group;
    weaponClone.position.set(transform.pos[0], transform.pos[1], transform.pos[2]);
    weaponClone.rotation.set(transform.rot[0], transform.rot[1], transform.rot[2]);
    weaponClone.scale.set(transform.scale[0], transform.scale[1], transform.scale[2]);

    weaponClone.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        child.layers.enable(1); // Enable hero lighting layer for weapons
      }
    });

    bone.add(weaponClone);
  }

  private playAnimationState(name: string) {
    if (this.currentActionName === name) return;

    const currentAction = this.actions[this.currentActionName];
    const targetAction = this.actions[name];

    if (!targetAction) return;

    targetAction.reset();
    targetAction.play();

    if (currentAction) {
      currentAction.crossFadeTo(targetAction, 0.15, true);
    }

    this.currentActionName = name;
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

    // 1. Apply Gravity
    if (!this.isGrounded) {
      this.velocity.y += this.gravity * delta;
      this.airTime += delta;
    } else {
      this.airTime = 0;
      this.jumpCount = 0; // Reset jumps when touching ground
      if (this.velocity.y < 0) {
        this.velocity.y = -1;
      }
    }

    // 2. Handle Jumping (handled by keydown listener in onSpacePressed)

    // Tick down speed buff duration
    if (this.speedBuffDuration > 0) {
      this.speedBuffDuration -= delta;
      if (this.speedBuffDuration <= 0) {
        this.speedBuff = 1.0;
      }
    }

    // Tick down dodge cooldown
    if (this.dodgeCooldownLeft > 0) {
      this.dodgeCooldownLeft -= delta;
    }

    // 3. Calculate Movement direction relative to Camera Horizontal angle
    const camRotationY = this.cameraTargetRotation.y;
    const moveX = (this.keys.KeyD ? 1 : 0) - (this.keys.KeyA ? 1 : 0);
    const moveZ = (this.keys.KeyS ? 1 : 0) - (this.keys.KeyW ? 1 : 0);

    const inputDirection = this.tempVector.set(moveX, 0, moveZ).normalize();
    inputDirection.applyAxisAngle(new THREE.Vector3(0, 1, 0), camRotationY);

    if (this.isDodging) {
      this.dodgeTimeLeft -= delta;

      // Spawn afterimage ghosts
      this.ghostSpawnTimer -= delta;
      if (this.ghostSpawnTimer <= 0) {
        this.ghostSpawnTimer = 0.07;
        this.spawnDodgeGhost();
      }

      const dodgeSpeed = this.speed * 2.8;
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

    // 4. Move player position by velocity
    this.position.addScaledVector(this.velocity, delta);
    this.playerGroup.position.copy(this.position);

    // 5. Rotate Character Mesh towards movement direction
    if (this.isDodging) {
      if (this.playerMesh) {
        this.playerMesh.rotation.y = Math.atan2(this.dodgeDirection.x, this.dodgeDirection.z);
      }
    } else if (this.playerMesh && inputDirection.lengthSq() > 0.01) {
      const targetAngle = Math.atan2(inputDirection.x, inputDirection.z);
      const currentAngle = this.playerMesh.rotation.y;
      let diff = targetAngle - currentAngle;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      this.playerMesh.rotation.y += diff * 12 * delta;
    }

    // Record air-state for landing check
    const wasGrounded = this.isGrounded;
    const wasInAir = !wasGrounded && this.airTime > 0.15;

    // 6. Resolve Collisions using three-mesh-bvh
    this.resolveCollisions();

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
      // Basic attacks should be immediately overrideable by core movements (jump, walk, run)
      const isAttackLock = isLocked && this.currentActionName === 'attack';
      const isCoreLock = isLocked && !isAttackLock; // double_jump, jump_land

      if (isCoreLock) {
        // Keep playing core locked animations (double_jump or jump_land)
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
      } else if (!isLocked) {
        // Only return to idle if not currently locked by an attack animation
        this.playAnimationState('idle');
      }

      // Ensure mesh is always upright
      if (this.playerMesh) {
        this.playerMesh.rotation.x = 0;
      }

      this.mixer.update(delta);
    }

    // Tick attack cooldown down
    if (this.attackCooldown > 0) {
      this.attackCooldown -= delta;
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
    if (this.targets.length === 0) return null;
    let nearest: THREE.Object3D | null = null;
    let minDist = Infinity;
    const playerPos = this.position;

    this.targets.forEach((target) => {
      const targetPos = new THREE.Vector3();
      target.getWorldPosition(targetPos);
      const dist = playerPos.distanceTo(targetPos);
      // Auto aim range cap from config
      if (dist < CHARACTER_CONFIG.combat.autoAimRange && dist < minDist) {
        minDist = dist;
        nearest = target;
      }
    });

    return nearest;
  }

  public triggerAttack(): boolean {
    // Prevent basic attacks from cutting off the double jump (flip) animation while active
    if (this.currentActionName === 'double_jump' && this.animationLockTime > 0) {
      return false;
    }

    if (this.attackCooldown > 0 || !this.actions['attack']) return false;

    // Auto-Aim orientation adjustment (face the target dummy when firing)
    const target = this.getNearestTarget();
    if (target && this.playerMesh) {
      const targetPos = new THREE.Vector3();
      target.getWorldPosition(targetPos);
      const dx = targetPos.x - this.position.x;
      const dz = targetPos.z - this.position.z;
      this.playerMesh.rotation.y = Math.atan2(dx, dz);
    }

    this.playAnimationState('attack');
    this.animationLockTime = CHARACTER_CONFIG.combat.attackLockDuration; // Lock duration to let the fast attack animation play out fully
    this.attackCooldown = CHARACTER_CONFIG.combat.rateOfFire;    // Configured rate of fire
    return true;
  }

  public getForwardVector(): THREE.Vector3 {
    const forward = new THREE.Vector3();
    if (this.playerMesh) {
      this.playerMesh.getWorldDirection(forward);
    } else {
      forward.set(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.cameraTargetRotation.y);
    }
    return forward.normalize();
  }

  public getWeaponWorldPosition(handPattern: string, fallbackOffset = 1.1): THREE.Vector3 {
    const pos = new THREE.Vector3();
    const bone = this.playerMesh ? this.findBone(this.playerMesh, handPattern) : null;
    if (bone) {
      bone.getWorldPosition(pos);
    } else {
      pos.copy(this.position).add(new THREE.Vector3(0, fallbackOffset, 0));
    }
    return pos;
  }

  private resolveCollisions() {
    if (!this.environmentMesh || !this.environmentMesh.geometry.boundsTree) {
      if (this.position.y < 0) {
        this.position.y = 0;
        this.velocity.y = 0;
        this.isGrounded = true;
      }
      return;
    }

    const bvh = this.environmentMesh.geometry.boundsTree;

    const capsuleStart = this.tempSegment.start;
    const capsuleEnd = this.tempSegment.end;

    capsuleStart.copy(this.position).addScaledVector(new THREE.Vector3(0, 1, 0), this.radius);
    capsuleEnd.copy(this.position).addScaledVector(new THREE.Vector3(0, 1, 0), this.height - this.radius);

    this.tempBox.makeEmpty();
    this.tempBox.expandByPoint(capsuleStart);
    this.tempBox.expandByPoint(capsuleEnd);
    this.tempBox.min.subScalar(this.radius);
    this.tempBox.max.addScalar(this.radius);

    let groundedThisFrame = false;

    // Run collision resolution in 3 passes to handle corners and sliding smoothly
    for (let iter = 0; iter < 3; iter++) {
      capsuleStart.copy(this.position).addScaledVector(new THREE.Vector3(0, 1, 0), this.radius);
      capsuleEnd.copy(this.position).addScaledVector(new THREE.Vector3(0, 1, 0), this.height - this.radius);

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
            capsuleStart.copy(this.position).addScaledVector(new THREE.Vector3(0, 1, 0), this.radius);
            capsuleEnd.copy(this.position).addScaledVector(new THREE.Vector3(0, 1, 0), this.height - this.radius);

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
    const distance = 8.0; // Comfort follow range (same as spirit vale)

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

  private triggerDodgeByKey() {
    if (this.isDodging || !this.isGrounded || this.dodgeCooldownLeft > 0) return;

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
    this.dodgeCooldownLeft = CHARACTER_CONFIG.physics.dodgeCooldown || 1.0;

    if (this.playerMesh) {
      this.playerMesh.rotation.y = Math.atan2(this.dodgeDirection.x, this.dodgeDirection.z);
    }

    this.playAnimationState(animName);

    this.ghostSpawnTimer = 0.05;
    this.spawnDodgeGhost();
  }

  private triggerDodge(key: string) {
    if (this.isDodging || !this.isGrounded || this.dodgeCooldownLeft > 0) return;

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
    this.spawnDodgeGhost();
  }

  private spawnDodgeGhost() {
    if (!this.playerMesh) return;

    const ghost = SkeletonUtils.clone(this.playerMesh);
    ghost.position.copy(this.position);
    ghost.rotation.copy(this.playerMesh.rotation);

    const ghostMat = new THREE.MeshBasicMaterial({
      color: 0x00dfff,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    ghost.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        (child as THREE.Mesh).material = ghostMat;
      }
    });

    this.scene.add(ghost);

    let age = 0;
    const sceneRef = this.scene;
    activeFX.push({
      update(delta) {
        age += delta;
        const t = age / 0.35;
        if (t >= 1) {
          sceneRef.remove(ghost);
          ghostMat.dispose();
          return false;
        }
        ghostMat.opacity = 0.7 * (1.0 - t);
        return true;
      }
    });
  }
}
