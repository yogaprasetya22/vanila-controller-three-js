import type { BaseEnemyController } from '../BaseEnemyController';

export interface IAttackBehavior {
  attackRange: number;
  init(owner: BaseEnemyController): void;
  update(delta: number, target: any): void;
}
