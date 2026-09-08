import * as THREE from 'three';
import { getTerrainHeight } from '../../simulation/constants';
import { treePositions } from './Trees';
import { globalWind } from './Wind';

const LEAF_COLORS = [
  0x52b788, // 0: Forest Green
  0xfcbf49, // 1: Birch Yellow
  0xd62828, // 2: Maple Red
  0xf77f00, // 3: Maple Orange
].map(c => new THREE.Color(c));

interface LeafParticle {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  rotation: THREE.Euler;
  rotationSpeed: THREE.Vector3;
  scale: number;
  lifetime: number;
  maxLifetime: number;
  colorIndex: number;
}

// ponytail: Procedural 3D folded/creased leaf geometry instead of a flat Plane
function createLeafGeometry(): THREE.BufferGeometry {
  const geom = new THREE.BufferGeometry();
  
  // A folded diamond/leaf shape with center crease raised in Z
  const vertices = new Float32Array([
    // Left half (2 triangles)
    0, 0.12, 0.02,     // Tip
    -0.07, 0, 0,       // Left
    0, 0, 0.03,        // Center

    -0.07, 0, 0,       // Left
    0, -0.12, 0.02,    // Base
    0, 0, 0.03,        // Center

    // Right half (2 triangles)
    0, 0.12, 0.02,     // Tip
    0, 0, 0.03,        // Center
    0.07, 0, 0,        // Right

    0, 0, 0.03,        // Center
    0, -0.12, 0.02,    // Base
    0.07, 0, 0,        // Right
  ]);

  const uvs = new Float32Array([
    0.5, 1.0,   0.0, 0.5,   0.5, 0.5,
    0.0, 0.5,   0.5, 0.0,   0.5, 0.5,
    0.5, 1.0,   0.5, 0.5,   1.0, 0.5,
    0.5, 0.5,   0.5, 0.0,   1.0, 0.5,
  ]);

  geom.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geom.computeVertexNormals();
  return geom;
}

export class Leaves {
  meshes: THREE.InstancedMesh[];
  particles: LeafParticle[] = [];
  count = 180; // ponytail: reduced from 450 to 180 to avoid overcrowding
  dummy = new THREE.Object3D();
  // ponytail: pre-allocate — avoid new Matrix4() inside update() every frame
  private readonly _deadMatrix = new THREE.Matrix4().makeTranslation(0, -9999, 0);

  constructor(scene: THREE.Scene) {
    const leafGeo = createLeafGeometry();
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

    // ponytail: only spawn on Birch/Maple deciduous trees close to camera (< 65m); ignore evergreen Pines
    const nearbyTrees = treePositions.filter(pos => {
      const type = (pos as any).treeType;
      return type && type !== 'Pine_1' && pos.distanceToSquared(center) < 65 * 65;
    });

    let colorIndex = Math.floor(Math.random() * LEAF_COLORS.length);

    if (nearbyTrees.length > 0 && Math.random() < 0.85) {
      const treePos = nearbyTrees[Math.floor(Math.random() * nearbyTrees.length)];
      x = treePos.x + (Math.random() - 0.5) * 3.5;
      z = treePos.z + (Math.random() - 0.5) * 3.5;
      y = treePos.y + 1.5 + Math.random() * 3.0;

      // Match leaf color index to tree species
      const type = (treePos as any).treeType;
      if (type === 'MapleTree_1') {
        colorIndex = Math.random() < 0.5 ? 2 : 3; // Red or Orange
      } else if (type === 'BirchTree_2') {
        colorIndex = Math.random() < 0.7 ? 1 : 0; // Yellow or Green
      }
    } else {
      x = center.x + (Math.random() - 0.5) * 120;
      z = center.z + (Math.random() - 0.5) * 120;
      y = getTerrainHeight(x, z) + 2.0 + Math.random() * 5.0;
    }
    const lifetime = 6.0 + Math.random() * 8.0;
    const scale = 0.6 + Math.random() * 0.8;
    return {
      position: new THREE.Vector3(x, y, z),
      // ponytail: slower base fall velocity and horizontal drift for a gentler, slower leaf drop
      velocity: new THREE.Vector3((Math.random() - 0.5) * 0.15 + 0.03, -0.03 - Math.random() * 0.04, (Math.random() - 0.5) * 0.1),
      rotation: new THREE.Euler(Math.random() * Math.PI * 2, Math.random() * Math.PI * 2, Math.random() * Math.PI * 2),
      rotationSpeed: new THREE.Vector3((Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 1.5, (Math.random() - 0.5) * 0.9),
      scale,
      lifetime: Math.random() * lifetime,
      maxLifetime: lifetime,
      colorIndex,
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

      if (p.lifetime >= p.maxLifetime || distSq > 80.0 * 80.0) {
        this.particles[i] = this.spawnParticle(center);
        this.particles[i].lifetime = 0;
        continue;
      }

      p.velocity.y -= 0.003 * delta; // ponytail: gravity/downward acceleration halved
      const groundY = getTerrainHeight(p.position.x, p.position.z);
      const windSway = Math.sin(elapsed * 2.0 + i * 0.7) * 0.07 * delta; // ponytail: softer sinusoidal flutter
      // ponytail: wind multiplier reduced from 0.25 to 0.08 for gentler breeze effect
      p.position.x += (p.velocity.x + globalWind.direction.x * globalWind.strength * 0.08) * delta * 60 + windSway;
      p.position.y += p.velocity.y * delta * 60;
      p.position.z += (p.velocity.z + globalWind.direction.y * globalWind.strength * 0.08) * delta * 60;

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
        this.dummy.scale.setScalar(p.scale);
        this.dummy.updateMatrix();
        this.meshes[p.colorIndex].setMatrixAt(slot, this.dummy.matrix);
        colorCounters[p.colorIndex]++;
      }
    }
    this.meshes.forEach(mesh => { mesh.instanceMatrix.needsUpdate = true; });
  }
}
