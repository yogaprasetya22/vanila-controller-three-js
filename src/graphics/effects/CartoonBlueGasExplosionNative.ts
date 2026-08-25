import * as THREE from 'three';

interface Particle {
  active: boolean;
  px: number; py: number; pz: number;
  vx: number; vy: number; vz: number;
  r: number; g: number; b: number;
  age: number;
  maxAge: number;
}

export class CartoonBlueGasExplosionNativeVFX {
  private scene: THREE.Scene;

  // Pre-allocated particles pool
  private readonly maxParticles = 300;
  private particles: Particle[] = [];
  private poolPointer = 0;
  private activeCount = 0; // Track active count to skip update when idle

  // THREE.js points mesh — single draw call
  private geometry: THREE.BufferGeometry;
  private material: THREE.PointsMaterial;
  private pointsMesh: THREE.Points;

  // Float arrays for fast geometry attribute updates — no heap allocation during update
  private readonly positionsArr: Float32Array;
  private readonly colorsArr: Float32Array;

  constructor(scene: THREE.Scene, _camera: THREE.Camera) {
    this.scene = scene;

    // Pre-allocate pool
    for (let i = 0; i < this.maxParticles; i++) {
      this.particles.push({ active: false, px: 0, py: 0, pz: 0, vx: 0, vy: 0, vz: 0, r: 0, g: 0, b: 0, age: 0, maxAge: 0 });
    }

    this.positionsArr = new Float32Array(this.maxParticles * 3);
    this.colorsArr = new Float32Array(this.maxParticles * 3);

    // Init positions offscreen so GPU doesn't render garbage
    for (let i = 0; i < this.maxParticles * 3; i += 3) {
      this.positionsArr[i] = 99999;
      this.positionsArr[i + 1] = 99999;
      this.positionsArr[i + 2] = 99999;
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positionsArr, 3));
    this.geometry.setAttribute('color',    new THREE.BufferAttribute(this.colorsArr, 3));

    this.material = new THREE.PointsMaterial({
      size: 0.6,
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });

    this.pointsMesh = new THREE.Points(this.geometry, this.material);
    this.pointsMesh.frustumCulled = false; // Always render — pool position 99999 culls naturally
    this.scene.add(this.pointsMesh);
  }

  public spawn(x: number, y: number, z: number): void {
    const count = 12; // 12 sparks per hit — enough visual impact, not too heavy
    for (let i = 0; i < count; i++) {
      const p = this.particles[this.poolPointer];
      this.poolPointer = (this.poolPointer + 1) % this.maxParticles;

      if (!p.active) this.activeCount++;
      p.active = true;
      p.age = 0;
      p.maxAge = 0.22 + Math.random() * 0.18; // 0.22s – 0.4s

      // Small spawn jitter
      p.px = x + (Math.random() - 0.5) * 0.2;
      p.py = y + (Math.random() - 0.5) * 0.2;
      p.pz = z + (Math.random() - 0.5) * 0.2;

      // Explosive velocity — high upward arc + wide scatter
      const angle = Math.random() * Math.PI * 2;
      const speed = 4.0 + Math.random() * 7.0;
      p.vx = Math.cos(angle) * speed;
      p.vy = 5.0 + Math.random() * 9.0;
      p.vz = Math.sin(angle) * speed;

      // Cyan/Blue RO-style spark color
      if (Math.random() > 0.45) {
        p.r = 0.0; p.g = 0.82; p.b = 1.0; // Neon Cyan #00D2FF
      } else {
        p.r = 0.05; p.g = 0.35; p.b = 1.0; // Deep Blue
      }
    }
  }

  public update(delta: number): void {
    // Early exit when no particles are active — zero CPU cost at idle
    if (this.activeCount === 0) return;

    const pos = this.geometry.getAttribute('position') as THREE.BufferAttribute;
    const col = this.geometry.getAttribute('color') as THREE.BufferAttribute;
    let dirty = false;

    for (let i = 0; i < this.maxParticles; i++) {
      const p = this.particles[i];
      const idx = i * 3;

      if (!p.active) {
        // Already parked offscreen from last deactivation — skip
        continue;
      }

      p.age += delta;
      if (p.age >= p.maxAge) {
        p.active = false;
        this.activeCount--;
        // Park particle offscreen
        this.positionsArr[idx]     = 99999;
        this.positionsArr[idx + 1] = 99999;
        this.positionsArr[idx + 2] = 99999;
        this.colorsArr[idx]     = 0;
        this.colorsArr[idx + 1] = 0;
        this.colorsArr[idx + 2] = 0;
        dirty = true;
        continue;
      }

      // Physics — integrate velocity + gravity
      p.vy -= 28.0 * delta;
      p.px += p.vx * delta;
      p.py += p.vy * delta;
      p.pz += p.vz * delta;

      // Fade out linearly with age
      const alpha = 1.0 - p.age / p.maxAge;

      this.positionsArr[idx]     = p.px;
      this.positionsArr[idx + 1] = p.py;
      this.positionsArr[idx + 2] = p.pz;
      this.colorsArr[idx]     = p.r * alpha;
      this.colorsArr[idx + 1] = p.g * alpha;
      this.colorsArr[idx + 2] = p.b * alpha;
      dirty = true;
    }

    // Only upload to GPU when something actually changed
    if (dirty) {
      pos.needsUpdate = true;
      col.needsUpdate = true;
    }
  }
}
