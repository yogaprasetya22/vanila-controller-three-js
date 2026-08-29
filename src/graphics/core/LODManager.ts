import * as THREE from 'three';
import { LocalPlayer } from '../../entities/player/LocalPlayer';
import { BaseEnemyController } from '../../entities/enemy/BaseEnemyController';
import { referencePosition } from './scene';
import { myPlayer } from '../../network/NetworkManager';

export class LODManager {
  private static lodSortTimer = 0;

  public static update(
    delta: number, 
    characterMode: 'player' | 'orbit', 
    character: LocalPlayer | null, 
    camera: THREE.Camera, 
    playersAndControllers: { player: any; controller: LocalPlayer }[], 
    npcControllers: Map<string, BaseEnemyController>
  ) {
    const refPos = (characterMode === 'player' && character) ? character.position : camera.position;
    referencePosition.copy(refPos);

    this.lodSortTimer += delta;
    if (this.lodSortTimer >= 0.25) {
      this.lodSortTimer = 0;

      const remotePlayers = playersAndControllers
        .filter(p => p.player.id !== myPlayer().id)
        .map(p => p.controller);
      const enemies = Array.from(npcControllers.values());
      const allEntities = [...remotePlayers, ...enemies];
      const totalEntities = allEntities.length;

      allEntities.forEach(e => {
        (e as any)._distToLocal = e.position.distanceTo(referencePosition);
      });

      let entitiesInside10m = 0;
      allEntities.forEach(e => {
        if ((e as any)._distToLocal <= 10.0) {
          entitiesInside10m++;
        }
      });

      allEntities.forEach(e => {
        const dist = (e as any)._distToLocal;
        if (dist > 40.0) {
          e.setLODLevel('culled');
        } else if (dist <= 10.0 || totalEntities <= 10) {
          e.setLODLevel('full');
        } else {
          e.setLODLevel('name-only');
        }
      });

      if (entitiesInside10m <= 10 && totalEntities > 10) {
        allEntities.sort((a, b) => (a as any)._distToLocal - (b as any)._distToLocal);
        allEntities.forEach((e, index) => {
          const dist = (e as any)._distToLocal;
          if (dist <= 40.0) {
            if (index < 10) {
              e.setLODLevel('full');
            } else if (dist > 10.0) {
              e.setLODLevel('name-only');
            }
          } else {
            e.setLODLevel('culled');
          }
        });
      }
    }
  }
}
