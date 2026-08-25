import { BaseEnemyController } from './BaseEnemyController';
import * as THREE from 'three';

export class MobController extends BaseEnemyController {
    constructor(scene: THREE.Scene, npcId: string, npcType: string, npcName: string, maxHp: number, hp: number) {
        super(scene, npcId, npcType, npcName, maxHp, hp);
    }
}
