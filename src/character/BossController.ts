import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
// @ts-ignore
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { getTerrainHeight } from '../simulation/constants';
import { isHost, setState, getState, RPC, send, getNPCConfig, myPlayer, onBossSkill } from '../network/NetworkManager.ts';
import { damageHUDBatcher } from '../graphics/effects/DamageHUDBatcher.ts';
import { BossGroundSlamFX } from '../graphics/effects/BossGroundSlamFX.ts';
import { spawnShieldBashFX } from '../graphics/effects/ShieldBashFX.ts';
import { spawnDoubleShotFX } from '../graphics/effects/DoubleShotFX.ts';
import { spawnLightningFX } from '../graphics/effects/LightningFX.ts';

const gltfLoader = new GLTFLoader();
gltfLoader.setMeshoptDecoder(MeshoptDecoder);

// Pre-allocated objects to prevent garbage collection overhead in the update loop
const _tempV1 = new THREE.Vector3();
const _tempColor = new THREE.Color();
const _blackColor = new THREE.Color(0, 0, 0);
const _lightningPoints = [new THREE.Vector3(), new THREE.Vector3()];

export class BossController {
    public playerGroup: THREE.Group;
    public playerMesh: THREE.Object3D | null = null;
    private scene: THREE.Scene;

    public position = new THREE.Vector3(0, 0, 0);
    public speed = 0; // Synced dynamically from Go server
    public hp = 0;    // Synced dynamically from Go server
    public maxHp = 0; // Synced dynamically from Go server

    private mixer: THREE.AnimationMixer | null = null;
    private actions: { [key: string]: THREE.AnimationAction } = {};
    private currentActionName = "";

    private placeholderMesh: THREE.Mesh;
    private timeSinceLastSync = 0;
    private targetPos = new THREE.Vector3(0, 0, 0);
    private targetRot = 0;
    private targetAction = "idle";
    public lastDamageTime = 0;
    private hitTimeout: any = null;
    private lastHitAnimTime = 0;
    private originalEmissiveColors = new Map<THREE.Material, THREE.Color>();
    private flashEndTime = 0;
    private lastDamageCycle = -1;
    private hasDamagedThisLoop = false;

    public groundSlamFX: BossGroundSlamFX;
    private playersRef: { player: any; controller: any }[] = [];

    // Nametag Billboard Properties
    private nameTagCanvas: HTMLCanvasElement | null = null;
    private nameTagTexture: THREE.CanvasTexture | null = null;
    public nameTagSprite: THREE.Sprite | null = null;
    private lastHpRatio = -1;

