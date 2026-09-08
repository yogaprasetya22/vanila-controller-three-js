import * as THREE from 'three';
import { getTerrainHeight } from '../../simulation/constants';
import { WindEffectManager } from './WindLines';

export class SceneryWindLines {
  points: THREE.Points;
  geometry: THREE.BufferGeometry;
  velocities: { x: number, y: number, z: number, speed: number }[] = [];
  count = 25;
  constructor(scene: THREE.Scene) {
    this.geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(this.count * 3);

    for (let i = 0; i < this.count; i++) {
      const px = (Math.random() - 0.5) * 460;
      const pz = (Math.random() - 0.5) * 340;
      const py = getTerrainHeight(px, pz) + 0.5 + Math.random() * 8.0;
      positions[i * 3] = px;
      positions[i * 3 + 1] = py;
      positions[i * 3 + 2] = pz;

      this.velocities.push({
        x: 0.15 + Math.random() * 0.15,
        y: (Math.random() - 0.5) * 0.05,
        z: (Math.random() - 0.5) * 0.05,
        speed: 0.8 + Math.random() * 0.6
      });
    }

    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.points = new THREE.Points(this.geometry, new THREE.PointsMaterial({
      color: 0xffeebb,
      size: 0.12,
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending
    }));
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  update(delta: number, elapsed: number, camPos?: THREE.Vector3) {
    // ponytail: follow active status of WindEffectManager
    const isWindActive = WindEffectManager.instance && WindEffectManager.instance.active;
    this.points.visible = !!isWindActive;
    if (!isWindActive) return;

    const posAttr = this.geometry.attributes.position as THREE.BufferAttribute;
    const center = camPos || new THREE.Vector3(0, 0, 0);

    for (let i = 0; i < this.count; i++) {
      let px = posAttr.getX(i);
      let py = posAttr.getY(i);
      let pz = posAttr.getZ(i);
      const vel = this.velocities[i];
      px += vel.x * delta * 8.0 * vel.speed;
      py += Math.sin(elapsed * 1.5 + i) * 0.01 * vel.speed;
      pz += vel.z * delta * 4.0 * vel.speed;

      // Wrap particles in a tight 80x80 zone around the camera so they are always visible
      const dx = px - center.x;
      const dz = pz - center.z;

      if (dx > 40.0) {
        px = center.x - 40.0;
        pz = center.z + (Math.random() - 0.5) * 80.0;
        py = getTerrainHeight(px, pz) + 0.5 + Math.random() * 8.0;
      } else if (dx < -40.0) {
        px = center.x + 40.0;
        pz = center.z + (Math.random() - 0.5) * 80.0;
        py = getTerrainHeight(px, pz) + 0.5 + Math.random() * 8.0;
      }

      if (dz > 40.0) {
        pz = center.z - 40.0;
        px = center.x + (Math.random() - 0.5) * 80.0;
        py = getTerrainHeight(px, pz) + 0.5 + Math.random() * 8.0;
      } else if (dz < -40.0) {
        pz = center.z + 40.0;
        px = center.x + (Math.random() - 0.5) * 80.0;
        py = getTerrainHeight(px, pz) + 0.5 + Math.random() * 8.0;
      }

      posAttr.setXYZ(i, px, py, pz);
    }
    posAttr.needsUpdate = true;
  }
}
