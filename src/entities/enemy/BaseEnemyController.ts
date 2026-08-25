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

const gltfLoader = new GLTFLoader();
gltfLoader.setMeshoptDecoder(MeshoptDecoder);

export abstract class BaseEnemyController {
    public playerGroup: THREE.Group;
    public playerMesh: THREE.Object3D | null = null;
    protected scene: THREE.Scene;
    public npcId: string;
    public npcType: string;
    public npcName: string;
    public maxHp: number;
    public hp: number;
    public speed = 0;

    public position = new THREE.Vector3();
    public targetRot = 0;
    public targetAction = 'idle';
    public interpolator = new MovementInterpolator();

    protected mixer: THREE.AnimationMixer | null = null;
    protected actions: { [key: string]: THREE.AnimationAction } = {};
    public currentActionName = '';

    protected placeholderMesh: THREE.Mesh;
    protected nameTagCanvas: HTMLCanvasElement | null = null;
    protected nameTagTexture: THREE.CanvasTexture | null = null;
    public nameTagSprite: THREE.Sprite | null = null;
    protected lastHpRatio = -1;

    // Flash/damage indicator attributes
    protected flashTime = 0;
    protected flashColor = new THREE.Color(1, 0, 0);

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
            get hp() { return self.hp; }
        });

        this.loadModel();
    }

    public setEnvironment(mesh: THREE.Mesh) {}

    private async loadModel() {
        const config = CHARACTER_CONFIG.npcs[this.npcType as 'mob' | 'raid_boss' | 'world_boss'] || CHARACTER_CONFIG.npcs.mob;
        const scaleVal = config.scale;

        try {
            const [charGLTF, generalAnim, advancedAnim, combatAnim, basicAnim] =
                await Promise.all([
                    gltfLoader.loadAsync(config.modelPath),
                    gltfLoader.loadAsync("/character/animation/Rig_Medium_General.glb"),
                    gltfLoader.loadAsync("/character/animation/Rig_Medium_MovementAdvanced.glb"),
                    gltfLoader.loadAsync("/character/animation/Rig_Medium_CombatMelee.glb"),
                    gltfLoader.loadAsync("/character/animation/Rig_Medium_MovementBasic.glb"),
                ]);

            if (this.placeholderMesh.parent) {
                this.playerGroup.remove(this.placeholderMesh);
                this.placeholderMesh.geometry.dispose();
                (this.placeholderMesh.material as THREE.Material).dispose();
            }

            this.playerMesh = SkeletonUtils.clone(charGLTF.scene);
            this.playerMesh.scale.setScalar(scaleVal);
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

            const idleClip = pickClip(["Idle_A", "Idle_B", "Idle"]);
            const walkClip = pickClip(["Running_B", "Walk"]);
            const attackClip = pickClip(["Melee_Unarmed_Attack_Kick", "Melee_2H_Attack_Chop", "Melee_1H_Attack_Chop", "Melee_2H_Attack_Slice", "Melee_1H_Attack_Slice_Horizontal", "Melee_Unarmed_Attack_Punch_A"]);
            const hitClip = pickClip(["Hit_A", "Hit_B"]);

            if (idleClip) this.actions["idle"] = this.mixer.clipAction(idleClip);
            if (walkClip) this.actions["walk"] = this.mixer.clipAction(walkClip);
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
        this.nameTagSprite.position.set(0, 4.0 * scaleVal + 1.5, 0);
        this.playerGroup.add(this.nameTagSprite);

        this.lastHpRatio = -1;
        this.updateNameTag(1.0);
    }

    public updateNameTag(hpRatio: number) {
        if (Math.abs(hpRatio - this.lastHpRatio) < 0.001) return;
        this.lastHpRatio = hpRatio;

        if (!this.nameTagCanvas || !this.nameTagTexture) return;
        const ctx = this.nameTagCanvas.getContext("2d")!;
        ctx.clearRect(0, 0, 256, 64);

        const config = CHARACTER_CONFIG.npcs[this.npcType as 'mob' | 'raid_boss' | 'world_boss'] || CHARACTER_CONFIG.npcs.mob;

        ctx.font = "Bold 16px Arial";
        ctx.fillStyle = config.hudColor;
        ctx.textAlign = "center";
        ctx.shadowColor = "rgba(0, 0, 0, 0.9)";
        ctx.shadowBlur = 4;
        ctx.fillText(this.npcName, 128, 26);

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
        if (this.mixer) this.mixer.update(delta);

        if (this.hp <= 0) {
            this.playerGroup.visible = false;
            return;
        }
        this.playerGroup.visible = true;

        let animTimeScale = 1.0;
        const state = this.interpolator.update(delta, this.position, this.playerMesh ? this.playerMesh.quaternion : new THREE.Quaternion());
        if (state) {
            this.playerGroup.position.copy(this.position);
            if (state.action === 'walk') {
                const baseWalkSpeed = 4.0;
                animTimeScale = Math.max(0.1, state.velocity / baseWalkSpeed);
            }
            this.playAnimationState(state.action, 0.15, animTimeScale);
        } else {
            // Snappy fallback
            this.playerGroup.position.copy(this.position);
            this.playAnimationState(this.targetAction);
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
