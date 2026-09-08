import * as THREE from 'three';
import { LocalPlayer } from '../entities/player/LocalPlayer';
import { RemotePlayer } from '../entities/player/RemotePlayer';
import { myPlayer, onPlayerJoin } from '../network/NetworkManager';
import { TargetingManager } from './targeting/TargetingManager';
import { CHARACTER_CONFIG } from '../entities/player/PlayerConfig';

export class PlayerManager {
  public static playersAndControllers: { player: any; controller: LocalPlayer }[] = [];
  public static playerGroupSet = new Set<THREE.Object3D>();

  private static scratchQuat = new THREE.Quaternion();
  private static axisY = new THREE.Vector3(0, 1, 0);

  public static setupPlayerJoining(
    scene: THREE.Scene, 
    camera: THREE.PerspectiveCamera, 
    colliderMesh: THREE.Mesh, 
    projectileSystem: any,
    onLocalPlayerCreated: (char: LocalPlayer) => void
  ) {
    onPlayerJoin((player) => {
      const isLocal = player.id === myPlayer().id;
      const charCtrl = isLocal ? new LocalPlayer(scene, camera) : new RemotePlayer(scene, camera);
      charCtrl.playerId = player.id;
      charCtrl.setEnvironment(colliderMesh);
      if (projectileSystem) {
        charCtrl.setProjectileSystem(projectileSystem);
      }

      const username = player.getProfile()?.name || (isLocal ? 'You' : 'Player');
      charCtrl.initNameTag(username);

      if (isLocal) {
        player.setState('hp', CHARACTER_CONFIG.combat.maxHp || 5000);
        onLocalPlayerCreated(charCtrl);
      }

      this.playerGroupSet.add(charCtrl.playerGroup);

      const playerEntity = {
        id: player.id,
        type: 'player' as const,
        position: charCtrl.playerGroup.position,
        playerGroup: charCtrl.playerGroup,
        radius: 0.6,
        torsoHeight: 0.9,
        get hp() { return player.getState('hp') ?? (CHARACTER_CONFIG.combat.maxHp || 5000); }
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
      const currentHp = player.getState('hp') ?? 100;
      const currentAction = player.getState('action') ?? 'idle';

      if (pos) {
        controller.interpolator.addSnapshot(pos.x, pos.y, pos.z, rot, currentAction, serverTs);
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
        controller.updateNameTag(Math.max(0, currentHp / 100));
        continue;
      }

      // Handle death & respawn lifecycle for remote players
      if (currentHp <= 0 || currentAction === 'die') {
        if (!controller.isDead) {
          controller.isDead = true;
          controller.currentActionName = 'die';
          controller.playAnimationState('die', 0.1);
        }
      } else if (controller.isDead && currentHp > 0 && currentAction !== 'die') {
        // Automatically respawn and restore remote player controller
        controller.respawn(pos ? pos.x : 0, pos ? pos.z : 15);
        controller.interpolator.reset();
        if (pos) {
          controller.interpolator.addSnapshot(pos.x, pos.y, pos.z, rot, currentAction, serverTs);
        }
      }

      let animTimeScale = 1.0;
      const outQuat = controller.playerMesh ? controller.playerMesh.quaternion : this.scratchQuat;
      const state = controller.interpolator.update(delta, controller.position, outQuat);
      if (state) {
        controller.playerGroup.position.copy(controller.position);
        if (state.action === 'walk') {
          const baseWalkSpeed = 3.5;
          animTimeScale = Math.max(0.6, Math.min(1.6, state.velocity / baseWalkSpeed));
        } else if (state.action === 'run') {
          const baseRunSpeed = 6.0;
          animTimeScale = Math.max(0.7, Math.min(1.8, state.velocity / baseRunSpeed));
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
        controller.playAnimationState(currentAction);
      }
      controller.update(delta);
      controller.updateNameTag(Math.max(0, currentHp / 100));

      if (player.getState('isShooting') && currentHp > 0 && currentAction !== 'die') {
        controller.triggerAttack();
      }
    }
  }
}
