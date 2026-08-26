import * as THREE from 'three';
import type { ISkill, CastContext } from '../ISkill';
import { spawnDoubleShotFX } from '../../graphics/effects/DoubleShotFX';
import { SKILL_CONFIGS } from '../SkillConfig';

export class DoubleShotSkill implements ISkill {
  public id = 'Digit2';
  public name = 'Double Shot';
  public cooldown = 3.5;

  public cast(caster: any, context: CastContext): boolean {
    const target = context.target;
    const forward = context.forward;
    const playerPos = caster.position;

    const fx = playerPos.x;
    const fy = playerPos.y + 1.1;
    const fz = playerPos.z;
    let tx = playerPos.x + forward.x * 15.0;
    let ty = playerPos.y;
    let tz = playerPos.z + forward.z * 15.0;
    if (target) {
      tx = target.position.x;
      ty = target.position.y;
      tz = target.position.z;
    }
    spawnDoubleShotFX(context.scene, fx, fy, fz, tx, ty, tz, false, 0);
    return true;
  }

  public onImpact(caster: any, target: any, impactPoint: THREE.Vector3): void {
    // Optional impact logic
  }
}
