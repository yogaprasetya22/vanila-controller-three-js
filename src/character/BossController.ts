import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
// @ts-ignore
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { getTerrainHeight } from '../simulation/constants';
import { isHost, setState, getState, RPC } from 'playroomkit';

const gltfLoader = new GLTFLoader();
gltfLoader.setMeshoptDecoder(MeshoptDecoder);

const _dirVec = new THREE.Vector3();

export class BossController {
    public playerGroup: THREE.Group;
    public playerMesh: THREE.Object3D | null = null;
    private scene: THREE.Scene;

    public position = new THREE.Vector3(0, 0, 0);
    public speed = 3.5;
    public hp = 10000000;
    public maxHp = 10000000;

    private mixer: THREE.AnimationMixer | null = null;
    private actions: { [key: string]: THREE.AnimationAction } = {};
    private currentActionName = "";

    private placeholderMesh: THREE.Mesh;
    private timeSinceLastSync = 0;
    private targetPos = new THREE.Vector3(0, 0, 0);
    private targetRot = 0;
    private targetAction = "idle";

    // Nametag Billboard Properties
    private nameTagCanvas: HTMLCanvasElement | null = null;
    private nameTagTexture: THREE.CanvasTexture | null = null;
    public nameTagSprite: THREE.Sprite | null = null;

    // Collision Properties
    private environmentMesh: THREE.Mesh | null = null;
    private tempSegment = new THREE.Line3();
    private tempBox = new THREE.Box3();
    private tempTriPoint = new THREE.Vector3();
    private capsulePoint = new THREE.Vector3();
    private tempVector2 = new THREE.Vector3();
    private radius = 1.4; // Giant Boss has larger collision radius
    private height = 5.0;

    constructor(scene: THREE.Scene, skillsSystem: any) {
        this.scene = scene;
        this.playerGroup = new THREE.Group();

        // Spawn at center-back of the map
        this.position.set(0, getTerrainHeight(0, -15), -15);
        this.playerGroup.position.copy(this.position);
        this.scene.add(this.playerGroup);

        // Placeholder red cube while loading
        const geo = new THREE.BoxGeometry(2, 4, 2);
        const mat = new THREE.MeshLambertMaterial({ color: 0xff0000 });
        this.placeholderMesh = new THREE.Mesh(geo, mat);
        this.placeholderMesh.position.y = 2.0;
        this.playerGroup.add(this.placeholderMesh);

        this.loadModel();
    }

