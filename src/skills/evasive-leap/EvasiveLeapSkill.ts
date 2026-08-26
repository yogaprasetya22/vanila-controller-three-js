import * as THREE from 'three';
import type { ISkill, CastContext } from '../ISkill';
import { spawnEvasiveLeapFX } from '../../graphics/effects/EvasiveLeapFX';
import { getTerrainHeight } from '../../simulation/constants';
import { CHARACTER_CONFIG } from '../../entities/player/PlayerConfig';

export class EvasiveLeapSkill implements ISkill {
  public id = 'Digit3';
  public name = 'Evasive Leap';
  public cooldown = 9.0;

  public cast(caster: any, context: CastContext): boolean {
    const forward = context.forward;
    const playerPos = caster.position;
    const leapConf = CHARACTER_CONFIG.skills.evasiveLeap;

    const fx = playerPos.x;
    const fy = playerPos.y;
    const fz = playerPos.z;
    const tx = playerPos.x - forward.x * leapConf.forwardOffset;
    const tz = playerPos.z - forward.z * leapConf.forwardOffset;
    const ty = getTerrainHeight(tx, tz);

    if (caster) {
      if (typeof caster.applySpeedBuff === 'function') {
        caster.applySpeedBuff(leapConf.speedMultiplier, leapConf.activeDuration);
      }
      if (caster.velocity) {
        caster.velocity.set(-forward.x * 16.0, 7.5, -forward.z * 16.0);
      }
    }
    spawnEvasiveLeapFX(context.scene, fx, fy, fz, tx, ty, tz);
    return true;
  }

  public onImpact(caster: any, target: any, impactPoint: THREE.Vector3): void {
    // Optional impact logic
  }
}
