import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { getTerrainHeight } from '../../simulation/constants';
import { createLowPolyCloudGeometry, createCartoonCloudMaterial } from './Clouds';

export class VisualTornado {
  public group: THREE.Group;
  private material: THREE.ShaderMaterial;
  private particles: THREE.Points;
  private stormClouds: THREE.Mesh[] = [];

  public startX = 0;
  public startZ = 0;
  public moveSpeed = 0.08;
  public moveRadius = 25;
  public timeOffset = 0;

  // Lifecycle States
  public state: 'spawning' | 'active' | 'disappearing' = 'spawning';
  public stateTime = 0;
  private uVisibility: { value: number };
  private activeDuration = 30.0;

  constructor(scene: THREE.Scene, startX = 45, startZ = -60, timeOffset = 0) {
    this.startX = startX;
    this.startZ = startZ;
    this.timeOffset = timeOffset;
    this.activeDuration = 30.0 + Math.random() * 20.0; // Randomize active duration per instance

    // Geometry: Cylinder with pivot at bottom
    const geometry = new THREE.CylinderGeometry(1, 1, 1, 32, 16, true);
    geometry.translate(0, 0.5, 0);

    // Uniforms
    const uniforms = {
      uTime: { value: 0 },
      uVisibility: { value: 0.0 }, // Start fully transparent
      uBaseColor: { value: new THREE.Color('#9c8a70') },
      uEmissive: { value: 1.0 },
      uTimeScale: { value: 0.15 },
      uParabolStrength: { value: 1.7 },
      uParabolOffset: { value: 0.4 },
      uParabolAmplitude: { value: 0.27 }
    };
    this.uVisibility = uniforms.uVisibility;

    // Shaders
    const vertexShader = /* glsl */ `
      uniform float uTime;
      uniform float uTimeScale;
      uniform float uParabolStrength;
      uniform float uParabolOffset;
      uniform float uParabolAmplitude;

      varying vec2 vUv;

      void main() {
        vUv = uv;

        // twistedCylinder deformation logic
        float angle = atan(position.z, position.x);
        float elevation = position.y;

        // Parabola radius
        float radius = pow(uParabolStrength * (elevation - uParabolOffset), 2.0) + uParabolAmplitude;

        // Turbulence waves
        float t = uTime * uTimeScale * 2.0;
        radius += sin(elevation * 20.0 - t + angle * 2.0) * 0.05;

        vec3 twistedPosition = vec3(
          cos(angle) * radius,
          elevation,
          sin(angle) * radius
        );

        vec4 worldPos = modelMatrix * vec4(twistedPosition, 1.0);
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `;

    const fragmentShader = /* glsl */ `
      uniform float uTime;
      uniform float uTimeScale;
      uniform float uVisibility;
      uniform vec3 uBaseColor;
      uniform float uEmissive;

      varying vec2 vUv;

      // 2D Procedural Noise
      float hash(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
      }

      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        float a = hash(i);
        float b = hash(i + vec2(1.0, 0.0));
        float c = hash(i + vec2(0.0, 1.0));
        float d = hash(i + vec2(1.0, 1.0));
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
      }

      vec2 skewedUv(vec2 uv, vec2 skew) {
        return vec2(
          uv.x + uv.y * skew.x,
          uv.y + uv.x * skew.y
        );
      }

      float tslRemap(float value, float inMin, float inMax) {
        return clamp((value - inMin) / (inMax - inMin), 0.0, 1.0);
      }

      void main() {
        float scaledTime = -uTime * uTimeScale;

        // Visibility modifier
        float visibilityModifier = (uVisibility - 1.0) * 4.0;

        // Smoothly fade out only at the extreme top and bottom edges (bottom 10% and top 15%)
        float edgeFade = smoothstep(0.0, 0.1, vUv.y) * smoothstep(1.0, 0.85, vUv.y);

        // ── Swirling Wind/Dust Noise Layers ──
        vec2 noise1Uv = vUv + vec2(scaledTime * 1.5, scaledTime * 1.5);
        noise1Uv = skewedUv(noise1Uv, vec2(-2.0, 0.5)) * vec2(12.0, 1.5);
        float n1 = tslRemap(noise(noise1Uv), 0.42, 0.65);

        vec2 noise2Uv = vUv + vec2(scaledTime * 1.0, scaledTime * 1.0);
        noise2Uv = skewedUv(noise2Uv, vec2(-2.0, 0.5)) * vec2(24.0, 4.0);
        float n2 = tslRemap(noise(noise2Uv), 0.42, 0.65);

        // Combine noises and apply edge fade & visibility
        float alpha = (n1 * n2) * edgeFade + visibilityModifier;
        alpha = smoothstep(0.05, 0.35, alpha);

        // Discard fully transparent pixels to optimize depth buffer writes
        if (alpha < 0.01) {
          discard;
        }

        // Beautiful sand/dust color gradient based on height
        vec3 finalColor = mix(uBaseColor * 0.6, uBaseColor * 1.1, vUv.y);

        gl_FragColor = vec4(finalColor, alpha * 0.35); // Translucent swirling wind look
      }
    `;

    this.material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader,
      fragmentShader,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      depthTest: true
    });

    this.group = new THREE.Group();

    // ── Swirling Particles (Dust Devil Effect) ──
    const particleCount = 200;
    const pGeometry = new THREE.BufferGeometry();
    const pPositions = new Float32Array(particleCount * 3);
    const pRandoms = new Float32Array(particleCount * 3); // x: speed, y: radius, z: phase

    for (let i = 0; i < particleCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 0.5 + Math.random() * 2.0;
      pPositions[i * 3] = Math.cos(angle) * radius;
      pPositions[i * 3 + 1] = Math.random() * 1.5; // starting y offset
      pPositions[i * 3 + 2] = Math.sin(angle) * radius;

      pRandoms[i * 3] = 3.0 + Math.random() * 5.0; // speed
      pRandoms[i * 3 + 1] = radius; // orbit radius
      pRandoms[i * 3 + 2] = Math.random() * Math.PI * 2; // starting phase
    }

    pGeometry.setAttribute('position', new THREE.BufferAttribute(pPositions, 3));
    pGeometry.setAttribute('aRandoms', new THREE.BufferAttribute(pRandoms, 3));

    const pVertexShader = /* glsl */ `
      uniform float uTime;
      attribute vec3 aRandoms; // x: speed, y: radius, z: phase
      varying float vAlpha;

      void main() {
        float speed = aRandoms.x;
        float radius = aRandoms.y;
        float phase = aRandoms.z;

        // Swirling orbit around center
        float angle = phase + uTime * speed;
        
        // Rise up continuously
        float height = position.y + fract(uTime * 0.15 + phase * 0.1) * 16.0; 
        
        // Conical expand: particles expand as they go higher
        float currentRadius = radius * (1.0 + height * 0.08); 

        vec3 orbitalPos = vec3(
          cos(angle) * currentRadius,
          height,
          sin(angle) * currentRadius
        );

        // Fade particles near top and bottom edges
        vAlpha = smoothstep(16.0, 12.0, height) * smoothstep(0.0, 1.5, height);

        vec4 worldPos = modelMatrix * vec4(orbitalPos, 1.0);
        vec4 mvPosition = viewMatrix * worldPos;
        gl_Position = projectionMatrix * mvPosition;

        // Size depends on distance and phase
        gl_PointSize = (18.0 / -mvPosition.z) * (1.0 + fract(phase) * 1.5);
      }
    `;

    const pFragmentShader = /* glsl */ `
      uniform vec3 uBaseColor;
      varying float vAlpha;

      void main() {
        // Render points as circles
        float dist = length(gl_PointCoord - vec2(0.5));
        if (dist > 0.5) discard;

        gl_FragColor = vec4(uBaseColor * 0.5, vAlpha * 0.5);
      }
    `;

    const pMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: uniforms.uTime,
        uBaseColor: uniforms.uBaseColor
      },
      vertexShader: pVertexShader,
      fragmentShader: pFragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest: true
    });

    this.particles = new THREE.Points(pGeometry, pMaterial);
    this.particles.frustumCulled = false;
    this.group.add(this.particles);

    // ── Materials: Split into BackSide and FrontSide to guarantee perfect WebGL transparency sorting ──
    const materialBack = new THREE.ShaderMaterial({
      uniforms,
      vertexShader,
      fragmentShader,
      transparent: true,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: true
    });

    const materialFront = new THREE.ShaderMaterial({
      uniforms,
      vertexShader,
      fragmentShader,
      transparent: true,
      side: THREE.FrontSide,
      depthWrite: false,
      depthTest: true
    });

    // Save material reference for updates
    this.material = materialFront;

    // ── Mesh 1: Inner Layer ──
    const mesh1Back = new THREE.Mesh(geometry, materialBack);
    mesh1Back.scale.set(5, 40, 5);
    mesh1Back.frustumCulled = false;
    this.group.add(mesh1Back);

    const mesh1Front = new THREE.Mesh(geometry, materialFront);
    mesh1Front.scale.set(5, 40, 5);
    mesh1Front.frustumCulled = false;
    this.group.add(mesh1Front);

    // ── Mesh 2: Outer Layer (Slightly larger, counter-rotating) ──
    const mesh2Back = new THREE.Mesh(geometry, materialBack);
    mesh2Back.scale.set(5.6, 39.8, 5.6);
    mesh2Back.rotation.y = Math.PI;
    mesh2Back.frustumCulled = false;
    this.group.add(mesh2Back);

    const mesh2Front = new THREE.Mesh(geometry, materialFront);
    mesh2Front.scale.set(5.6, 39.8, 5.6);
    mesh2Front.rotation.y = Math.PI;
    mesh2Front.frustumCulled = false;
    this.group.add(mesh2Front);

    // ── Storm Cloud Shrouds (Imported from Clouds.ts & Multiplied) ──
    const cloudGeom = createLowPolyCloudGeometry();
    const stormCloudMaterial = createCartoonCloudMaterial('#8c7b6c', '#54483b', 0.8);

    this.stormClouds = [];
    const seedRng = mulberry32(12345);
    for (let i = 0; i < 3; i++) {
      const cloudMesh = new THREE.Mesh(cloudGeom, stormCloudMaterial);
      cloudMesh.frustumCulled = false;
      
      // Arrange in a small dense swirling cluster at the top Y: 40
      const angle = (i / 3) * Math.PI * 2;
      const radius = 2.0 + seedRng() * 1.0;
      const xOffset = Math.cos(angle) * radius;
      const zOffset = Math.sin(angle) * radius;
      const yOffset = 40.0 + (seedRng() - 0.5) * 1.5; // Top layer (Y: 40)
      
      cloudMesh.position.set(xOffset, yOffset, zOffset);
      
      // Make them flat and wide
      const sc = 2.0 + seedRng() * 1.5;
      cloudMesh.scale.set(sc, sc * 0.5, sc);
      
      this.group.add(cloudMesh);
      this.stormClouds.push(cloudMesh);
    }

    scene.add(this.group);
  }

  public update(delta: number, elapsed: number, camPos: THREE.Vector3) {
    // 1. Lissajous random natural pathing (calculate position first for distance check)
    const t = elapsed * this.moveSpeed + this.timeOffset;
    const x = this.startX + Math.sin(t) * this.moveRadius;
    const z = this.startZ + Math.cos(t * 0.7) * this.moveRadius;
    const targetY = getTerrainHeight(x, z) - 0.2; // Pins to ground level
    let y = this.group.position.y;
    
    // Snap instantly on initial spawn or teleportation to prevent massive vertical floating trails
    if (this.stateTime <= delta * 2.5 || y === 0) {
      y = targetY;
    } else {
      y = THREE.MathUtils.lerp(y, targetY, 4.0 * delta); // Smooth follow lerp
    }

    this.group.position.set(x, y, z);

    // 2. ponytail: collapse visibility if further than 100 meters to save CPU/GPU overhead
    const distSq = this.group.position.distanceToSquared(camPos);
    if (distSq > 10000) { // 100m culling (100 * 100 = 10000)
      this.group.visible = false;
      return;
    }
    this.group.visible = true;

    // 3. Update uTime and state machine
    this.material.uniforms.uTime.value = elapsed;
    this.stateTime += delta;

    const spawnDuration = 4.0;
    const fadeDuration = 4.0;

    // Lifecycle Animation State Machine
    if (this.state === 'spawning') {
      const progress = Math.min(1.0, this.stateTime / spawnDuration);
      this.uVisibility.value = progress;
      // Grow out of the ground (scale and fade)
      this.group.scale.set(progress, progress, progress);

      if (progress >= 1.0) {
        this.state = 'active';
        this.stateTime = 0;
      }
    } else if (this.state === 'active') {
      this.uVisibility.value = 1.0;
      this.group.scale.set(1.0, 1.0, 1.0); // full base scale

      if (this.stateTime >= this.activeDuration) {
        this.state = 'disappearing';
        this.stateTime = 0;
      }
    } else if (this.state === 'disappearing') {
      const progress = Math.min(1.0, this.stateTime / fadeDuration);
      this.uVisibility.value = 1.0 - progress;
      // Shrink back into the ground (scale and fade)
      const scale = 1.0 - progress;
      this.group.scale.set(scale, scale, scale);

      if (progress >= 1.0) {
        // Teleport to a new random location in the forest bounds
        const side = Math.random() > 0.5 ? 1 : -1;
        this.startX = (85 + Math.random() * 150) * side;
        this.startZ = (80 + Math.random() * 150) * (Math.random() > 0.5 ? 1 : -1);
        this.timeOffset = Math.random() * 1000;
        this.activeDuration = 30.0 + Math.random() * 20.0; // Recalculate duration

        this.state = 'spawning';
        this.stateTime = 0;
      }
    }

    // Counter-rotate the outer meshes to create parallax thickness & swirl depth
    const mesh2Back = this.group.children[3] as THREE.Mesh;
    const mesh2Front = this.group.children[4] as THREE.Mesh;
    const rot = Math.PI - elapsed * 0.25;
    if (mesh2Back) mesh2Back.rotation.y = rot;
    if (mesh2Front) mesh2Front.rotation.y = rot;

    // Slowly spin the storm clouds on top
    this.stormClouds.forEach((cloud, idx) => {
      cloud.rotation.y = elapsed * (0.08 + idx * 0.04);
    });
  }
}

function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
