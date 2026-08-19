import * as THREE from "three";
import { canSpawnFX } from "./FXCore";

// 1. Centralized Imports of Modular Spawn Functions
import {
    spawnIronFortitudeAuraFX,
    spawnFrostNovaBurstFX,
    spawnDivineShieldFX,
} from "./SkillFX_Buffs";

import {
    spawnTauntFX,
    spawnShieldBashFX,
    spawnEvasiveLeapFX,
} from "./SkillFX_Combat";

import {
    spawnLightningFX,
} from "./SkillFX_Lightning";

import {
    spawnBasicAttackFX,
    spawnHealFX,
    spawnHighNoonFX,
    spawnSmokeBombFX,
    spawnFanFireFX,
    spawnShadowStepFX,
    spawnBackstabFX,
    spawnPoisonBladeFX,
    spawnIceShatterFX,
    spawnHolySanctuaryFX,
} from "./SkillFX_Misc";

import {
    spawnArrowVolleyFX,
    spawnFireballFX,
    spawnDoubleShotFX,
} from "./SkillFX_Projectiles";

import { getTerrainHeight } from "../../simulation/constants";

// 2. Pre-allocated Reusable Vectors to Prevent GC Spikes (Zero Runtime Allocation)
const tempVec1 = new THREE.Vector3();
const tempVec2 = new THREE.Vector3();

// Vector pool for variable-length arrays (e.g. Chain Lightning coordinates)
const vectorPool: THREE.Vector3[] = Array.from({ length: 64 }, () => new THREE.Vector3());
const lightningPathList: THREE.Vector3[] = [];

/**
 * High-performance Switch-Case Dispatcher representing Data-Oriented Design (DOD).
 * Reuses static module-level Vector3 variables to guarantee zero allocations.
 *
 * @param scene The active THREE.Scene
 * @param event The data packet carrying positions and configurations
 */
export function dispatchSkillFX(scene: THREE.Scene, event: { skill: string; [key: string]: any }): void {
    if (!canSpawnFX()) return;

    switch (event.skill) {
        case "arrowVolley": {
            const groundY = getTerrainHeight(event.x, event.z);
            spawnArrowVolleyFX(scene, event.x, event.z, groundY, 3.5, event.team);
            break;
        }

        case "chainLightning": {
            const arr: number[] = event.positions;
            if (arr) {
                lightningPathList.length = 0;
                let poolIdx = 0;
                for (let i = 0; i + 2 < arr.length && poolIdx < vectorPool.length; i += 3) {
                    const vec = vectorPool[poolIdx++];
                    vec.set(arr[i], arr[i + 1], arr[i + 2]);
                    lightningPathList.push(vec);
                }
                spawnLightningFX(scene, lightningPathList, event.team);
            }
            break;
        }

        case "ironFortitude":
            spawnIronFortitudeAuraFX(scene, event.x, event.y, event.z, event.team);
            break;

        case "taunt":
            spawnTauntFX(scene, event.x, event.y, event.z, event.tx, event.ty, event.tz, event.team);
            break;

        case "shieldBash":
            spawnShieldBashFX(scene, event.x, event.y, event.z, event.tx, event.ty, event.tz, event.team);
            break;

        case "doubleShot":
        case "turretShoot":
            spawnDoubleShotFX(
                scene,
                event.fx,
                event.fy,
                event.fz,
                event.tx,
                event.ty,
                event.tz,
                event.skill === "turretShoot",
                event.team,
            );
            break;

        case "evasiveLeap": {
            const fy = event.fy !== undefined ? event.fy : getTerrainHeight(event.fx, event.fz);
            const ty = event.ty !== undefined ? event.ty : getTerrainHeight(event.tx, event.tz);
            spawnEvasiveLeapFX(scene, event.fx, fy, event.fz, event.tx, ty, event.tz);
            break;
        }

        case "fireball":
            spawnFireballFX(scene, event.fx, event.fy, event.fz, event.tx, event.ty, event.tz, event.team);
            break;

        case "frostNova":
            spawnFrostNovaBurstFX(scene, event.x, event.y, event.z, event.team);
            break;

        case "basicAttack":
            spawnBasicAttackFX(scene, event.uType, event.fx, event.fy, event.fz, event.tx, event.ty, event.tz, event.team);
            break;

        case "basicHeal":
            tempVec1.set(event.fx, event.fy, event.fz);
            tempVec2.set(event.tx, event.ty, event.tz);
            spawnHealFX(scene, tempVec1, tempVec2, false);
            break;

        case "rejuvenation":
            tempVec1.set(event.fx, event.fy, event.fz);
            tempVec2.set(event.tx, event.ty, event.tz);
            spawnHealFX(scene, tempVec1, tempVec2, true);
            break;

        case "divineShield":
            tempVec1.set(event.tx, event.ty, event.tz);
            spawnDivineShieldFX(scene, tempVec1, event.team);
            break;

        case "holySanctuary":
            tempVec1.set(event.x, event.y, event.z);
            spawnHolySanctuaryFX(scene, tempVec1, event.team);
            break;

        case "highNoon":
            spawnHighNoonFX(scene, event.fx, event.fy, event.fz, event.tx, event.ty, event.tz, event.team);
            break;

        case "smokeBomb":
            spawnSmokeBombFX(scene, event.x, event.y, event.z, event.team);
            break;

        case "fanFire":
            spawnFanFireFX(scene, event.x, event.z, getTerrainHeight(event.x, event.z), 3.0, event.team);
            break;

        case "shadowStep":
            spawnShadowStepFX(scene, event.fx, event.fy, event.fz, event.tx, event.ty, event.tz, event.team);
            break;

        case "backstab":
            spawnBackstabFX(scene, event.fx, event.fy, event.fz, event.tx, event.ty, event.tz, event.team);
            break;

        case "poisonBlade":
            spawnPoisonBladeFX(scene, event.tx, event.ty, event.tz);
            break;

        case "iceShatter":
            spawnIceShatterFX(scene, event.x, event.y, event.z, event.team);
            break;
    }
}
