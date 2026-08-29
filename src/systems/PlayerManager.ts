import * as THREE from 'three';
import { LocalPlayer } from '../entities/player/LocalPlayer';
import { RemotePlayer } from '../entities/player/RemotePlayer';
import { myPlayer, onPlayerJoin } from '../network/NetworkManager';
import { TargetingManager } from './targeting/TargetingManager';

export class PlayerManager {
  public static playersAndControllers: { player: any; controller: LocalPlayer }[] = [];
  public static playerGroupSet = new Set<THREE.Object3D>();

  private static scratchQuat = new THREE.Quaternion();
  private static axisY = new THREE.Vector3(0, 1, 0);

  public static setupPlayerJoining(
    scene: THREE.Scene, 
    camera: THREE.PerspectiveCamera, 
    colliderMesh: THREE.Mesh, 
    onLocalPlayerCreated: (char: LocalPlayer) => void
  ) {
    onPlayerJoin((player) => {
      const isLocal = player.id === myPlayer().id;
      const charCtrl = isLocal ? new LocalPlayer(scene, camera) : new RemotePlayer(scene, camera);
      charCtrl.playerId = player.id;
      charCtrl.setEnvironment(colliderMesh);

      const username = player.getProfile()?.name || (isLocal ? 'You' : 'Player');
      charCtrl.initNameTag(username);

      if (isLocal) {
        player.setState('hp', 100);
        onLocalPlayerCreated(charCtrl);
      }

      this.playerGroupSet.add(charCtrl.playerGroup);

      const playerEntity = {
        id: player.id,
        type: 'player' as const,
        position: charCtrl.playerGroup.position,
        playerGroup: charCtrl.playerGroup,
        radius: 0.6,
        get hp() { return player.getState('hp') || 100; }
      };
      TargetingManager.registerEntity(playerEntity);

      player.onQuit(() => {
        scene.remove(charCtrl.playerGroup);
        this.playerGroupSet.delete(charCtrl.playerGroup);
        TargetingManager.unregisterEntity(player.id);
        const idx = this.playersAndControllers.findIndex(p => p.player.id === player.id);
        if (idx !== -1) this.playersAndControllers.splice(idx, 1);
      });

      this.playersAndControllers.push({ player, controller: charCtrl });
    });
  }

  public static updateRemotePlayers(delta: number) {
    for (const { player, controller } of this.playersAndControllers) {
      if (player.id === myPlayer().id) continue;

      const pos = player.getState('pos');
      const rot = player.getState('rot') ?? 0;
      const serverTs = player.getState('_serverTs') ?? 0;

      if (pos) {
        controller.interpolator.addSnapshot(pos.x, pos.y, pos.z, rot, player.getState('action') ?? 'idle', serverTs);
      }

      if (controller.lodLevel === 'culled') {
        if (pos) {
          controller.position.set(pos.x, pos.y, pos.z);
          controller.playerGroup.position.copy(controller.position);
        }
        controller.update(delta);
        continue;
      }

      if (controller.lodLevel === 'name-only') {
        if (pos) {
          controller.position.set(pos.x, pos.y, pos.z);
          controller.playerGroup.position.copy(controller.position);
        }
        controller.update(delta);
        controller.updateNameTag((player.getState('hp') ?? 100) / 100);
        continue;
      }

      let animTimeScale = 1.0;
      const outQuat = controller.playerMesh ? controller.playerMesh.quaternion : this.scratchQuat;
      const state = controller.interpolator.update(delta, controller.position, outQuat);
      if (state) {
        controller.playerGroup.position.copy(controller.position);
        if (state.action === 'walk') {
          const baseWalkSpeed = 4.0;
          animTimeScale = Math.max(0.1, state.velocity / baseWalkSpeed);
        }
        controller.playAnimationState(state.action, 0.15, animTimeScale);
      } else {
        if (pos) {
          controller.position.set(pos.x, pos.y, pos.z);
          controller.playerGroup.position.copy(controller.position);
        }
        if (controller.playerMesh) {
          controller.playerMesh.quaternion.setFromAxisAngle(this.axisY, rot);
        }
        controller.playAnimationState(player.getState('action') ?? 'idle');
      }
      controller.update(delta);
      controller.updateNameTag((player.getState('hp') ?? 100) / 100);

      if (player.getState('isShooting')) {
        controller.triggerAttack();
      }
    }
  }
}
