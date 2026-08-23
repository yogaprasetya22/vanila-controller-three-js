import * as THREE from 'three';
import { CHARACTER_CONFIG } from './character-config';
import { getTerrainHeight } from '../simulation/constants';

function getUnits(): any[] {
  return [];
}


interface Projectile {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  age: number;
  maxAge: number;
  target: THREE.Object3D | null;
  ownerTeam?: number;
}

// Module-level pre-allocated scratch vectors — zero heap allocation in hot loop
const _gravity = new THREE.Vector3(0, -5.0, 0);
const _targetPos = new THREE.Vector3();
const _toTarget = new THREE.Vector3();
const _movementVec = new THREE.Vector3();
const _targetLook = new THREE.Vector3();
const _tPos = new THREE.Vector3();
const _rayOrigin = new THREE.Vector3(); // pre-alloc: was `new THREE.Vector3(oldX,...)` per frame
const _raycaster = new THREE.Raycaster(); // pre-alloc: was `new THREE.Raycaster(...)` per frame
const _targetLookAt = new THREE.Vector3();

export class ProjectileSystem {
  private scene: THREE.Scene;
  public projectiles: any[] = [];
  private arrowGeometry: THREE.CylinderGeometry;
  private arrowMaterial: THREE.Material;
  private meshPool: THREE.Mesh[] = []; // ponytail: object pool to prevent dynamic THREE.Mesh allocation & GC pauses
  public isLocal = false; // ponytail: only local/owned projectile systems report hits to the damage pipeline

  public getActiveCount(): number {
    return this.projectiles.length;
  }

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    // 1. Procedural Cylinder Geometry (extremely lightweight)
    this.arrowGeometry = new THREE.CylinderGeometry(0.01, 0.04, 1.2, 8);
    this.arrowGeometry.rotateX(Math.PI / 2);

