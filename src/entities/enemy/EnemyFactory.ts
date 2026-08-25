import * as THREE from 'three';
import { BaseEnemyController } from './BaseEnemyController';
import { MobController } from './MobController';
import { EliteController } from './EliteController';
import { BossController } from './BossController';

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
        if (npcType === 'world_boss' || npcType === 'raid_boss') {
            return new BossController(scene, npcId, npcType, npcName, maxHp, hp, skillsSystem);
        } else if (npcType === 'elite') {
            return new EliteController(scene, npcId, npcType, npcName, maxHp, hp);
        } else {
            return new MobController(scene, npcId, npcType, npcName, maxHp, hp);
        }
    }
}
