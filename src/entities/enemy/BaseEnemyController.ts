import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
// @ts-ignore
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { getTerrainHeight } from '../../simulation/constants';
import { myPlayer, send } from '../../network/NetworkManager.ts';
import { damageHUDBatcher } from '../../graphics/effects/DamageHUDBatcher.ts';
import { CHARACTER_CONFIG } from '../player/PlayerConfig';
import { TargetingManager } from '../../systems/targeting/TargetingManager';
import { MovementInterpolator } from '../../systems/netcode/MovementInterpolator';
import type { IAttackBehavior } from './behaviors/IAttackBehavior';

const gltfLoader = new GLTFLoader();
gltfLoader.setMeshoptDecoder(MeshoptDecoder);

export class BaseEnemyController {
    public playerGroup: THREE.Group;
    public playerMesh: THREE.Object3D | null = null;
    protected scene: THREE.Scene;
    public npcId: string;
    public npcType: string;
    public npcName: string;
    public maxHp: number;
    public hp: number;
    public level = 1;
    protected lastLevel = 0;
    public speed = 0;

    public position = new THREE.Vector3();
    public targetRot = 0;
    public targetAction = 'idle';
    public interpolator = new MovementInterpolator();
    public lodLevel: 'full' | 'name-only' | 'culled' = 'full';
    public attackBehavior?: IAttackBehavior;
    public rangeIndicator: THREE.LineLoop | null = null;
    public fsmState: number = 3; // Default FSMPatrol (3)

    // Terrain Clamping & Environment Raycasting
    protected environmentMesh: THREE.Mesh | null = null;
    protected lastX = 99999;
    protected lastZ = 99999;
    protected raycaster = new THREE.Raycaster();
    protected rayOrigin = new THREE.Vector3();
    protected rayDir = new THREE.Vector3(0, -1, 0);

    public setLODLevel(level: 'full' | 'name-only' | 'culled') {
        if (this.lodLevel === level) return;
        if (this.lodLevel === 'culled') {
            this.interpolator.reset();
        }
        this.lodLevel = level;

        switch (level) {
            case 'full':
                this.playerGroup.visible = this.hp > 0;
                if (this.playerMesh) this.playerMesh.visible = true;
                if (this.placeholderMesh) this.placeholderMesh.visible = !this.playerMesh;
                if (this.nameTagSprite) this.nameTagSprite.visible = true;
                if (this.rangeIndicator) this.rangeIndicator.visible = true;
                break;
            case 'name-only':
                this.playerGroup.visible = this.hp > 0;
                if (this.playerMesh) this.playerMesh.visible = false;
                if (this.placeholderMesh) this.placeholderMesh.visible = false;
                if (this.nameTagSprite) this.nameTagSprite.visible = true;
                if (this.rangeIndicator) this.rangeIndicator.visible = false;
                break;
            case 'culled':
                this.playerGroup.visible = false;
                break;
        }
    }

    protected mixer: THREE.AnimationMixer | null = null;
    public actions: { [key: string]: THREE.AnimationAction } = {};
    public currentActionName = '';

    protected placeholderMesh: THREE.Mesh;
    protected nameTagCanvas: HTMLCanvasElement | null = null;
    protected nameTagTexture: THREE.CanvasTexture | null = null;
    public nameTagSprite: THREE.Sprite | null = null;
    protected lastHpRatio = -1;

    // Flash/damage indicator attributes
    protected flashTime = 0;
    protected flashColor = new THREE.Color(1, 0, 0);
    protected hasDamagedThisLoop = false;

    // Hit batching variables
    private pendingDamage = 0;
    private lastHitPoint = new THREE.Vector3();
    private hitFlushTimeout: any = null;

