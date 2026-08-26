import * as THREE from 'three';
import type { ISkill, CastContext } from '../ISkill';
import { spawnDoubleShotFX } from '../../graphics/effects/DoubleShotFX';
import { SKILL_CONFIGS } from '../SkillConfig';
import { TargetingManager } from '../../systems/targeting/TargetingManager';
import { myPlayer } from '../../network/NetworkManager';

export class DoubleShotSkill implements ISkill {
  public id = 'Digit2';
  public name = 'Double Shot';
  public cooldown = 3.5;

  public cast(caster: any, context: CastContext): boolean {
    const config = SKILL_CONFIGS[this.id];
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

    // Apply damage to target twice (Double Shoot & x2 damage total)
    if (caster.playerId === myPlayer().id && target) {
      const allEntities = TargetingManager.getAllEntities();
      const targetEntity = allEntities.find(e => e.playerGroup === target);
      if (targetEntity && targetEntity.controller && targetEntity.hp > 0) {
        const dist = targetEntity.position.distanceTo(playerPos) - (targetEntity.radius || 0);
        if (dist <= config.range) {
          // First shot (damage multiplied by 2)
          targetEntity.controller.takeDamage(config.damage * 2, targetEntity.position.x, targetEntity.position.y, targetEntity.position.z);
          
          // Second shot after 150ms (damage multiplied by 2)
          setTimeout(() => {
            if (targetEntity && targetEntity.hp > 0) {
              targetEntity.controller.takeDamage(config.damage * 2, targetEntity.position.x, targetEntity.position.y, targetEntity.position.z);
            }
          }, 150);
        }
      }
    }

    return true;
  }

  public onImpact(caster: any, target: any, impactPoint: THREE.Vector3): void {
    // Optional impact logic
  }
}