    constructor(scene: THREE.Scene, skillsSystem: any) {
        this.scene = scene;
        this.playerGroup = new THREE.Group();
        this.groundSlamFX = new BossGroundSlamFX(scene);

        // Apply authoritative server settings if available
        const npcCfg = getNPCConfig();
        if (npcCfg) {
            this.maxHp = npcCfg.bossMaxHp;
            this.hp = npcCfg.bossMaxHp;
            this.speed = npcCfg.bossSpeed;
            this.position.set(npcCfg.bossX, getTerrainHeight(npcCfg.bossX, npcCfg.bossZ), npcCfg.bossZ);
        } else {
            this.position.set(0, getTerrainHeight(0, -15), -15);
        }
        this.playerGroup.position.copy(this.position);
        this.scene.add(this.playerGroup);

        // Placeholder red cube while loading
        const geo = new THREE.BoxGeometry(2, 4, 2);
        const mat = new THREE.MeshLambertMaterial({ color: 0xff0000 });
        this.placeholderMesh = new THREE.Mesh(geo, mat);
        this.placeholderMesh.position.y = 2.0;
        this.playerGroup.add(this.placeholderMesh);

        // Listen for server-triggered boss skills (ground slam telegraph)
        onBossSkill((data: any) => {
            let shapeMode = 0;
            let outlineOnly = false;
            let rotationY = 0;
            let spawnX = data.x;
            let spawnZ = data.z;
            let colorHex = 0xff2200; // Default Red for groundSlam

            // Find current target if needed for the skill configurations
            let targetX = data.tx;
            let targetZ = data.tz;
            if (data.skill !== "groundSlam") {
                let nearest = null as any;
                let minD = Infinity;
                for (const p of this.playersRef) {
                    const px = p.controller.playerGroup.position.x;
                    const pz = p.controller.playerGroup.position.z;
                    const d = (px - data.tx) ** 2 + (pz - data.tz) ** 2;
                    if (d < minD) { minD = d; nearest = p; }
                }
                if (nearest) {
                    targetX = nearest.controller.playerGroup.position.x;
                    targetZ = nearest.controller.playerGroup.position.z;
                }
            }

            if (data.skill === "shieldBash" || data.skill === "doubleShot") {
                const dx = targetX - data.x;
                const dz = targetZ - data.z;
                const len = Math.sqrt(dx * dx + dz * dz);
                if (len > 0.001) {
                    const dirX = dx / len;
                    const dirZ = dz / len;
                    rotationY = Math.atan2(dx, dz);
                    // Offset center forward by radius so the back edge starts at the boss's feet
                    spawnX = data.x + dirX * data.radius;
                    spawnZ = data.z + dirZ * data.radius;
                }
            }

            if (data.skill === "shieldBash") {
                shapeMode = 1; // Cone
                colorHex = 0xd94b14; // Poison Orange/Brown
            } else if (data.skill === "doubleShot") {
                shapeMode = 2; // Line
                outlineOnly = true;
                colorHex = 0xffcc00; // Gold Yellow
            } else if (data.skill === "lightning") {
                shapeMode = 3; // Ring
                outlineOnly = true;
                colorHex = 0x00f0ff; // Electric Cyan
                spawnX = targetX;
                spawnZ = targetZ;
            }

            const onBoom = () => {
                const bx = this.playerGroup.position.x;
                const bz = this.playerGroup.position.z;
                const by = this.playerGroup.position.y;
                const handY = by + 4; // boss scale 2.8x, hand height ~4 units

                // O(1) lookup of local player controller
                const local = this.playersRef.find(p => p.player.id === myPlayer().id);
                if (!local) return;

                const localCtrl = local.controller;
                const px = localCtrl.playerGroup.position.x;
                const pz = localCtrl.playerGroup.position.z;

                // Check if local player is hit using our precise CPU SDF helper
                const isHit = this.checkPlayerInArea(localCtrl, spawnX, spawnZ, data.radius, shapeMode, rotationY);

                if (data.skill === "groundSlam") {
                    if (isHit) {
                        this.applyDamage(localCtrl, 35, 'bossSlam');
                    }
                } else if (data.skill === "shieldBash") {
                    // Resolve VFX target coordinates dynamically based on Hit vs Miss
                    const vfxTargetX = isHit ? px : targetX;
                    const vfxTargetZ = isHit ? pz : targetZ;
                    spawnShieldBashFX(this.scene, bx, handY, bz, vfxTargetX, 0, vfxTargetZ, 0, 2.5);
                    if (isHit) {
                        this.applyDamage(localCtrl, 30, 'bossShieldBash');
                    }
                } else if (data.skill === "doubleShot") {
                    const vfxTargetX = isHit ? px : targetX;
                    const vfxTargetZ = isHit ? pz : targetZ;
                    spawnDoubleShotFX(this.scene, bx, handY, bz, vfxTargetX, 0, vfxTargetZ, false, 0, 2.5);
                    if (isHit) {
                        this.applyDamage(localCtrl, 25, 'bossDoubleShot');
                    }
                } else if (data.skill === "lightning") {
                    const vfxTargetX = isHit ? px : targetX;
                    const vfxTargetZ = isHit ? pz : targetZ;
                    _lightningPoints[0].set(bx, handY, bz);
                    _lightningPoints[1].set(vfxTargetX, 1, vfxTargetZ);
                    spawnLightningFX(this.scene, _lightningPoints, 0, 2.5);
                    if (isHit) {
                        this.applyDamage(localCtrl, 40, 'bossLightning');
                    }
                }
            };

            this.groundSlamFX.spawn(spawnX, spawnZ, data.radius, data.telegraph, onBoom, shapeMode, outlineOnly, rotationY, colorHex);
        });

        this.loadModel();
    }

    public setEnvironment(mesh: THREE.Mesh) {
        // Server-authoritative collisions: no-op on client
    }

