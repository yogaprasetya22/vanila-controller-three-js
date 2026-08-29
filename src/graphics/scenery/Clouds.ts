import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { getTerrainHeight } from '../../simulation/constants';

export class Clouds {
  private instancedMesh: THREE.InstancedMesh;
  private count = 80;
  private positions: THREE.Vector3[] = [];
  private speeds: number[] = [];
  private scales: THREE.Vector3[] = [];
  private heightOffsets: number[] = [];
  private worldSize = 860; // Match the world dimensions

  constructor(scene: THREE.Scene) {
    const cloudGeometry = createLowPolyCloudGeometry();

    const material = createCartoonCloudMaterial('#ffffff', '#b9d3e6', 0.95);

    this.instancedMesh = new THREE.InstancedMesh(cloudGeometry, material, this.count);
    this.instancedMesh.castShadow = false;
    this.instancedMesh.receiveShadow = false;

    // Initialize instances scattered in the sky
    const halfSize = this.worldSize / 2;
    const rotation = new THREE.Quaternion();

    for (let i = 0; i < this.count; i++) {
      const x = (Math.random() - 0.5) * this.worldSize;
      const z = (Math.random() - 0.5) * this.worldSize;

      // Group types: 50% Small, 35% Large, 15% Extra Large
      const rand = Math.random();
      const groundY = Math.max(getTerrainHeight(x, z), -3.0);
      let heightOffset = 35.0;
      let sc = 1.0;
      let speed = 2.0;

      if (rand < 0.50) {
        // Small clouds (drift fast, sit lower)
        sc = 0.6 + Math.random() * 0.5;
        speed = 3.5 + Math.random() * 2.5;
        heightOffset = 35.0 + Math.random() * 4.0;
      } else if (rand < 0.85) {
        // Large clouds (drift medium, sit middle)
        sc = 1.6 + Math.random() * 1.0;
        speed = 1.8 + Math.random() * 1.4;
        heightOffset = 39.0 + Math.random() * 5.0;
      } else {
        // Extra Large clouds (drift slowly, sit high up)
        sc = 3.2 + Math.random() * 1.8;
        speed = 0.6 + Math.random() * 0.8;
        heightOffset = 44.0 + Math.random() * 6.0;
      }

      const y = groundY + heightOffset;
      this.heightOffsets.push(heightOffset);
      this.positions.push(new THREE.Vector3(x, y, z));
      this.speeds.push(speed);
      
      this.scales.push(new THREE.Vector3(sc * 1.6, sc * 0.7, sc * 1.2)); // Cartoon scale ratio

      const matrix = new THREE.Matrix4();
      const scale = this.scales[i];
      matrix.compose(this.positions[i], rotation, scale);
      this.instancedMesh.setMatrixAt(i, matrix);
    }

    this.instancedMesh.instanceMatrix.needsUpdate = true;
    scene.add(this.instancedMesh);
  }

  public update(delta: number, camPos: THREE.Vector3) {
    const halfSize = this.worldSize / 2;
    const matrix = new THREE.Matrix4();
    const rotation = new THREE.Quaternion();

    for (let i = 0; i < this.count; i++) {
      const pos = this.positions[i];
      const speed = this.speeds[i];
      const scale = this.scales[i];

      // Drift along the X axis
      pos.x += speed * delta;

      // Wrap around bounds
      if (pos.x > halfSize) {
        pos.x = -halfSize;
        pos.z = (Math.random() - 0.5) * this.worldSize; // randomize Z on wrap
      }

      // ponytail: update height dynamically to stay 35+ meters above ground/water surface
      const groundY = Math.max(getTerrainHeight(pos.x, pos.z), -3.0);
      pos.y = groundY + this.heightOffsets[i];

      // ponytail: collapse cloud scale to 0.0 if further than 100 meters from camera to save render cost
      const distSq = pos.distanceToSquared(camPos);
      let finalScale = scale;
      if (distSq > 10000) {
        finalScale = new THREE.Vector3(0, 0, 0);
      } else if (distSq > 6400) { // Smooth scale fade-out between 80m and 100m
        const dist = Math.sqrt(distSq);
        const fade = 1.0 - (dist - 80) / 20;
        finalScale = scale.clone().multiplyScalar(fade);
      }

      matrix.compose(pos, rotation, finalScale);
      this.instancedMesh.setMatrixAt(i, matrix);
    }

    this.instancedMesh.instanceMatrix.needsUpdate = true;
  }
}

export function createLowPolyCloudGeometry(): THREE.BufferGeometry {
  const geometries: THREE.BufferGeometry[] = [];
  
  // Core center sphere
  const sphere1 = new THREE.SphereGeometry(3, 8, 8);
  sphere1.translate(0, 0, 0);
  geometries.push(sphere1);
  
  // Left sphere
  const sphere2 = new THREE.SphereGeometry(2, 8, 8);
  sphere2.translate(-2.5, -0.5, 0);
  geometries.push(sphere2);
  
  // Right sphere
  const sphere3 = new THREE.SphereGeometry(2, 8, 8);
  sphere3.translate(2.5, -0.5, 0);
  geometries.push(sphere3);
  
  // Front sphere
  const sphere4 = new THREE.SphereGeometry(1.8, 8, 8);
  sphere4.translate(0, -0.6, 2.0);
  geometries.push(sphere4);
  
  // Back sphere
  const sphere5 = new THREE.SphereGeometry(1.8, 8, 8);
  sphere5.translate(0, -0.6, -2.0);
  geometries.push(sphere5);

  const cloudGeometry = BufferGeometryUtils.mergeGeometries(geometries);
  cloudGeometry.computeVertexNormals();
  return cloudGeometry;
}

export function createCartoonCloudMaterial(topColorHex: string, bottomColorHex: string, opacity = 0.9): THREE.Material {
  const material = new THREE.MeshPhongMaterial({
    color: 0xffffff,
    flatShading: true,
    transparent: true,
    opacity: opacity,
    depthWrite: true
  });

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTopColor = { value: new THREE.Color(topColorHex) };
    shader.uniforms.uBottomColor = { value: new THREE.Color(bottomColorHex) };

    // Inject custom varying normal in both shaders to guarantee compatibility
    shader.vertexShader = `
      varying vec3 myNormal;
    ` + shader.vertexShader;

    shader.fragmentShader = `
      varying vec3 myNormal;
      uniform vec3 uTopColor;
      uniform vec3 uBottomColor;
    ` + shader.fragmentShader;

    // Compute the normal in view space in the vertex shader
    shader.vertexShader = shader.vertexShader.replace(
      '#include <beginnormal_vertex>',
      `
      #include <beginnormal_vertex>
      myNormal = normalize(normalMatrix * objectNormal);
      `
    );

    // Apply toon shading using our custom normal in the fragment shader
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `
      #include <color_fragment>
      float intensity = normalize(myNormal).y * 0.5 + 0.5;
      diffuseColor.rgb = mix(uBottomColor, uTopColor, step(0.48, intensity));
      `
    );
  };

  return material;
}
