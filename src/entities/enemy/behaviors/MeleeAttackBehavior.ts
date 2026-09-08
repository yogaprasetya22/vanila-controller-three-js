import type { IAttackBehavior } from './IAttackBehavior';
import type { BaseEnemyController } from '../BaseEnemyController';
import { myPlayer } from '../../../network/NetworkManager.ts';
import { damageHUDBatcher } from '../../../graphics/effects/DamageHUDBatcher.ts';
import { TargetingManager } from '../../../systems/targeting/TargetingManager';
import { CHARACTER_CONFIG } from '../../player/PlayerConfig';

export class MeleeAttackBehavior implements IAttackBehavior {
  public attackRange: number;
  private owner!: BaseEnemyController;
  private hasDamagedThisLoop = false;

  constructor(attackRange: number = 2.0) {
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
          const isRaid = this.owner.npcType === 'raid_boss';
          const baseDamage = isRaid ? 15 : 8;
          const rangeSq = this.attackRange * this.attackRange;

          let closestPlayer: any = null;
          let closestDistSq = rangeSq;

          for (const playerEntity of players) {
            const distSq = playerEntity.position.distanceToSquared(this.owner.playerGroup.position);
            if (distSq < closestDistSq) {
              closestDistSq = distSq;
              closestPlayer = playerEntity;
            }
          }

          if (closestPlayer && closestPlayer.id === localId) {
            damageHUDBatcher.spawn({
              skill: 'normal',
              value: baseDamage,
              position: [closestPlayer.position.x, closestPlayer.position.y + 1, closestPlayer.position.z],
              isCrit: Math.random() > 0.9,
              isMagic: false,
              forceShow: true
            });
            const maxHp = CHARACTER_CONFIG.combat.maxHp || 5000;
            const localHp = myPlayer().getState('hp') ?? maxHp;
            const nextHp = Math.max(0, localHp - baseDamage);
            myPlayer().setState('hp', nextHp === 0 ? maxHp : nextHp);
          }
        }
      }
    }
  }
}