    private async loadModel() {
        try {
            const [charGLTF, generalAnim, advancedAnim, combatAnim, basicAnim] =
                await Promise.all([
                    gltfLoader.loadAsync("/character/characters/Barbarian.glb"),
                    gltfLoader.loadAsync(
                        "/character/animation/Rig_Medium_General.glb",
                    ),
                    gltfLoader.loadAsync(
                        "/character/animation/Rig_Medium_MovementAdvanced.glb",
                    ),
                    gltfLoader.loadAsync(
                        "/character/animation/Rig_Medium_CombatMelee.glb",
                    ),
                    gltfLoader.loadAsync(
                        "/character/animation/Rig_Medium_MovementBasic.glb",
                    ),
                ]);

            this.playerGroup.remove(this.placeholderMesh);
            this.placeholderMesh.geometry.dispose();
            (this.placeholderMesh.material as THREE.Material).dispose();

            this.playerMesh = SkeletonUtils.clone(charGLTF.scene);
            this.playerMesh.scale.setScalar(1.0); // Giant Boss!
            this.playerGroup.add(this.playerMesh);

            // Disable shadow costs, enable lighting
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

            // Select matching animations (like player character controller)
            const idleClip = pickClip(["Idle_A", "Idle_B", "Idle"]);
            const walkClip = pickClip(["Running_B", "Walk"]);
            const attackClip = pickClip(["Melee_Unarmed_Attack_Kick", "Melee_2H_Attack_Chop", "Melee_1H_Attack_Chop", "Melee_2H_Attack_Slice", "Melee_1H_Attack_Slice_Horizontal", "Melee_Unarmed_Attack_Punch_A"]);
            const hitClip = pickClip(["Hit_A", "Hit_B"]);

            if (idleClip)
                this.actions["idle"] = this.mixer.clipAction(idleClip);
            if (walkClip)
                this.actions["walk"] = this.mixer.clipAction(walkClip);
            if (attackClip)
                this.actions["attack"] = this.mixer.clipAction(attackClip);
            if (hitClip) {
                const act = this.mixer.clipAction(hitClip);
                act.setLoop(THREE.LoopOnce, 1);
                act.clampWhenFinished = true;
                this.actions["hit"] = act;
            }

            this.playAnimationState("idle");

            // Initialize HP Bar nametag billboard
            this.initNameTag("GIANT BOSS");
        } catch (err) {
            console.error("Failed to load Boss model/animations:", err);
        }
    }

    public initNameTag(username: string) {
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

        // Scale up billboard matching boss size
        this.nameTagSprite.scale.set(3.6, 0.9, 1);
        this.nameTagSprite.position.set(0, 7.5, 0); // Position high above giant head
        this.playerGroup.add(this.nameTagSprite);

        this.lastHpRatio = -1; // Reset to force initial render
        this.updateNameTag(1.0);
    }

    public updateNameTag(hpRatio: number) {
        // Prevent expensive 2D canvas drawing and GPU texture uploads if HP ratio hasn't changed
        if (Math.abs(hpRatio - this.lastHpRatio) < 0.001) return;
        this.lastHpRatio = hpRatio;

        if (!this.nameTagCanvas || !this.nameTagTexture) return;
        const ctx = this.nameTagCanvas.getContext("2d")!;
        ctx.clearRect(0, 0, 256, 64);

        // Draw Username
        ctx.font = "Bold 20px Arial";
        ctx.fillStyle = "#ff3333"; // Vibrant red for boss name
        ctx.textAlign = "center";
        ctx.shadowColor = "rgba(0, 0, 0, 0.9)";
        ctx.shadowBlur = 4;
        ctx.fillText("GIANT BOSS", 128, 26);

        // Draw HP Bar BG
        ctx.fillStyle = "rgba(20, 20, 20, 0.85)";
        ctx.fillRect(28, 38, 200, 12);

        // Draw HP Bar FG
        ctx.fillStyle = "#ef4444"; // Red HP bar for boss
        ctx.fillRect(28, 38, 200 * Math.max(0, Math.min(1, hpRatio)), 12);

        this.nameTagTexture.needsUpdate = true;
    }

    public playAnimationState(name: string) {
        if (this.currentActionName === name) return;
        const current = this.actions[this.currentActionName];
        const next = this.actions[name];
        if (next) {
            if (current) current.fadeOut(0.2);
            next.reset().fadeIn(0.2).play();
            this.currentActionName = name;
        }
    }

    public takeDamage(dmg: number, x = 0, y = 0, z = 0) {
        send({
            type: "boss_hit",
            value: dmg,
            x,
            y,
            z
        });
    }

    public flash(duration = 0.12, colorHex = 0xff3333) {
        if (!this.playerMesh) return;
        this.flashEndTime = performance.now() + duration * 1000;
        _tempColor.setHex(colorHex);

        this.playerMesh.traverse((child) => {
            if ((child as THREE.Mesh).isMesh) {
                const mesh = child as THREE.Mesh;
                const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
                materials.forEach(mat => {
                    const m = mat as THREE.MeshStandardMaterial;
                    if (mat) {
                        if (!this.originalEmissiveColors.has(m)) {
                            this.originalEmissiveColors.set(m, m.emissive ? m.emissive.clone() : new THREE.Color(0,0,0));
                        }
                        if (m.emissive) {
                            m.emissive.copy(_tempColor);
                            m.emissiveIntensity = 2.0;
                        }
                    }
                });
            }
        });
    }