    // 2. Custom glowing GLSL ShaderMaterial (additive blended)
    this.arrowMaterial = new THREE.MeshBasicMaterial({
      color: new THREE.Color(CHARACTER_CONFIG.projectiles.glowColor),
      transparent: false,
      depthWrite: true,
      side: THREE.DoubleSide
    });
  }

  public spawn(startPosition: THREE.Vector3, direction: THREE.Vector3, speed = CHARACTER_CONFIG.projectiles.speed, target: THREE.Object3D | null = null, ownerTeam = -1) {
    let arrowMesh: THREE.Mesh;
    if (this.meshPool.length > 0) {
      arrowMesh = this.meshPool.pop()!;
      arrowMesh.visible = true;
    } else {
      arrowMesh = new THREE.Mesh(this.arrowGeometry, this.arrowMaterial);
      arrowMesh.frustumCulled = false;
      arrowMesh.castShadow = false;
      arrowMesh.receiveShadow = false;
      arrowMesh.userData.velocity = new THREE.Vector3();
      this.scene.add(arrowMesh);
    }
    arrowMesh.position.copy(startPosition);

    _targetLookAt.copy(startPosition).add(direction);
    arrowMesh.lookAt(_targetLookAt);

    const velocity = arrowMesh.userData.velocity as THREE.Vector3;
    velocity.copy(direction).normalize().multiplyScalar(speed);

    this.projectiles.push({
      mesh: arrowMesh,
      velocity: velocity,
      age: 0,
      maxAge: CHARACTER_CONFIG.projectiles.maxDistance / speed,
      target: target,
      ownerTeam: ownerTeam
    });
  }

  public update(delta: number, environmentMesh: THREE.Mesh | null, spawnVFXCallback?: (pos: THREE.Vector3) => void) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.age += delta;

      // Move forward
      p.mesh.position.addScaledVector(p.velocity, delta);

      // Orient to follow velocity vector
      _targetLook.copy(p.mesh.position).add(p.velocity);
      p.mesh.lookAt(_targetLook);

      // ─── REMOTE projectile fast path ─────────────────────────────────────────
      // Host handles hit registration — remote arrows are visual only.
      // We apply simple homing steering (lerp velocity to target) so they visually track targets, 
      // but skip ALL expensive collision scanning and raycasts.
      if (!this.isLocal) {
        let remoteCollided = false;
        if (p.target) {
          _targetPos.copy(p.target.position);
          _targetPos.y += 1.0;
          _toTarget.copy(_targetPos).sub(p.mesh.position).normalize();
          const speed = p.velocity.length();
          _toTarget.multiplyScalar(speed);
          p.velocity.lerp(_toTarget, CHARACTER_CONFIG.projectiles.homingSteerForce * delta);

          // Explode if close to target center (0.7m radius = 0.49 distance squared)
          _tPos.copy(p.target.position);
          _tPos.y += 0.5;
          if (p.mesh.position.distanceToSquared(_tPos) < 0.81) { // 0.9m tolerance
            remoteCollided = true;
          }
        }
        if (remoteCollided || p.age >= p.maxAge) {
          // Trigger visual hit VFX at final position before recycling
          if (spawnVFXCallback) spawnVFXCallback(p.mesh.position);
          p.mesh.visible = false;
          this.meshPool.push(p.mesh);
          this.projectiles[i] = this.projectiles[this.projectiles.length - 1];
          this.projectiles.length--;
        }
        continue;
      }

      // ─── LOCAL projectile full path ───────────────────────────────────────────
      // Homing / Target Seeking steering
      if (p.target) {
        _targetPos.copy(p.target.position);
        _targetPos.y += 1.0;
        _toTarget.copy(_targetPos).sub(p.mesh.position).normalize();
        _toTarget.multiplyScalar(p.velocity.length());
        p.velocity.lerp(_toTarget, CHARACTER_CONFIG.projectiles.homingSteerForce * delta);
      } else {
        p.velocity.addScaledVector(_gravity, delta);
      }

      const oldX = p.mesh.position.x, oldY = p.mesh.position.y, oldZ = p.mesh.position.z;
      let collided = false;

      if (p.target) {
        // Homing: check only against pinned target — O(1)
        _tPos.copy(p.target.position);
        _tPos.y += 0.5;
        if (p.mesh.position.distanceToSquared(_tPos) < 0.49) { // 0.7m radius
          collided = true;
          if (spawnVFXCallback) spawnVFXCallback(p.mesh.position);
          const targetIndexAttr = p.target.userData.unitIndex ?? p.target.name;
          const targetIdx = parseInt(targetIndexAttr);
          if (!isNaN(targetIdx)) {
            window.dispatchEvent(new CustomEvent('projectile_hit', {
              detail: { targetIdx, damage: CHARACTER_CONFIG.combat.damage }
            }));
          }
        }
      } else {
        // Blind fire: scan units — O(n) but only for local projectiles
        const units = getUnits();
        const ownerTeam = p.ownerTeam !== undefined ? p.ownerTeam : -1;
        for (let j = 0; j < units.length; j++) {
          const u = units[j];
          if (!u || !u.root) continue;
          if (ownerTeam !== -1 && u.team === ownerTeam) continue;
          _tPos.copy(u.root.position);
          _tPos.y += 0.5;
          if (p.mesh.position.distanceToSquared(_tPos) < 0.64) { // 0.8m radius
            collided = true;
            if (spawnVFXCallback) spawnVFXCallback(p.mesh.position);
            const targetIdx = u.root.userData.unitIndex;
            if (targetIdx !== undefined && !isNaN(targetIdx)) {
              window.dispatchEvent(new CustomEvent('projectile_hit', {
                detail: { targetIdx, damage: CHARACTER_CONFIG.combat.damage }
              }));
            }
            break;
          }
        }
      }

      // Environment BVH raycast
      if (!collided && environmentMesh && environmentMesh.geometry.boundsTree) {
        _movementVec.set(
          p.mesh.position.x - oldX,
          p.mesh.position.y - oldY,
          p.mesh.position.z - oldZ,
        );
        const dist = _movementVec.length();
        if (dist > 0.001) {
          _rayOrigin.set(oldX, oldY, oldZ);
          _raycaster.set(_rayOrigin, _movementVec.normalize());
          _raycaster.near = 0;
          _raycaster.far = dist;
          const intersects = _raycaster.intersectObject(environmentMesh);
          if (intersects.length > 0) {
            collided = true;
            p.mesh.position.copy(intersects[0].point);
            if (spawnVFXCallback) spawnVFXCallback(intersects[0].point);
          }
        }
      }

      // Terrain floor fallback
      const floorY = getTerrainHeight(p.mesh.position.x, p.mesh.position.z);
      if (p.mesh.position.y < floorY + 0.05) {
        collided = true;
        p.mesh.position.y = floorY + 0.05;
        if (spawnVFXCallback) spawnVFXCallback(p.mesh.position);
      }

      // Swap-pop O(1) removal
      if (collided || p.age >= p.maxAge) {
        p.mesh.visible = false;
        this.meshPool.push(p.mesh);
        this.projectiles[i] = this.projectiles[this.projectiles.length - 1];
        this.projectiles.length--;
      }
    }
  }

  public dispose() {
    this.arrowGeometry.dispose();
    this.arrowMaterial.dispose();
  }
}