    constructor(scene: THREE.Scene, npcId: string, npcType: string, npcName: string, maxHp: number, hp: number) {
        this.scene = scene;
        this.npcId = npcId;
        this.npcType = npcType;
        this.npcName = npcName;
        this.maxHp = maxHp;
        this.hp = hp;

        this.playerGroup = new THREE.Group();
        this.playerGroup.position.copy(this.position);
        this.scene.add(this.playerGroup);

        const config = CHARACTER_CONFIG.npcs[npcType as 'mob' | 'raid_boss' | 'world_boss'] || CHARACTER_CONFIG.npcs.mob;
        const scaleVal = config.scale;

        const geo = new THREE.BoxGeometry(2 * scaleVal, 4 * scaleVal, 2 * scaleVal);
        const mat = new THREE.MeshLambertMaterial({ color: config.hudColor });
        this.placeholderMesh = new THREE.Mesh(geo, mat);
        this.placeholderMesh.position.y = 2.0 * scaleVal;
        this.playerGroup.add(this.placeholderMesh);

        // Register dynamic enemy entity in Centralized TargetingManager
        const self = this;
        TargetingManager.registerEntity({
            id: this.npcId,
            type: 'enemy',
            position: this.playerGroup.position,
            playerGroup: this.playerGroup,
            radius: 0.6 * scaleVal,
            get hp() { return self.hp; },
            controller: self
        });

        // Add max attack/skill range indicator ring
        let maxRange = 2.5;
        let ringColor = 0x10b981; // Green for mob
        if (npcType === 'raid_boss') {
            maxRange = 8.0;
            ringColor = 0xf59e0b; // Orange for Raid Boss
        } else if (npcType === 'world_boss') {
            maxRange = 12.0;
            ringColor = 0xef4444; // Red for World Boss
        }

        const ringPoints = [];
        const segments = 64;
        for (let i = 0; i <= segments; i++) {
            const theta = (i / segments) * Math.PI * 2;
            ringPoints.push(new THREE.Vector3(Math.cos(theta) * maxRange, 0.05, Math.sin(theta) * maxRange));
        }
        const ringGeo = new THREE.BufferGeometry().setFromPoints(ringPoints);
        const ringMat = new THREE.LineBasicMaterial({ 
            color: ringColor, 
            transparent: true, 
            opacity: 0.45,
            linewidth: 1.5
        });
        this.rangeIndicator = new THREE.LineLoop(ringGeo, ringMat);
        this.playerGroup.add(this.rangeIndicator);

        this.loadModel();
    }

    public setEnvironment(mesh: THREE.Mesh) {
        this.environmentMesh = mesh;
    }

    private async loadModel() {
        const config = CHARACTER_CONFIG.npcs[this.npcType as 'mob' | 'raid_boss' | 'world_boss'] || CHARACTER_CONFIG.npcs.mob;
        const scaleVal = config.scale;

        const isRanged = this.npcName.includes('Mage') || this.npcName.includes('Ranged');
        let modelPath = config.modelPath;
        if (this.npcName.includes('Mage')) {
            modelPath = '/character/characters/Mage.glb';
        } else if (this.npcName.includes('Rogue')) {
            modelPath = '/character/characters/Skeleton_Rogue.glb';
        } else if (this.npcName.includes('Warrior')) {
            modelPath = '/character/characters/Skeleton_Warrior.glb';
        }

        const combatAnimPath = isRanged
            ? "/character/animation/Rig_Medium_CombatRanged.glb"
            : "/character/animation/Rig_Medium_CombatMelee.glb";

        try {
            const [charGLTF, generalAnim, advancedAnim, combatAnim, basicAnim] =
                await Promise.all([
                    gltfLoader.loadAsync(modelPath),
                    gltfLoader.loadAsync("/character/animation/Rig_Medium_General.glb"),
                    gltfLoader.loadAsync("/character/animation/Rig_Medium_MovementAdvanced.glb"),
                    gltfLoader.loadAsync(combatAnimPath),
                    gltfLoader.loadAsync("/character/animation/Rig_Medium_MovementBasic.glb"),
                ]);

            if (this.placeholderMesh.parent) {
                this.playerGroup.remove(this.placeholderMesh);
                this.placeholderMesh.geometry.dispose();
                (this.placeholderMesh.material as THREE.Material).dispose();
            }

            this.playerMesh = SkeletonUtils.clone(charGLTF.scene);
            this.playerMesh.scale.setScalar(scaleVal);
            this.playerMesh.visible = (this.lodLevel === 'full');
            this.playerGroup.add(this.playerMesh);

            this.playerMesh.traverse((child) => {
                if ((child as THREE.Mesh).isMesh) {
                    child.castShadow = false;
                    child.receiveShadow = false;
                    child.layers.enable(1);
                }
            });

            this.mixer = new THREE.AnimationMixer(this.playerMesh);

            const allClips = [
                ...generalAnim.animations,
                ...advancedAnim.animations,
                ...combatAnim.animations,
                ...basicAnim.animations,
            ];

            allClips.forEach((clip) => {
                clip.tracks = clip.tracks.filter((track: any) => {
                    const name = track.name;
                    const isRootTrack =
                        name.startsWith(".position") ||
                        name.startsWith(".rotation") ||
                        name.startsWith(".quaternion") ||
                        name.startsWith(".scale") ||
                        name.startsWith("Scene.") ||
                        name.startsWith("OSG_Scene.") ||
                        name.startsWith("RootNode.");
                    return !isRootTrack;
                });
            });

            const pickClip = (candidates: string[]) => {
                for (const name of candidates) {
                    const found = allClips.find((c) => c.name === name);
                    if (found) return found;
                }
                return null;
            };

            const idleClip = pickClip(isRanged ? ["Ranged_Bow_Idle", "Idle_A", "Idle_B", "Idle"] : ["Idle_A", "Idle_B", "Idle"]);
            const walkClip = pickClip(["Walking_C", "Walk"]);
            const runClip = pickClip(isRanged ? ["Running_HoldingBow", "Running_A", "Running_B", "Run"] : ["Running_A", "Running_B", "Run"]);
            const attackClip = pickClip(isRanged 
                ? ["Ranged_Bow_Release", "Ranged_Bow_Aiming_Idle", "Shoot", "Attack"] 
                : ["Melee_Unarmed_Attack_Kick", "Melee_2H_Attack_Chop", "Melee_1H_Attack_Chop", "Melee_2H_Attack_Slice", "Melee_1H_Attack_Slice_Horizontal", "Melee_Unarmed_Attack_Punch_A"]);
            const hitClip = pickClip(["Hit_A", "Hit_B"]);

            if (idleClip) this.actions["idle"] = this.mixer.clipAction(idleClip);
            if (walkClip) this.actions["walk"] = this.mixer.clipAction(walkClip);
            if (runClip) this.actions["run"] = this.mixer.clipAction(runClip);
            if (attackClip) this.actions["attack"] = this.mixer.clipAction(attackClip);
            if (hitClip) {
                const act = this.mixer.clipAction(hitClip);
                act.setLoop(THREE.LoopOnce, 1);
                act.clampWhenFinished = true;
                this.actions["hit"] = act;
            }

            this.playAnimationState("idle");
            this.initNameTag(this.npcName);
        } catch (err) {
            console.error("Failed to load NPC model/animations:", err);
        }
    }

