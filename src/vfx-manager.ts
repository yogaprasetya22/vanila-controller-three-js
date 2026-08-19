// src/vfx-manager.ts
import * as THREE from 'three';

export class VFXManager {
  private maxParticles: number;
  private stride = 12;
  
  private sab!: SharedArrayBuffer;
  private particleArray!: Float32Array;
  private worker!: Worker;

  public pointsMesh!: THREE.Points;
  private geometry!: THREE.BufferGeometry;
  private material!: THREE.ShaderMaterial;

  constructor(maxParticles = 50000) {
    this.maxParticles = maxParticles;
    this.initSAB();
    this.initWorker();
    this.initThreeGeometry();
  }

  private initSAB() {
    const totalBytes = this.maxParticles * this.stride * Float32Array.BYTES_PER_ELEMENT;
    this.sab = new SharedArrayBuffer(totalBytes);
    this.particleArray = new Float32Array(this.sab);
  }

  private initWorker() {
    this.worker = new Worker(
      new URL('./vfx.worker.ts', import.meta.url),
      { type: 'module' }
    );

    this.worker.postMessage({
      type: 'init',
      data: {
        sab: this.sab,
        maxParticles: this.maxParticles
      }
    });
  }

  private initThreeGeometry() {
    this.geometry = new THREE.BufferGeometry();

    const interleavedBuffer = new THREE.InstancedInterleavedBuffer(this.particleArray, this.stride);
    
    this.geometry.setAttribute('position', new THREE.InterleavedBufferAttribute(interleavedBuffer, 3, 0));
    this.geometry.setAttribute('lifeInfo', new THREE.InterleavedBufferAttribute(interleavedBuffer, 2, 6));
    this.geometry.setAttribute('color', new THREE.InterleavedBufferAttribute(interleavedBuffer, 3, 8));
    this.geometry.setAttribute('aActive', new THREE.InterleavedBufferAttribute(interleavedBuffer, 1, 11));

    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
      vertexShader: `
        attribute vec2 lifeInfo;
        attribute float aActive;
        varying vec3 vColor;
        varying float vLifeRatio;
        varying float vActive;

        void main() {
          vColor = color;
          vActive = aActive;
          
          float life = lifeInfo.x;
          float maxLife = lifeInfo.y;
          vLifeRatio = max(0.0, life / maxLife);

          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          
          gl_PointSize = vActive * vLifeRatio * 25.0 * (300.0 / -mvPosition.z);
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vLifeRatio;
        varying float vActive;

        void main() {
          if (vActive < 0.5) discard;

          vec2 center = gl_PointCoord - vec2(0.5);
          float dist = length(center);
          float glow = smoothstep(0.5, 0.0, dist);

          if (glow == 0.0) discard;

          gl_FragColor = vec4(vColor, glow * vLifeRatio);
        }
      `
    });

    this.pointsMesh = new THREE.Points(this.geometry, this.material);
  }

  public spawn(x: number, y: number, z: number, count = 100, color: [number, number, number] = [1.0, 0.5, 0.1]) {
    this.worker.postMessage({
      type: 'spawn',
      x, y, z, count, color
    });
  }

  public update() {
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.lifeInfo.needsUpdate = true;
    this.geometry.attributes.color.needsUpdate = true;
    this.geometry.attributes.aActive.needsUpdate = true;
  }
}
