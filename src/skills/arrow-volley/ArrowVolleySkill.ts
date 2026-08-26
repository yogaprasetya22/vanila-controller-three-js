import * as THREE from 'three';
import type { ISkill, CastContext } from '../ISkill';
import { spawnArrowVolleyFX } from '../../graphics/effects/ArrowVolleyFX';
import { getTerrainHeight } from '../../simulation/constants';
import { SKILL_CONFIGS } from '../SkillConfig';

export class ArrowVolleySkill implements ISkill {
  public id = 'Digit1';
  public name = 'Arrow Volley';
  public cooldown = 6.0;

  public cast(caster: any, context: CastContext): boolean {
    const config = SKILL_CONFIGS[this.id];
    const target = context.target;
    const forward = context.forward;
    const playerPos = caster.position;

    let tx = playerPos.x + forward.x * 6.0; // forwardOffset from config
    let tz = playerPos.z + forward.z * 6.0;
    if (target) {
      tx = target.position.x;
      tz = target.position.z;
    }
    const ty = getTerrainHeight(tx, tz);
    spawnArrowVolleyFX(context.scene, tx, tz, ty, config.radius, 0);
    return true;
  }

  public onImpact(caster: any, target: any, impactPoint: THREE.Vector3): void {
    // Optional additional impact effects
  }
}
