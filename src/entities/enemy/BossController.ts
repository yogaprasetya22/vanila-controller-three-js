import * as THREE from 'three';
import { BaseEnemyController } from './BaseEnemyController';
import { myPlayer, onBossSkill } from '../../network/NetworkManager.ts';
import { damageHUDBatcher } from '../../graphics/effects/DamageHUDBatcher.ts';
import { BossGroundSlamFX } from '../../graphics/effects/BossGroundSlamFX.ts';
import { spawnShieldBashFX } from '../../graphics/effects/ShieldBashFX.ts';
import { spawnDoubleShotFX } from '../../graphics/effects/DoubleShotFX.ts';
import { spawnLightningFX } from '../../graphics/effects/LightningFX.ts';
import { TargetingManager } from '../../systems/targeting/TargetingManager';
import { CHARACTER_CONFIG } from '../player/PlayerConfig';

const _lightningPoints = [new THREE.Vector3(), new THREE.Vector3()];

export class BossController extends BaseEnemyController {
    public groundSlamFX: BossGroundSlamFX;
    private hitTimeout: any = null;

    constructor(scene: THREE.Scene, npcId: string, npcType: string, npcName: string, maxHp: number, hp: number, skillsSystem: any) {
        super(scene, npcId, npcType, npcName, maxHp, hp);
        
        this.groundSlamFX = new BossGroundSlamFX(scene);
        const config = CHARACTER_CONFIG.npcs[npcType as 'mob' | 'raid_boss' | 'world_boss'] || CHARACTER_CONFIG.npcs.mob;
        const scaleVal = config.scale;

        onBossSkill((data: any) => {
            if (data.npcId !== this.npcId) return;
            if (this.lodLevel !== 'full') return;

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
                const targetVec = new THREE.Vector3(data.tx, 0, data.tz);
                const nearestPlayer = TargetingManager.getNearestTarget(targetVec, 'player');
                if (nearestPlayer) {
                    targetX = nearestPlayer.position.x;
                    targetZ = nearestPlayer.position.z;
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
                const handY = by + 4 * scaleVal;

                const localId = myPlayer().id;
                const local = TargetingManager.getEntity(localId);
                if (!local) return;

                const px = local.position.x;
                const pz = local.position.z;

                // Loop over all active players to apply damage and spawn HUD
                const players = TargetingManager.getAllEntities().filter(e => e.type === 'player');
                let localHit = false;

                // Find out if local player is hit to configure VFX targets
                for (const playerEntity of players) {
                    const isHit = this.checkPlayerInArea(playerEntity, spawnX, spawnZ, data.radius, shapeMode, rotationY);
                    if (isHit && playerEntity.id === localId) {
                        localHit = true;
                    }
                }

                // Distance-based VFX throttling
                const distToLocal = local.position.distanceTo(new THREE.Vector3(targetX, local.position.y, targetZ));
                const shouldSpawnVFX = localHit || distToLocal < 35.0;

                // Spawn VFX
                if (data.skill === "shieldBash" && shouldSpawnVFX) {
                    const vfxTargetX = localHit ? px : targetX;
                    const vfxTargetZ = localHit ? pz : targetZ;
                    spawnShieldBashFX(this.scene, bx, handY, bz, vfxTargetX, 0, vfxTargetZ, 0, 2.5);
                } else if (data.skill === "doubleShot" && shouldSpawnVFX) {
                    const vfxTargetX = localHit ? px : targetX;
                    const vfxTargetZ = localHit ? pz : targetZ;
                    spawnDoubleShotFX(this.scene, bx, handY, bz, vfxTargetX, 0, vfxTargetZ, false, 0, 2.5);
                } else if (data.skill === "lightning" && shouldSpawnVFX) {
                    const vfxTargetX = localHit ? px : targetX;
                    const vfxTargetZ = localHit ? pz : targetZ;
                    _lightningPoints[0].set(bx, handY, bz);
                    _lightningPoints[1].set(vfxTargetX, 1, vfxTargetZ);
                    spawnLightningFX(this.scene, _lightningPoints, 0, 2.5);
                }
            };

            const fxRadius = data.skill === 'lightning' ? 4.0 : data.radius;
            this.groundSlamFX.spawn(spawnX, spawnZ, fxRadius, data.telegraph, onBoom, shapeMode, outlineOnly, rotationY, colorHex);
        });
    }

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

        // Scale radius by 0.8 to match the visual shader boundary (length(p) = 1.0 out of 1.25 mesh half-width)
        const visualRadius = radius * 0.8;
        const radiusSq = visualRadius * visualRadius;

        if (distSq >= radiusSq) return false;

        const cos = Math.cos(rotationY);
        const sin = Math.sin(rotationY);
        const rx = dx * cos - dz * sin;
        const rz = dx * sin + dz * cos;

        const localX = rx / visualRadius;
        const localZ = rz / visualRadius;

        let d = 1.0;

        if (shapeMode === 0) {
            d = Math.sqrt(localX * localX + localZ * localZ) - 1.0;
        } else if (shapeMode === 1) {
            const len = Math.sqrt(localX * localX + localZ * localZ);
            const angle = Math.abs(Math.atan2(localX, localZ));
            d = Math.max(len - 1.0, angle - 0.785);
        } else if (shapeMode === 2) {
            const dx_val = Math.abs(localX) - 0.18;
            const dy_val = Math.abs(localZ) - 1.0;
            d = Math.max(dx_val, dy_val);
        } else if (shapeMode === 3) {
            const len = Math.sqrt(localX * localX + localZ * localZ);
            d = Math.max(0.55 - len, len - 1.0);
        } else if (shapeMode === 4) {
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

    public override update(delta: number) {
        super.update(delta);
        this.groundSlamFX.update(delta);
    }

    public override dispose() {
        if (this.hitTimeout) {
            clearTimeout(this.hitTimeout);
        }
        this.groundSlamFX.dispose();
        super.dispose();
    }
}
