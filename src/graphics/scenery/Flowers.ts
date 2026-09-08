import * as THREE from 'three';
import { getTerrainHeight } from '../../simulation/constants';

export class Flowers {
  redMesh: THREE.InstancedMesh;
  yellowMesh: THREE.InstancedMesh;
  constructor(scene: THREE.Scene, uniforms: { uTime: { value: number } }) {
    const flowerGeo = new THREE.DodecahedronGeometry(0.06, 0);
    flowerGeo.translate(0, 0.06, 0);

    const pos = flowerGeo.attributes.position;
    const colorsRed: number[] = [];
    const colorsYellow: number[] = [];
    const colorBase = new THREE.Color(0x233b28);
    const colorRed = new THREE.Color(0xff4466);
    const colorYellow = new THREE.Color(0xffcc00);

    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const ratio = Math.max(0.0, Math.min(1.0, y / 0.06));
      colorsRed.push(colorBase.clone().lerp(colorRed, ratio).r, colorBase.clone().lerp(colorRed, ratio).g, colorBase.clone().lerp(colorRed, ratio).b);
      colorsYellow.push(colorBase.clone().lerp(colorYellow, ratio).r, colorBase.clone().lerp(colorYellow, ratio).g, colorBase.clone().lerp(colorYellow, ratio).b);
    }

    const flowerGeoRed = flowerGeo.clone();
    flowerGeoRed.setAttribute('color', new THREE.Float32BufferAttribute(colorsRed, 3));
    const flowerGeoYellow = flowerGeo.clone();
    flowerGeoYellow.setAttribute('color', new THREE.Float32BufferAttribute(colorsYellow, 3));

    const flowerMatRed = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, flatShading: true });
    const flowerMatYellow = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, flatShading: true });

    const applyFlowerWind = (mat: THREE.MeshStandardMaterial) => {
      mat.onBeforeCompile = (shader: any) => {
        shader.uniforms.uTime = uniforms.uTime;
        shader.vertexShader = `uniform float uTime;\n` + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace(
          '#include <begin_vertex>',
          `
          #include <begin_vertex>
          float wind = sin(uTime * 2.8 + transformed.x * 1.5 + transformed.z * 1.5) * 0.15;
          transformed.x += wind * (position.y / 0.06);
          transformed.z += wind * 0.3 * (position.y / 0.06);
          `
        );
      };
    };
    applyFlowerWind(flowerMatRed);
    applyFlowerWind(flowerMatYellow);

    const totalFlowerInstances = 800;
    this.redMesh = new THREE.InstancedMesh(flowerGeoRed, flowerMatRed, totalFlowerInstances);
    this.yellowMesh = new THREE.InstancedMesh(flowerGeoYellow, flowerMatYellow, totalFlowerInstances);
    const dummyFlower = new THREE.Object3D();

    // Simple deterministic PRNG for stable coordinates
    let seed = 12345;
    const prng = () => {
      const x = Math.sin(seed++) * 10000;
      return x - Math.floor(x);
    };

    for (let i = 0; i < totalFlowerInstances; i++) {
      const rx = (prng() - 0.5) * 2300;
      const rz = (prng() - 0.5) * 2300;
      if (Math.abs(rx) < 5.0 && Math.abs(rz) < 5.0) { i--; continue; } // skip center battlefield
      dummyFlower.position.set(rx, getTerrainHeight(rx, rz), rz);
      dummyFlower.rotation.y = prng() * Math.PI;
      dummyFlower.scale.setScalar(0.7 + prng() * 0.6);
      dummyFlower.updateMatrix();
      this.redMesh.setMatrixAt(i, dummyFlower.matrix);
    }
    for (let i = 0; i < totalFlowerInstances; i++) {
      const yx = (prng() - 0.5) * 2300;
      const yz = (prng() - 0.5) * 2300;
      if (Math.abs(yx) < 5.0 && Math.abs(yz) < 5.0) { i--; continue; }
      dummyFlower.position.set(yx, getTerrainHeight(yx, yz), yz);
      dummyFlower.rotation.y = prng() * Math.PI;
      dummyFlower.scale.setScalar(0.7 + prng() * 0.6);
      dummyFlower.updateMatrix();
      this.yellowMesh.setMatrixAt(i, dummyFlower.matrix);
    }
    this.redMesh.instanceMatrix.needsUpdate = true;
    this.yellowMesh.instanceMatrix.needsUpdate = true;
    scene.add(this.redMesh);
    scene.add(this.yellowMesh);
  }
}
