import * as THREE from 'three';
import type { IAttackBehavior } from './IAttackBehavior';
import type { BaseEnemyController } from '../BaseEnemyController';
import { myPlayer } from '../../../network/NetworkManager.ts';
import { damageHUDBatcher } from '../../../graphics/effects/DamageHUDBatcher.ts';
import { TargetingManager } from '../../../systems/targeting/TargetingManager';
import { CHARACTER_CONFIG } from '../../player/PlayerConfig';

interface EnemyProjectile {
  mesh: THREE.Group;
  pos: THREE.Vector3;
  targetPos: THREE.Vector3;
  dir: THREE.Vector3;
  speed: number;
  active: boolean;
  damage: number;
  targetPlayerId: string;
}

// Module-level shared geometries & materials for ultra-lightweight rendering
const _orbGeo = new THREE.SphereGeometry(0.28, 8, 8);
const _orbMat = new THREE.MeshBasicMaterial({
  color: 0xff2255, // Glowing crimson magic
  transparent: true,
  opacity: 0.95
});

const _trailGeo = new THREE.ConeGeometry(0.18, 0.9, 6);
_trailGeo.rotateX(-Math.PI / 2);
const _trailMat = new THREE.MeshBasicMaterial({
  color: 0xff7722, // Fiery trail
  transparent: true,
  opacity: 0.70,
  blending: THREE.AdditiveBlending
});

export class RangedAttackBehavior implements IAttackBehavior {
  public attackRange: number;
  private owner!: BaseEnemyController;
  private hasDamagedThisLoop = false;
  private projectiles: EnemyProjectile[] = [];
  private pool: THREE.Group[] = [];

  constructor(attackRange: number = 18.0) {
    this.attackRange = attackRange;
  }

  public init(owner: BaseEnemyController): void {
    this.owner = owner;
  }

  private getOrCreateProjectileMesh(): THREE.Group {
    if (this.pool.length > 0) {
      const g = this.pool.pop()!;
      g.visible = true;
      return g;
    }
    const group = new THREE.Group();
    const orb = new THREE.Mesh(_orbGeo, _orbMat);
    const trail = new THREE.Mesh(_trailGeo, _trailMat);
    trail.position.z = 0.45;
    group.add(orb);
    group.add(trail);

    const scene = this.owner.playerGroup.parent;
    if (scene) {
      scene.add(group);
    }
    return group;
  }

  public update(delta: number, _target: any): void {
    // 1. Update active flying projectiles
    const localId = myPlayer().id;

    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      if (!p.active) continue;

      const step = p.speed * delta;
      p.pos.addScaledVector(p.dir, step);
      p.mesh.position.copy(p.pos);

      // Check distance to target
      const distToTarget = p.pos.distanceTo(p.targetPos);
      if (distToTarget <= Math.max(1.2, step * 1.5)) {
        // Impact!
        p.active = false;
        p.mesh.visible = false;
        this.pool.push(p.mesh);
        this.projectiles.splice(i, 1);

        if (p.targetPlayerId === localId) {
          damageHUDBatcher.spawn({
            skill: 'normal',
            value: p.damage,
            position: [p.targetPos.x, p.targetPos.y + 1, p.targetPos.z],
            isCrit: Math.random() > 0.85,
            isMagic: true,
            forceShow: true
          });
          const maxHp = CHARACTER_CONFIG.combat.maxHp || 5000;
          const localHp = myPlayer().getState('hp') ?? maxHp;
          const nextHp = Math.max(0, localHp - p.damage);
          myPlayer().setState('hp', nextHp === 0 ? maxHp : nextHp);
        }
      }
    }

    if (this.owner.hp <= 0) return;

    // 2. Attack Trigger during attack animation
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

          const players = TargetingManager.getAllEntities().filter(e => e.type === 'player');
          const baseDamage = 14;
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

          if (closestPlayer) {
            const spawnPos = new THREE.Vector3(
              this.owner.playerGroup.position.x,
              this.owner.playerGroup.position.y + 1.2,
              this.owner.playerGroup.position.z
            );
            const targetPos = new THREE.Vector3(
              closestPlayer.position.x,
              closestPlayer.position.y + 1.0,
              closestPlayer.position.z
            );

            const dir = new THREE.Vector3().subVectors(targetPos, spawnPos).normalize();
            const projMesh = this.getOrCreateProjectileMesh();
            projMesh.position.copy(spawnPos);
            projMesh.lookAt(targetPos);

            this.projectiles.push({
              mesh: projMesh,
              pos: spawnPos,
              targetPos,
              dir,
              speed: 26.0, // High-velocity physical missile
              active: true,
              damage: baseDamage,
              targetPlayerId: closestPlayer.id
            });
          }
        }
      }
    }
  }
}
