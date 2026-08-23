import * as THREE from 'three';
import { CHARACTER_CONFIG } from './character-config';
import { getTerrainHeight } from '../simulation/constants';
import { myPlayer } from '../network/NetworkManager.ts';

function getUnits(): any[] {
  return [];
}

interface Projectile {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  age: number;
  maxAge: number;
  target: THREE.Object3D | null;
  ownerId?: string;
  ownerTeam?: number;
}

// Module-level pre-allocated scratch vectors — zero heap allocation in hot loop
const _gravity = new THREE.Vector3(0, -5.0, 0);
const _targetPos = new THREE.Vector3();
const _toTarget = new THREE.Vector3();
const _movementVec = new THREE.Vector3();
const _targetLook = new THREE.Vector3();
const _tPos = new THREE.Vector3();
const _rayOrigin = new THREE.Vector3();
const _raycaster = new THREE.Raycaster();
const _targetLookAt = new THREE.Vector3();

export class ProjectileSystem {
  private scene: THREE.Scene;
  public projectiles: Projectile[] = [];
  private arrowGeometry: THREE.CylinderGeometry;
  private arrowMaterial: THREE.Material;
  private meshPool: THREE.Mesh[] = [];

  public getActiveCount(): number {
    return this.projectiles.length;
  }

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    // 1. Procedural Cylinder Geometry (extremely lightweight)
    this.arrowGeometry = new THREE.CylinderGeometry(0.01, 0.04, 1.2, 8);
    this.arrowGeometry.rotateX(Math.PI / 2);

    // 2. Custom glowing GLSL ShaderMaterial
    this.arrowMaterial = new THREE.MeshBasicMaterial({
      color: new THREE.Color(CHARACTER_CONFIG.projectiles.glowColor),
      transparent: false,
      depthWrite: true,
      side: THREE.DoubleSide
    });
  }

  public spawn(startPosition: THREE.Vector3, direction: THREE.Vector3, speed = CHARACTER_CONFIG.projectiles.speed, target: THREE.Object3D | null = null, ownerTeam = -1, ownerId?: string) {
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
      ownerId: ownerId,
      ownerTeam: ownerTeam
    });
  }

  public update(delta: number, environmentMesh: THREE.Mesh | null, spawnVFXCallback?: (pos: THREE.Vector3, target: THREE.Object3D | null) => void) {
    const localPlayerId = myPlayer().id;

    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.age += delta;

      // Move forward
      p.mesh.position.addScaledVector(p.velocity, delta);

      // Orient to follow velocity vector
      _targetLook.copy(p.mesh.position).add(p.velocity);
      p.mesh.lookAt(_targetLook);

      // Verify if projectile was shot by local player
      const isLocal = p.ownerId === localPlayerId;

      // ─── REMOTE projectile path (or visual-only helper path) ─────────────────────────────────────────
      if (!isLocal) {
        let remoteCollided = false;
        if (p.target) {
          _targetPos.copy(p.target.position);
          _targetPos.y += 1.0;
          _toTarget.copy(_targetPos).sub(p.mesh.position).normalize();
          const speed = p.velocity.length();
          _toTarget.multiplyScalar(speed);
          p.velocity.lerp(_toTarget, CHARACTER_CONFIG.projectiles.homingSteerForce * delta);

          // Explode if close to target center
          _tPos.copy(p.target.position);
          _tPos.y += 0.5;
          if (p.mesh.position.distanceToSquared(_tPos) < 0.81) {
            remoteCollided = true;
          }
        }
        if (remoteCollided || p.age >= p.maxAge) {
          if (spawnVFXCallback) spawnVFXCallback(p.mesh.position, p.target);
          p.mesh.visible = false;
          this.meshPool.push(p.mesh);
          this.projectiles[i] = this.projectiles[this.projectiles.length - 1];
          this.projectiles.length--;
        }
        continue;
      }

      // ─── LOCAL projectile path (Check collisions & trigger hit callbacks) ───────────────────────────────────────────
      if (p.target) {
        // Homing: check only against pinned target — O(1)
        _tPos.copy(p.target.position);
        _tPos.y += 0.5;
        let collided = false;
        if (p.mesh.position.distanceToSquared(_tPos) < 0.81) { // 0.9m tolerance
          collided = true;
          if (spawnVFXCallback) spawnVFXCallback(p.mesh.position, p.target);
        }

        if (collided || p.age >= p.maxAge) {
          p.mesh.visible = false;
          this.meshPool.push(p.mesh);
          this.projectiles[i] = this.projectiles[this.projectiles.length - 1];
          this.projectiles.length--;
          continue;
        }
      } else {
        // Fallback blind fire (optional)
        p.velocity.addScaledVector(_gravity, delta);
      }

      const oldX = p.mesh.position.x, oldY = p.mesh.position.y, oldZ = p.mesh.position.z;
      let collided = false;

      // Environment BVH raycast
      if (environmentMesh && environmentMesh.geometry.boundsTree) {
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
            if (spawnVFXCallback) spawnVFXCallback(intersects[0].point, null);
          }
        }
      }

      // Terrain floor fallback
      const floorY = getTerrainHeight(p.mesh.position.x, p.mesh.position.z);
      if (p.mesh.position.y < floorY + 0.05) {
        collided = true;
        p.mesh.position.y = floorY + 0.05;
        if (spawnVFXCallback) spawnVFXCallback(p.mesh.position, null);
      }

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