    private updateFlash() {
        if (this.originalEmissiveColors.size > 0 && performance.now() > this.flashEndTime) {
            this.originalEmissiveColors.forEach((origColor, m) => {
                const mat = m as THREE.MeshStandardMaterial;
                if (mat.emissive) {
                    mat.emissive.copy(origColor);
                    mat.emissiveIntensity = 0.0;
                }
            });
            this.originalEmissiveColors.clear();
        }
    }

    public playHit() {
        const now = performance.now();
        if (now - this.lastHitAnimTime < 800) {
            return; // Cooldown to prevent hit spam jitter
        }
        this.lastHitAnimTime = now;

        const hit = this.actions["hit"];
        const current = this.actions[this.currentActionName];
        if (hit) {
            if (current) current.fadeOut(0.1);
            hit.reset().fadeIn(0.1).play();

            if (this.hitTimeout) clearTimeout(this.hitTimeout);
            this.hitTimeout = setTimeout(() => {
                if (this.hp > 0) {
                    hit.fadeOut(0.2);
                    const next = this.actions[this.currentActionName];
                    if (next) {
                        next.reset().fadeIn(0.2).play();
                    }
                }
            }, hit.getClip().duration * 1000);
        }
    }

    // ponytail: client-side AoE damage — matches existing melee pattern (server has no player HP).
    // Ceiling: if server adds player HP authority later, move this check server-side.
    private checkPlayerInArea(
        localCtrl: any,
        centerX: number,
        centerZ: number,
        radius: number,
        shapeMode: number,
        rotationY: number
    ): boolean {
        const px = localCtrl.playerGroup.position.x;
        const pz = localCtrl.playerGroup.position.z;
        const dx = px - centerX;
        const dz = pz - centerZ;
        const distSq = dx * dx + dz * dz;
        const radiusSq = radius * radius;

        // Bounding circle early-out (Zero calculation overhead for far away players)
        if (distSq >= radiusSq) return false;

        // Translate and rotate coordinates to Local space using inverse rotationY
        const cos = Math.cos(-rotationY);
        const sin = Math.sin(-rotationY);
        const rx = dx * cos - dz * sin;
        const rz = dx * sin + dz * cos;

        // Normalize coordinates relative to radius (SDF assumes local shape size is 1.0)
        const localX = rx / radius;
        const localZ = rz / radius;

        let d = 1.0;

        if (shapeMode === 0) {
            // Circle
            d = Math.sqrt(localX * localX + localZ * localZ) - 1.0;
        } else if (shapeMode === 1) {
            // Cone (Cleave 90 deg frontal)
            const len = Math.sqrt(localX * localX + localZ * localZ);
            const angle = Math.abs(Math.atan2(localX, localZ));
            d = Math.max(len - 1.0, angle - 0.785);
        } else if (shapeMode === 2) {
            // Line (laser)
            const dx_val = Math.abs(localX) - 0.18;
            const dy_val = Math.abs(localZ) - 1.0;
            d = Math.max(dx_val, dy_val);
        } else if (shapeMode === 3) {
            // Ring
            const len = Math.sqrt(localX * localX + localZ * localZ);
            d = Math.max(0.55 - len, len - 1.0);
        } else if (shapeMode === 4) {
            // Cross
            const len = Math.sqrt(localX * localX + localZ * localZ);
            const dx1 = Math.abs(localX) - 0.18;
            const dy1 = Math.abs(localZ) - 1.0;
            const d_v = Math.max(dx1, dy1);

            const dx2 = Math.abs(localZ) - 0.18;
            const dy2 = Math.abs(localX) - 1.0;
            const d_h = Math.max(dx2, dy2);

            d = Math.max(Math.min(d_v, d_h), len - 1.0);
        }

        return d <= 0.0;
    }

    private applyDamage(localCtrl: any, damage: number, skillName: string) {
        const px = localCtrl.playerGroup.position.x;
        const pz = localCtrl.playerGroup.position.z;
        damageHUDBatcher.spawn({
            skill: skillName,
            value: damage,
            position: [px, localCtrl.playerGroup.position.y + 1, pz],
            isCrit: Math.random() > 0.8,
            isMagic: false,
        });
        const localHp = myPlayer().getState('hp') ?? 100;
        const nextHp = Math.max(0, localHp - damage);
        myPlayer().setState('hp', nextHp === 0 ? 100 : nextHp);
    }

