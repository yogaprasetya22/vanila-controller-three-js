import type { IAttackBehavior } from './IAttackBehavior';
import type { BaseEnemyController } from '../BaseEnemyController';
import { myPlayer } from '../../../network/NetworkManager.ts';
import { damageHUDBatcher } from '../../../graphics/effects/DamageHUDBatcher.ts';
import { spawnDoubleShotFX } from '../../../graphics/effects/DoubleShotFX';
import { TargetingManager } from '../../../systems/targeting/TargetingManager';

export class RangedAttackBehavior implements IAttackBehavior {
  public attackRange: number;
  private owner!: BaseEnemyController;
  private hasDamagedThisLoop = false;

  constructor(attackRange: number = 15.0) {
    this.attackRange = attackRange;
  }

  public init(owner: BaseEnemyController): void {
    this.owner = owner;
  }

  public update(delta: number, target: any): void {
    if (this.owner.hp <= 0) return;

    const attackAction = this.owner.actions["attack"];
    if (attackAction && this.owner.targetAction === "attack") {
      const time = attackAction.time;
      const duration = attackAction.getClip().duration || 1.0;
      const relativeTime = time % duration;

      if (relativeTime < 0.2) {
        this.hasDamagedThisLoop = false;
      }

      if (relativeTime >= 0.4 && relativeTime <= 0.6) {
        if (!this.hasDamagedThisLoop) {
          this.hasDamagedThisLoop = true;

          const localId = myPlayer().id;
          const players = TargetingManager.getAllEntities().filter(e => e.type === 'player');
          const baseDamage = 12; // Ranged base damage
          const rangeSq = this.attackRange * this.attackRange;

          for (const playerEntity of players) {
            const distSq = playerEntity.position.distanceToSquared(this.owner.playerGroup.position);
            if (distSq < rangeSq) {
              const fx = this.owner.playerGroup.position.x;
              const fy = this.owner.playerGroup.position.y + 1.1;
              const fz = this.owner.playerGroup.position.z;
              const tx = playerEntity.position.x;
              const ty = playerEntity.position.y;
              const tz = playerEntity.position.z;
              
              // Spawns projectile from the enemy group position to the target player
              spawnDoubleShotFX(this.owner.playerGroup.parent as any, fx, fy, fz, tx, ty, tz, true, 0);

              if (playerEntity.id === localId) {
                damageHUDBatcher.spawn({
                  skill: 'normal',
                  value: baseDamage,
                  position: [playerEntity.position.x, playerEntity.position.y + 1, playerEntity.position.z],
                  isCrit: Math.random() > 0.9,
                  isMagic: true
                });
                const localHp = myPlayer().getState('hp') ?? 100;
                const nextHp = Math.max(0, localHp - baseDamage);
                myPlayer().setState('hp', nextHp === 0 ? 100 : nextHp);
              } else {
                damageHUDBatcher.spawn({
                  skill: 'normal',
                  value: baseDamage,
                  position: [playerEntity.position.x, playerEntity.position.y + 1, playerEntity.position.z],
                  isCrit: Math.random() > 0.9,
                  isMagic: true
                });
              }
            }
          }
        }
      }
    }
  }
}
