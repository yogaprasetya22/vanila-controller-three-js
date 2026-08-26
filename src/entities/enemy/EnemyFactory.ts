import * as THREE from 'three';
import { BaseEnemyController } from './BaseEnemyController';
import { BossController } from './BossController';
import { MeleeAttackBehavior } from './behaviors/MeleeAttackBehavior';
import { RangedAttackBehavior } from './behaviors/RangedAttackBehavior';
import { ENEMY_PRESETS } from './EnemyConfig';

export class EnemyFactory {
    public static create(
        scene: THREE.Scene,
        npcId: string,
        npcType: string,
        npcName: string,
        maxHp: number,
        hp: number,
        skillsSystem: any
    ): BaseEnemyController {
        let ctrl: BaseEnemyController;
        const preset = ENEMY_PRESETS[npcType] || ENEMY_PRESETS.mob;

        if (npcType === 'world_boss' || npcType === 'raid_boss') {
            ctrl = new BossController(scene, npcId, npcType, npcName, maxHp, hp, skillsSystem);
        } else {
            ctrl = new BaseEnemyController(scene, npcId, npcType, npcName, maxHp, hp);
        }

        // Dynamic behavior injection based on data configuration (Composition-based)
        const isRanged = npcName.includes('Mage') || npcName.includes('Ranged') || preset.behaviorType === 'RANGED';

        if (isRanged) {
            ctrl.attackBehavior = new RangedAttackBehavior(15.0);
        } else {
            const range = (npcType === 'raid_boss' || npcType === 'world_boss') ? 3.0 : 2.0;
            ctrl.attackBehavior = new MeleeAttackBehavior(range);
        }
        ctrl.attackBehavior.init(ctrl);

        return ctrl;
    }
}