    public dispose() {
        if (this.hitTimeout) {
            clearTimeout(this.hitTimeout);
        }

        // Remove and dispose nametag sprite and material
        if (this.nameTagSprite) {
            this.playerGroup.remove(this.nameTagSprite);
            if (this.nameTagSprite.material) {
                this.nameTagSprite.material.dispose();
            }
        }
        if (this.nameTagTexture) {
            this.nameTagTexture.dispose();
        }

        // Dispose placeholder mesh
        if (this.placeholderMesh) {
            this.placeholderMesh.geometry.dispose();
            if (Array.isArray(this.placeholderMesh.material)) {
                this.placeholderMesh.material.forEach(m => m.dispose());
            } else {
                this.placeholderMesh.material.dispose();
            }
        }

        // Traverse and dispose playerMesh geometries/materials
        if (this.playerMesh) {
            this.playerMesh.traverse((child) => {
                if ((child as THREE.Mesh).isMesh) {
                    const mesh = child as THREE.Mesh;
                    mesh.geometry.dispose();
                    if (Array.isArray(mesh.material)) {
                        mesh.material.forEach(m => m.dispose());
                    } else {
                        mesh.material.dispose();
                    }
                }
            });
        }

        // Dispose ground slam FX
        if (this.groundSlamFX) {
            this.groundSlamFX.dispose();
        }

        // Remove from scene
        this.scene.remove(this.playerGroup);
    }

    public update(delta: number, players: { player: any; controller: any }[]) {
        if (this.mixer) this.mixer.update(delta);
        this.playersRef = players;
        this.groundSlamFX.update(delta);

        // Synchronize damage with kick animation impact (0.9333s total duration, impact around 0.4s to 0.6s)
        const attackAction = this.actions["attack"];
        if (attackAction && this.targetAction === "attack" && this.hp > 0) {
            const time = attackAction.time;
            const duration = 0.93333;
            const relativeTime = time % duration;

            // Reset the damage flag when animation resets to the beginning of the loop
            if (relativeTime < 0.2) {
                this.hasDamagedThisLoop = false;
            }

            if (relativeTime >= 0.4 && relativeTime <= 0.6) {
                if (!this.hasDamagedThisLoop) {
                    this.hasDamagedThisLoop = true;
                    players.forEach(p => {
                        if (p.player.id === myPlayer().id) {
                            const distSq = p.controller.playerGroup.position.distanceToSquared(this.playerGroup.position);
                            if (distSq < 20.25) { // 4.5 * 4.5
                                damageHUDBatcher.spawn({
                                    skill: 'boss',
                                    value: 20,
                                    position: [p.controller.playerGroup.position.x, p.controller.playerGroup.position.y + 1, p.controller.playerGroup.position.z],
                                    isCrit: Math.random() > 0.8,
                                    isMagic: false
                                });
                                const localHp = myPlayer().getState('hp') ?? 100;
                                const nextHp = Math.max(0, localHp - 20);
                                myPlayer().setState('hp', nextHp === 0 ? 100 : nextHp);
                            }
                        }
                    });
                }
            }
        }

        // ─── CLIENT INTERPOLATION ──────────────────────────────────────────────
        this.timeSinceLastSync += delta;
        if (this.timeSinceLastSync >= 0.05) {
            this.timeSinceLastSync = 0;

            const pos = getState("bossPos");
            if (pos) {
                this.targetPos.set(pos.x, pos.y, pos.z);
            }

            const rot = getState("bossRot");
            if (rot !== undefined) {
                this.targetRot = rot;
            }

            const action = getState("bossAction");
            if (action) {
                this.targetAction = action;
            }

            const syncedHp = getState("bossHp");
            if (syncedHp !== undefined) {
                this.hp = syncedHp;
            }
        }

        if (this.hp <= 0) {
            this.playerGroup.visible = false;
            return;
        }
        this.playerGroup.visible = true;

        // Smoothly interpolate towards cached values
        this.position.lerp(this.targetPos, 0.2);
        this.playerGroup.position.copy(this.position);

        if (this.playerMesh) {
            let diff = this.targetRot - this.playerMesh.rotation.y;
            diff = Math.atan2(Math.sin(diff), Math.cos(diff));
            this.playerMesh.rotation.y += diff * 0.2;
        }

        this.playAnimationState(this.targetAction);

        // Render/update billboard nametag health
        this.updateNameTag(this.hp / this.maxHp);

        // Process flashing color updates
        this.updateFlash();
    }
}