    public setEnvironment(mesh: THREE.Mesh) {
        this.environmentMesh = mesh;
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
                        "/character/animation/Rig_Medium_CombatRanged.glb",
                    ),
                    gltfLoader.loadAsync(
                        "/character/animation/Rig_Medium_MovementBasic.glb",
                    ),
                ]);

            this.playerGroup.remove(this.placeholderMesh);
            this.placeholderMesh.geometry.dispose();
            (this.placeholderMesh.material as THREE.Material).dispose();

            this.playerMesh = SkeletonUtils.clone(charGLTF.scene);
            this.playerMesh.scale.setScalar(3.2); // Giant Boss!
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
                return allClips[0];
            };

            // Select matching animations (like player character controller)
            const idleClip = pickClip(["Ranged_Bow_Idle", "Idle"]);
            const walkClip = pickClip([
                "Running_HoldingBow",
                "Running_B",
                "Walk",
            ]);

            if (idleClip)
                this.actions["idle"] = this.mixer.clipAction(idleClip);
            if (walkClip)
                this.actions["walk"] = this.mixer.clipAction(walkClip);

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

        this.updateNameTag(1.0);
    }

    public updateNameTag(hpRatio: number) {
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

    public takeDamage(dmg: number) {
        if (!isHost()) return;
        this.hp = Math.max(0, this.hp - dmg);
        setState("bossHp", this.hp);
        if (this.hp <= 0) {
            // Respawn logic
            setTimeout(() => {
                this.hp = this.maxHp;
                setState("bossHp", this.hp);
                this.position.set(
                    (Math.random() - 0.5) * 40,
                    getTerrainHeight(0, 0),
                    (Math.random() - 0.5) * 40 - 15,
                );
                setState("bossPos", {
                    x: this.position.x,
                    y: this.position.y,
                    z: this.position.z,
                });
                this.playerGroup.position.copy(this.position);
            }, 8000);
        }
    }

    private resolveCollisions(delta: number) {
        if (
            !this.environmentMesh ||
            !this.environmentMesh.geometry.boundsTree
        ) {
            const terrainY = getTerrainHeight(this.position.x, this.position.z);
            this.position.y = terrainY;
            this.playerGroup.position.copy(this.position);
            return;
        }

        const bvh = this.environmentMesh.geometry.boundsTree;
        const capsuleStart = this.tempSegment.start;
        const capsuleEnd = this.tempSegment.end;

        for (let iter = 0; iter < 3; iter++) {
            capsuleStart
                .copy(this.position)
                .addScaledVector(new THREE.Vector3(0, 1, 0), this.radius);
            capsuleEnd
                .copy(this.position)
                .addScaledVector(
                    new THREE.Vector3(0, 1, 0),
                    this.height - this.radius,
                );

            this.tempBox.makeEmpty();
            this.tempBox.expandByPoint(capsuleStart);
            this.tempBox.expandByPoint(capsuleEnd);
            this.tempBox.min.subScalar(this.radius);
            this.tempBox.max.addScalar(this.radius);

            bvh.shapecast({
                intersectsBounds: (box) => box.intersectsBox(this.tempBox),
                intersectsTriangle: (tri) => {
                    const distance = tri.closestPointToSegment(
                        this.tempSegment,
                        this.tempTriPoint,
                        this.capsulePoint,
                    );
                    if (distance < this.radius) {
                        const depth = this.radius - distance;
                        const normal = this.tempVector2
                            .copy(this.capsulePoint)
                            .sub(this.tempTriPoint)
                            .normalize();
                        normal.y = 0; // lock to horizontal plane sliding to prevent vertical scaling glitches
                        if (normal.lengthSq() > 0.001) {
                            normal.normalize();
                            this.position.addScaledVector(normal, depth);
                        }
                    }
                },
            });
        }

        // Snap Y height to terrain
        this.position.y = getTerrainHeight(this.position.x, this.position.z);
        this.playerGroup.position.copy(this.position);
    }

    public update(delta: number, players: { player: any; controller: any }[]) {
        if (this.mixer) this.mixer.update(delta);

        if (isHost()) {
            if (this.hp <= 0) {
                this.playerGroup.visible = false;
                return;
            }
            this.playerGroup.visible = true;

            // ─── HOST AI & MOVEMENT ────────────────────────────────────────────────
            let nearestDist = Infinity;
            let nearestTarget: any = null;

            players.forEach(({ controller }) => {
                if (controller && controller.position) {
                    const d = this.position.distanceTo(controller.position);
                    if (d < nearestDist) {
                        nearestDist = d;
                        nearestTarget = controller;
                    }
                }
            });

            if (nearestTarget) {
                const targetPos = nearestTarget.position;
                const dir = _dirVec.subVectors(targetPos, this.position);
                dir.y = 0; // maintain height
                const dist = dir.length();

                // Rotate to look at player
                const angle = Math.atan2(dir.x, dir.z);
                if (this.playerMesh) {
                    this.playerMesh.rotation.y = angle;
                }

                if (dist > 4.0) {
                    dir.normalize();

                    // Walk towards player
                    this.position.addScaledVector(dir, this.speed * delta);

                    // Apply environment bounds collision resolution!
                    this.resolveCollisions(delta);

                    this.playAnimationState("walk");
                } else {
                    // Idle/Attack distance (Boss does not cast skills anymore per request)
                    this.playAnimationState("idle");
                    this.position.y = getTerrainHeight(
                        this.position.x,
                        this.position.z,
                    );
                    this.playerGroup.position.copy(this.position);
                }
            } else {
                this.playAnimationState("idle");
                this.position.y = getTerrainHeight(
                    this.position.x,
                    this.position.z,
                );
                this.playerGroup.position.copy(this.position);
            }

            // Broadcast state
            setState("bossPos", {
                x: this.position.x,
                y: this.position.y,
                z: this.position.z,
            });
            setState(
                "bossRot",
                this.playerMesh ? this.playerMesh.rotation.y : 0,
            );
            setState("bossAction", this.currentActionName);
            setState("bossHp", this.hp);
        } else {
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
        }

        // Render/update billboard nametag health
        this.updateNameTag(this.hp / this.maxHp);
    }
}
