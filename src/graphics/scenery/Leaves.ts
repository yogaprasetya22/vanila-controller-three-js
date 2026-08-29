import * as THREE from 'three';
import { getTerrainHeight } from '../../simulation/constants';
import { treePositions } from './Trees';
import { globalWind } from './Wind';

const LEAF_COLORS = [0x76b041, 0xffb7b2, 0xffdac1, 0x4d908e].map(c => new THREE.Color(c));

interface LeafParticle {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  rotation: THREE.Euler;
  rotationSpeed: THREE.Vector3;
  lifetime: number;
  maxLifetime: number;
  colorIndex: number;
}

export class Leaves {
  meshes: THREE.InstancedMesh[];
  particles: LeafParticle[] = [];
  count = 80; // ponytail: scaled from 40 to 80 for 2x map size
  dummy = new THREE.Object3D();
  // ponytail: pre-allocate — avoid new Matrix4() inside update() every frame
  private readonly _deadMatrix = new THREE.Matrix4().makeTranslation(0, -9999, 0);

  constructor(scene: THREE.Scene) {
    const leafGeo = new THREE.PlaneGeometry(0.18, 0.26);
    this.meshes = LEAF_COLORS.map(c => {
      const mesh = new THREE.InstancedMesh(leafGeo, new THREE.MeshBasicMaterial({
        // ponytail: MeshBasicMaterial — no lighting calc, ~3x faster fragment shader
        color: c,
        side: THREE.DoubleSide,
        transparent: true,
        alphaTest: 0.05,
      }), this.count);
      mesh.frustumCulled = true; // ponytail: partikel daun bergerak dalam area terbatas — biarkan Three.js skip jika di luar kamera
      scene.add(mesh);
      return mesh;
    });

    for (let i = 0; i < this.count; i++) {
      this.particles.push(this.spawnParticle());
    }
  }

  private spawnParticle(camPos?: THREE.Vector3): LeafParticle {
    let x: number, z: number, y: number;
    const center = camPos || new THREE.Vector3(0, 0, 0);

    if (treePositions.length > 0 && Math.random() < 0.7) {
      const treePos = treePositions[Math.floor(Math.random() * treePositions.length)];
      x = treePos.x + (Math.random() - 0.5) * 2.5;
      z = treePos.z + (Math.random() - 0.5) * 2.5;
      y = treePos.y + 1.2 + Math.random() * 1.5;
    } else {
      x = center.x + (Math.random() - 0.5) * 220;
      z = center.z + (Math.random() - 0.5) * 220;
      y = getTerrainHeight(x, z) + 1.5 + Math.random() * 4.0;
    }
    const lifetime = 6.0 + Math.random() * 8.0;
    return {
      position: new THREE.Vector3(x, y, z),
      velocity: new THREE.Vector3((Math.random() - 0.5) * 0.4 + 0.15, -0.06 - Math.random() * 0.08, (Math.random() - 0.5) * 0.25),
      rotation: new THREE.Euler(Math.random() * Math.PI * 2, Math.random() * Math.PI * 2, Math.random() * Math.PI * 2),
      rotationSpeed: new THREE.Vector3((Math.random() - 0.5) * 1.8, (Math.random() - 0.5) * 2.2, (Math.random() - 0.5) * 1.5),
      lifetime: Math.random() * lifetime,
      maxLifetime: lifetime,
      colorIndex: Math.floor(Math.random() * LEAF_COLORS.length),
    };
  }

  update(delta: number, elapsed: number, camPos?: THREE.Vector3) {
    const center = camPos || new THREE.Vector3(0, 0, 0);
    // ponytail: use cached matrix — was: new THREE.Matrix4() every frame
    this.meshes.forEach(mesh => {
      for (let j = 0; j < this.count; j++) mesh.setMatrixAt(j, this._deadMatrix);
    });

    const colorCounters = new Array(LEAF_COLORS.length).fill(0);

    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      p.lifetime += delta;

      // Cull and respawn if too far from the camera to avoid wasted calculations
      const dx = p.position.x - center.x;
      const dz = p.position.z - center.z;
      const distSq = dx * dx + dz * dz;

      if (p.lifetime >= p.maxLifetime || distSq > 150.0 * 150.0) {
        this.particles[i] = this.spawnParticle(center);
        this.particles[i].lifetime = 0;
        continue;
      }

      p.velocity.y -= 0.008 * delta;
      const groundY = getTerrainHeight(p.position.x, p.position.z);
      const windSway = Math.sin(elapsed * 2.5 + i * 0.7) * 0.15 * delta;
      p.position.x += (p.velocity.x + globalWind.direction.x * globalWind.strength * 0.25) * delta * 60 + windSway;
      p.position.y += p.velocity.y * delta * 60;
      p.position.z += (p.velocity.z + globalWind.direction.y * globalWind.strength * 0.25) * delta * 60;

      // ponytail: Fluttering rotation/sway mimicking the WebGPU/TSL implementation
      const rotationMultiplier = Math.max((p.position.y - groundY) * 0.5, 0.2); // stronger flutter in the air, settles as it approaches ground
      p.rotation.z = Math.sin(p.position.x * 4.0 + elapsed * 6.0) * 0.6 * rotationMultiplier;
      p.rotation.x = Math.sin(p.position.z * 4.0 + elapsed * 6.0) * 0.6 * rotationMultiplier;
      p.rotation.y += p.rotationSpeed.y * delta;

      if (p.position.y < groundY + 0.02) {
        p.position.y = groundY + 0.02;
        p.velocity.y = 0;
        p.velocity.x *= 0.85;
        p.velocity.z *= 0.85;
        p.rotationSpeed.multiplyScalar(0.85);
      }

      const lifeRatio = p.lifetime / p.maxLifetime;
      const alpha = Math.min(1.0, p.lifetime * 4.0) * (lifeRatio > 0.8 ? 1.0 - (lifeRatio - 0.8) / 0.2 : 1.0);
      // ponytail: MeshBasicMaterial doesn't have opacity per-instance, set per material
      (this.meshes[p.colorIndex].material as THREE.MeshBasicMaterial).opacity = alpha;

      const slot = colorCounters[p.colorIndex];
      if (slot < this.count) {
        this.dummy.position.copy(p.position);
        this.dummy.rotation.copy(p.rotation);
        this.dummy.updateMatrix();
        this.meshes[p.colorIndex].setMatrixAt(slot, this.dummy.matrix);
        colorCounters[p.colorIndex]++;
      }
    }
    this.meshes.forEach(mesh => { mesh.instanceMatrix.needsUpdate = true; });
  }
}