    public playAnimationState(name: string, crossfadeDuration = 0.15, timeScale = 1.0) {
        if (name === 'attack' && timeScale > 2.0) {
            crossfadeDuration = Math.max(0.02, 0.15 / timeScale);
        }

        if (this.currentActionName === name) {
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
        targetAction.setEffectiveWeight(1.0);
        targetAction.play();

        if (currentAction) {
            currentAction.crossFadeTo(targetAction, crossfadeDuration, true);
        }

        this.currentActionName = name;
    }

    public initNameTag(username: string) {
        const config = CHARACTER_CONFIG.npcs[this.npcType as 'mob' | 'raid_boss' | 'world_boss'] || CHARACTER_CONFIG.npcs.mob;
        const scaleVal = config.scale;

        const canvas = document.createElement("canvas");
        canvas.width = 256;
        canvas.height = 64;

        this.nameTagCanvas = canvas;
        this.nameTagTexture = new THREE.CanvasTexture(canvas);

        const material = new THREE.SpriteMaterial({
            map: this.nameTagTexture,
            depthTest: true,
            depthWrite: false,
        });
        this.nameTagSprite = new THREE.Sprite(material);

        this.nameTagSprite.scale.set(3.6 * Math.min(1.5, scaleVal), 0.9 * Math.min(1.5, scaleVal), 1);
        this.nameTagSprite.position.set(0, 2.6 * scaleVal + 0.4, 0);
        this.playerGroup.add(this.nameTagSprite);

        this.lastHpRatio = -1;
        this.updateNameTag(1.0);
    }

    public updateNameTag(hpRatio: number) {
        if (this.lodLevel === 'culled') return;
        if (Math.abs(hpRatio - this.lastHpRatio) < 0.001 && this.level === this.lastLevel) return;
        this.lastHpRatio = hpRatio;
        this.lastLevel = this.level;

        if (!this.nameTagCanvas || !this.nameTagTexture) return;
        const ctx = this.nameTagCanvas.getContext("2d")!;
        ctx.clearRect(0, 0, 256, 64);

        const config = CHARACTER_CONFIG.npcs[this.npcType as 'mob' | 'raid_boss' | 'world_boss'] || CHARACTER_CONFIG.npcs.mob;

        ctx.font = "Bold 16px Arial";
        ctx.fillStyle = config.hudColor;
        ctx.textAlign = "center";
        ctx.shadowColor = "rgba(0, 0, 0, 0.9)";
        ctx.shadowBlur = 4;
        
        const displayName = `Lv. ${this.level} ${this.npcName}`;
        ctx.fillText(displayName, 128, 26);

        ctx.fillStyle = "rgba(20, 20, 20, 0.85)";
        ctx.fillRect(28, 38, 200, 12);

        ctx.fillStyle = config.hudColor;
        ctx.fillRect(28, 38, 200 * Math.max(0, hpRatio), 12);

        this.nameTagTexture.needsUpdate = true;
    }

    public playHit() {
        this.playAnimationState("hit", 0.05);
    }

    public flash(duration = 0.12, colorHex = 0xff3333) {
        this.flashTime = duration;
    }

    protected updateFlash() {
        if (this.flashTime <= 0) return;
        this.flashTime -= 0.016;
        const ratio = Math.max(0, this.flashTime / 0.15);
        this.playerGroup.traverse((child) => {
            if ((child as THREE.Mesh).isMesh) {
                const mesh = child as THREE.Mesh;
                if (Array.isArray(mesh.material)) {
                    mesh.material.forEach((mat) => {
                        if ('emissive' in mat) {
                            (mat as any).emissive.setRGB(ratio, 0, 0);
                        }
                    });
                } else if (mesh.material && 'emissive' in mesh.material) {
                    (mesh.material as any).emissive.setRGB(ratio, 0, 0);
                }
            }
        });
    }

    public update(delta: number) {
        if (this.lodLevel === 'full' && this.mixer) {
            this.mixer.update(delta);
        }

        if (this.hp <= 0) {
            this.playerGroup.visible = false;
            return;
        }

        if (this.lodLevel === 'culled') {
            this.playerGroup.visible = false;
            return;
        }
        this.playerGroup.visible = true;

        let animTimeScale = 1.0;
        const state = this.interpolator.update(delta, this.position, this.playerMesh ? this.playerMesh.quaternion : new THREE.Quaternion());
        
        // ── Smooth Client-Side Terrain Clamping (Always enforce, ignore server Y) ──
        const config = CHARACTER_CONFIG.npcs[this.npcType as 'mob' | 'raid_boss' | 'world_boss'] || CHARACTER_CONFIG.npcs.mob;
        const yOffset = config.scale * 0.1; // offset so feet sit flush

        let clampedY = getTerrainHeight(this.position.x, this.position.z);

        // Raycast geometry logic if environmentMesh exists
        if (this.environmentMesh) {
            this.rayOrigin.set(this.position.x, this.position.y + 12, this.position.z);
            this.raycaster.set(this.rayOrigin, this.rayDir);
            const hits = this.raycaster.intersectObject(this.environmentMesh);
            if (hits.length > 0) {
                clampedY = hits[0].point.y;
            }
        }

        // Snap Y position to prevent interpolator override from causing ground penetration.
        this.position.y = clampedY + yOffset;

        if (state) {
            this.playerGroup.position.copy(this.position);
            
            let animAction = state.action;
            if (animAction === 'walk') {
                // ChasePlayer (0) or RecalculatePath (2) -> run!
                if (this.fsmState === 0 || this.fsmState === 2) {
                    animAction = 'run';
                }
            }

            this.targetAction = animAction;
            if (this.lodLevel === 'full') {
                if (animAction === 'walk' || animAction === 'run') {
                    const baseWalkSpeed = 4.0;
                    animTimeScale = Math.max(0.1, state.velocity / baseWalkSpeed);
                }
                this.playAnimationState(animAction, 0.15, animTimeScale);
            }
        } else {
            // Snappy fallback
            this.playerGroup.position.copy(this.position);
            if (this.lodLevel === 'full') {
                this.playAnimationState(this.targetAction);
            }
        }

        if (this.attackBehavior && this.hp > 0) {
            this.attackBehavior.update(delta, null);
        }


        this.updateNameTag(this.hp / this.maxHp);
        this.updateFlash();
    }

    public takeDamage(dmg: number, x = 0, y = 0, z = 0) {
        this.pendingDamage += dmg;
        this.lastHitPoint.set(x, y, z);

        if (!this.hitFlushTimeout) {
            this.hitFlushTimeout = setTimeout(() => {
                send({
                    type: "boss_hit",
                    value: { npcId: this.npcId, dmg: this.pendingDamage },
                    x: this.lastHitPoint.x,
                    y: this.lastHitPoint.y,
                    z: this.lastHitPoint.z
                });
                this.pendingDamage = 0;
                this.hitFlushTimeout = null;
            }, 100); // 100ms window to batch multi-hits
        }
    }

    public dispose() {
        TargetingManager.unregisterEntity(this.npcId);
        if (this.nameTagSprite) {
            this.playerGroup.remove(this.nameTagSprite);
            if (this.nameTagSprite.material) {
                this.nameTagSprite.material.dispose();
            }
        }
        if (this.nameTagTexture) {
            this.nameTagTexture.dispose();
        }
        if (this.placeholderMesh) {
            this.playerGroup.remove(this.placeholderMesh);
            this.placeholderMesh.geometry.dispose();
            if (Array.isArray(this.placeholderMesh.material)) {
                this.placeholderMesh.material.forEach(m => m.dispose());
            } else {
                this.placeholderMesh.material.dispose();
            }
        }
        if (this.playerMesh) {
            this.playerMesh.traverse((child) => {
                const mesh = child as THREE.Mesh;
                if (mesh.isMesh) {
                    mesh.geometry.dispose();
                    if (Array.isArray(mesh.material)) {
                        mesh.material.forEach(m => m.dispose());
                    } else {
                        mesh.material.dispose();
                    }
                }
            });
            this.playerGroup.remove(this.playerMesh);
        }
        this.scene.remove(this.playerGroup);
    }
}
