import * as THREE from 'three';
import { LocalPlayer } from '../../entities/player/LocalPlayer';
import { BaseEnemyController } from '../../entities/enemy/BaseEnemyController';
import { referencePosition } from './scene';
import { myPlayer } from '../../network/NetworkManager';

export class LODManager {
  private static lodSortTimer = 0;

  // Pre-allocated reusable arrays to prevent garbage collection spikes in render loop
  private static remotePlayersList: LocalPlayer[] = [];
  private static mobsList: BaseEnemyController[] = [];

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
    if (this.lodSortTimer >= 0.25) { // Evaluate LOD every 250ms
      this.lodSortTimer = 0;

      const maxFullPlayers = Number(import.meta.env.VITE_LOD_MAX_PLAYERS) || 30;
      const maxFullEnemies = Number(import.meta.env.VITE_LOD_MAX_ENEMIES) || 30;

      const myId = myPlayer().id;

      // ─── 1. TRACK 1: ENEMY & BOSS LOD ──────────────────────────────────────────
      this.mobsList.length = 0;

      for (const enemy of npcControllers.values()) {
        if (enemy.hp <= 0) {
          enemy.setLODLevel('culled');
          continue;
        }

        const dist = enemy.position.distanceTo(referencePosition);
        (enemy as any)._distToLocal = dist;

        // BOSS PRIORITY: World Bosses and Raid Bosses are ALWAYS 'full' LOD within 80m
        if (enemy.npcType === 'world_boss' || enemy.npcType === 'raid_boss') {
          if (dist <= 80.0) {
            enemy.setLODLevel('full');
          } else {
            enemy.setLODLevel('culled');
          }
        } else {
          // Regular Mobs
          if (dist > 45.0) {
            enemy.setLODLevel('culled');
          } else {
            this.mobsList.push(enemy);
          }
        }
      }

      // Sort regular mobs by distance to player
      if (this.mobsList.length > 0) {
        this.mobsList.sort((a, b) => (a as any)._distToLocal - (b as any)._distToLocal);
        for (let i = 0; i < this.mobsList.length; i++) {
          const mob = this.mobsList[i];
          if (i < maxFullEnemies) {
            mob.setLODLevel('full');
          } else {
            mob.setLODLevel('name-only');
          }
        }
      }

      // ─── 2. TRACK 2: REMOTE PLAYERS / BOTS LOD ─────────────────────────────────
      this.remotePlayersList.length = 0;

      for (const pc of playersAndControllers) {
        if (pc.player.id === myId) continue;
        const ctrl = pc.controller;
        const dist = ctrl.position.distanceTo(referencePosition);
        (ctrl as any)._distToLocal = dist;

        if (dist > 45.0) {
          ctrl.setLODLevel('culled');
        } else {
          this.remotePlayersList.push(ctrl);
        }
      }

      // Sort remote players / bots by distance
      if (this.remotePlayersList.length > 0) {
        this.remotePlayersList.sort((a, b) => (a as any)._distToLocal - (b as any)._distToLocal);
        for (let i = 0; i < this.remotePlayersList.length; i++) {
          const playerCtrl = this.remotePlayersList[i];
          if (i < maxFullPlayers) {
            playerCtrl.setLODLevel('full');
          } else {
            playerCtrl.setLODLevel('name-only');
          }
        }
      }
    }
  }
}
