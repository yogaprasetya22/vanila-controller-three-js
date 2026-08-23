import * as THREE from 'three';

export class SceneryWindLines {
  points: THREE.Points;
  geometry: THREE.BufferGeometry;
  velocities: { x: number, y: number, z: number, speed: number }[] = [];
  count = 150;
  constructor(scene: THREE.Scene) {
    this.geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(this.count * 3);

    for (let i = 0; i < this.count; i++) {
      const px = (Math.random() - 0.5) * 240;
      const py = 0.5 + Math.random() * 10.0;
      const pz = (Math.random() - 0.5) * 180;
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
    scene.add(this.points);
  }

  update(delta: number, elapsed: number) {
    const posAttr = this.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < this.count; i++) {
      let px = posAttr.getX(i);
      let py = posAttr.getY(i);
      let pz = posAttr.getZ(i);
      const vel = this.velocities[i];
      px += vel.x * delta * 8.0 * vel.speed;
      py += Math.sin(elapsed * 1.5 + i) * 0.01 * vel.speed;
      pz += vel.z * delta * 4.0 * vel.speed;

      if (px > 120) {
        px = -120;
        py = 0.5 + Math.random() * 10.0;
        pz = (Math.random() - 0.5) * 180;
      }
      posAttr.setXYZ(i, px, py, pz);
    }
    posAttr.needsUpdate = true;
  }
}
