import * as THREE from 'three';
import { BaseEnemyController } from '../entities/enemy/BaseEnemyController';
import { EnemyFactory } from '../entities/enemy/EnemyFactory';
import { SkillsSystem } from './combat/SkillsSystem';
import { getState } from '../network/NetworkManager';

export class NPCManager {
  public static npcControllers = new Map<string, BaseEnemyController>();
  private static lastNpcsState: any = null;

  public static syncNPCs(scene: THREE.Scene, colliderMesh: THREE.Mesh, skillsSystem: SkillsSystem) {
    const npcsState = getState("npcs");
    if (!npcsState || npcsState === this.lastNpcsState) return;
    this.lastNpcsState = npcsState;

    const snapshotServerTs: number = (npcsState as any)._snapshotServerTs ?? 0;

    for (const id in npcsState) {
      if (id === '_snapshotServerTs') continue;
      const data = npcsState[id];
      let ctrl = this.npcControllers.get(id);
      if (!ctrl) {
        ctrl = EnemyFactory.create(scene, id, data.type, data.name, data.maxHp, data.hp, skillsSystem);
        ctrl.setEnvironment(colliderMesh);
        this.npcControllers.set(id, ctrl);
      }
      ctrl.hp = data.hp;
      ctrl.maxHp = data.maxHp;
      if (typeof data.level === 'number') {
        ctrl.level = data.level;
      }
      ctrl.speed = data.speed;
      if (data.fsm && typeof data.fsm.state === 'number') {
        ctrl.fsmState = data.fsm.state;
      }
      ctrl.interpolator.addSnapshot(data.x, data.y, data.z, data.rot, data.action, snapshotServerTs);
    }

    for (const id of this.npcControllers.keys()) {
      if (id === '_snapshotServerTs') continue;
      if (!npcsState[id]) {
        const ctrl = this.npcControllers.get(id);
        if (ctrl) {
          scene.remove(ctrl.playerGroup);
          if (ctrl.nameTagSprite) {
            ctrl.playerGroup.remove(ctrl.nameTagSprite);
          }
          ctrl.dispose();
        }
        this.npcControllers.delete(id);
      }
    }
  }

  public static update(delta: number): BaseEnemyController | null {
    let mainBoss: BaseEnemyController | null = null;
    for (const ctrl of this.npcControllers.values()) {
      ctrl.update(delta);
      if (ctrl.hp > 0) {
        if (ctrl.npcType === 'world_boss') {
          mainBoss = ctrl;
        } else if (ctrl.npcType === 'raid_boss' && (!mainBoss || mainBoss.npcType !== 'world_boss')) {
          mainBoss = ctrl;
        }
      }
    }
    return mainBoss;
  }
}
