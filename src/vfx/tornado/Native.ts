import * as THREE from 'three';
import { CHARACTER_CONFIG } from '../../character/character-config';

interface SmokeParticle {
  x: number;
  y: number;
  z: number;
  angle: number;
  radius: number;
  speedY: number;
  spinSpeed: number;
  size: number;
  age: number;
  maxLife: number;
  rot: number;
  rotSpeed: number;
  opacity: number;
}

export class CartoonTornadoNativeVFX {
  private scene: THREE.Scene;
  private camera: THREE.Camera;
  private activeFX: Array<{
    outerMesh1: THREE.Mesh;
    outerMesh2: THREE.Mesh;
    flameMesh: THREE.Mesh;
    ringMesh: THREE.Mesh;
    smokeMesh: THREE.InstancedMesh;
    outerMat1: THREE.ShaderMaterial;
    outerMat2: THREE.ShaderMaterial;
    flameMat: THREE.ShaderMaterial;
    ringMat: THREE.ShaderMaterial;
    smokeMat: THREE.ShaderMaterial;
    particles: SmokeParticle[];
    age: number;
    maxLife: number;
    spawnPos: THREE.Vector3;
  }> = [];

  private tex0!: THREE.Texture;
  private tex1!: THREE.Texture;
  private tex3!: THREE.Texture;
  
  private outerGeometry1: THREE.BufferGeometry;
  private outerGeometry2: THREE.BufferGeometry;
  private flameGeometry: THREE.BufferGeometry;
  private ringGeometry: THREE.BufferGeometry;
  private smokeGeometry: THREE.BufferGeometry;

  constructor(scene: THREE.Scene, camera: THREE.Camera) {
    this.scene = scene;
    this.camera = camera;

    // Load textures
    const L = new THREE.TextureLoader();
    
    // Disable mipmapping (minFilter = THREE.LinearFilter) to keep contrast sharp at distance.
    this.tex0 = L.load('/vfx/tornado/tex_0.png'); // Turbulence
    this.tex0.wrapS = THREE.RepeatWrapping;
    this.tex0.wrapT = THREE.RepeatWrapping;
    this.tex0.minFilter = THREE.LinearFilter;
    this.tex0.generateMipmaps = false;

    this.tex1 = L.load('/vfx/tornado/tex_1.png'); // Vein
    this.tex1.wrapS = THREE.RepeatWrapping;
    this.tex1.wrapT = THREE.RepeatWrapping;
    this.tex1.minFilter = THREE.LinearFilter;
    this.tex1.generateMipmaps = false;

    this.tex3 = L.load('/vfx/tornado/tex_3.png'); // Flame texture
    this.tex3.wrapS = THREE.RepeatWrapping;
    this.tex3.wrapT = THREE.RepeatWrapping;
    this.tex3.minFilter = THREE.LinearFilter;
    this.tex3.generateMipmaps = false;

    // Double-layer wind geometries
    this.outerGeometry1 = new THREE.CylinderGeometry(2.3, 0.45, 4.5, 32, 64, true);
    this.outerGeometry2 = new THREE.CylinderGeometry(1.9, 0.35, 4.5, 32, 64, true);

    // Inner Flame geometry nested inside (smaller radius 1.4 -> 0.25)
    this.flameGeometry = new THREE.CylinderGeometry(1.4, 0.25, 4.5, 32, 64, true);

    // Plane geometry for base ground vortex ring
    this.ringGeometry = new THREE.PlaneGeometry(5.0, 5.0);

    // Quad for instanced smoke particles
    this.smokeGeometry = new THREE.PlaneGeometry(1.0, 1.0);
  }

  public spawn(x: number, y: number, z: number) {
    const maxParticles = 100;

    // Shader Factory for the layered wind/flame meshes
    const createWindShader = (twistSpeed: number, twistTension: number, stepThreshold: number, colorShift: number, textureFlowSpeed: number, colorVal: THREE.Color, map0Tex: THREE.Texture) => {
      return new THREE.ShaderMaterial({
        uniforms: {
          uMap0: { value: map0Tex },
          uMap1: { value: this.tex1 },
          uTime: { value: 0 },
          uColor: { value: colorVal },
          uOpacity: { value: 1.0 },
          uSpawnY: { value: y }, // Ground spawn level uniform
        },
        vertexShader: `
          uniform float uTime;
          varying vec2 vUv;
          varying float vHeightY;
          varying float vAngle;
          varying vec3 vWorldPos;

          void main() {
            vUv = uv;
            vHeightY = position.y;

            vec3 pos = position;

            // ANCHOR: smoothstep from 0 at the bottom (Y=-2.0) to 1.0 slightly higher (Y=-1.3).
            float anchor = smoothstep(-2.0, -1.3, position.y);

            // GPU Twist (Slower spin speeds)
            float speed = ${twistSpeed.toFixed(1)};
            float tension = ${twistTension.toFixed(1)};
            float angle = (position.y * tension - uTime * speed) * anchor;
            vAngle = angle;
            
            float cosA = cos(angle);
            float sinA = sin(angle);
            
            float rx = pos.x * cosA - pos.z * sinA;
            float rz = pos.x * sinA + pos.z * cosA;
            pos.x = rx;
            pos.z = rz;

            // Wobble sway
            pos.x += sin(position.y * 2.0 - uTime * 2.5) * 0.22 * anchor;
            pos.z += cos(position.y * 2.0 - uTime * 2.5) * 0.22 * anchor;

            // Outer expansion ripples
            float pulse = sin((position.y + uTime * 8.0) * 2.5) * 0.05 * anchor;
            pos.xz *= (1.0 + pulse);

            vec4 worldPos = modelMatrix * vec4(pos, 1.0);
            vWorldPos = worldPos.xyz;
            gl_Position = projectionMatrix * viewMatrix * worldPos;
          }
        `,
        fragmentShader: `
          uniform sampler2D uMap0;
          uniform sampler2D uMap1;
          uniform float uTime;
          uniform vec3 uColor;
          uniform float uOpacity;
          uniform float uSpawnY;
          varying vec2 vUv;
          varying float vHeightY;
          varying float vAngle;
          varying vec3 vWorldPos;

          void main() {
            // WORLD-SPACE Y DISCARD: Instantly eliminates any fragment leaking below ground level
            if (vWorldPos.y < uSpawnY + 0.35) discard;

            vec2 rotUv = vUv;
            rotUv.x += vAngle / 6.2831853;

            // Slower texture scroll flow
            float flowSpeed = ${textureFlowSpeed.toFixed(1)};
            vec2 uvFlow0 = rotUv * vec2(2.0, 1.0) + vec2(0.0, -uTime * flowSpeed);
            vec2 uvFlow1 = rotUv * vec2(1.5, 1.5) + vec2(0.0, -uTime * (flowSpeed * 1.5));

            float t0 = texture2D(uMap0, uvFlow0).r;
            float t1 = texture2D(uMap1, uvFlow1).g;

            // USE MAX(t0, t1) instead of averaging them!
            float combined = max(t0, t1);

            // Toon wisp threshold
            float band = step(${stepThreshold.toFixed(2)}, combined);

            // Vertical fade bounds
            float vertFade = smoothstep(-2.0, -1.6, vUv.y * 4.5 - 2.25) * smoothstep(2.25, 1.4, vUv.y * 4.5 - 2.25);

            float alpha = band * vertFade * uOpacity;
            if (alpha < 0.08) discard;

            vec3 finalColor = uColor * ${colorShift.toFixed(2)};

            gl_FragColor = vec4(finalColor, alpha * 0.95);
          }
        `,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });
    };

    const cfgColor = new THREE.Color(CHARACTER_CONFIG.skills.tornado.hudColor);

    // Layer 1: Outer wind mesh - Highlight tinted
    const outerMat1 = createWindShader(3.5, 1.6, 0.78, 1.0, 2.0, cfgColor.clone().lerp(new THREE.Color(1, 1, 1), 0.5), this.tex0);
    // Layer 2: Inner wind mesh - Base color
    const outerMat2 = createWindShader(2.5, 1.1, 0.71, 0.85, 1.5, cfgColor, this.tex0);

    // Layer 3: Nested Flame Layer - Base color
    const flameMat = createWindShader(4.5, 1.4, 0.58, 1.0, 2.5, cfgColor, this.tex3);

    // 2. SUBTLE GROUND VORTEX RING MATERIAL
    const ringMat = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: this.tex1 },
        uTime: { value: 0 },
        uColor: { value: cfgColor.clone() }, // Matching base color
        uOpacity: { value: 1.0 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D uMap;
        uniform float uTime;
        uniform vec3 uColor;
        uniform float uOpacity;
        varying vec2 vUv;

        void main() {
          vec2 uvCenter = vUv - vec2(0.5);
          float radius = length(uvCenter) * 2.0;
          float angle = atan(uvCenter.y, uvCenter.x) / (2.0 * 3.14159) + 0.5;

          // Polar coord scrolling to make a spiraling swirl wind base on floor
          vec2 ringUv = vec2(radius * 1.6 - uTime * 0.4, angle - uTime * 0.7);
          float val = texture2D(uMap, ringUv).r;

          // Subtle thin toon ring bands
          float ringBand = step(0.55, val);
          
          // Soft mask: fades out at outer edge (0.95) and center (0.25)
          float ringShape = smoothstep(0.95, 0.7, radius) * smoothstep(0.15, 0.4, radius);

          float alpha = ringBand * ringShape * uOpacity;
          if (alpha < 0.08) discard;

          gl_FragColor = vec4(uColor, alpha * 0.75);
        }
      `,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });

    // 3. INSTANCED SMOKE PARTICLE MATERIAL
    const smokeMat = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: this.tex0 },
        uOpacity: { value: 1.0 },
        uSpawnY: { value: y }, // Ground spawn level uniform
      },
      vertexShader: `
        attribute vec4 aColorAlpha;
        varying vec2 vUv;
        varying vec4 vColorAlpha;
        varying vec3 vWorldPos;

        void main() {
          vUv = uv;
          vColorAlpha = aColorAlpha;
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vWorldPos = worldPos.xyz;
          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: `
        uniform sampler2D uMap;
        uniform float uOpacity;
        uniform float uSpawnY;
        varying vec2 vUv;
        varying vec4 vColorAlpha;
        varying vec3 vWorldPos;

        void main() {
          // WORLD-SPACE Y DISCARD: Prevents smoke quad bottom halves from leaking below the ground
          if (vWorldPos.y < uSpawnY + 0.35) discard;

          float dist = length(vUv - vec2(0.5));
          float radialFade = smoothstep(0.5, 0.25, dist);

          float noise = texture2D(uMap, vUv).r;
          float smokeEdge = step(0.38, noise);

          float alpha = smokeEdge * radialFade * vColorAlpha.a * uOpacity;
          if (alpha < 0.05) discard;

          gl_FragColor = vec4(vColorAlpha.rgb, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.NormalBlending,
    });

    const outerMesh1 = new THREE.Mesh(this.outerGeometry1, outerMat1);
    const outerMesh2 = new THREE.Mesh(this.outerGeometry2, outerMat2);
    const flameMesh = new THREE.Mesh(this.flameGeometry, flameMat);
    const ringMesh = new THREE.Mesh(this.ringGeometry, ringMat);
    const smokeMesh = new THREE.InstancedMesh(this.smokeGeometry, smokeMat, maxParticles);
    
    const colorAlphaArray = new Float32Array(maxParticles * 4);
    smokeMesh.geometry.setAttribute('aColorAlpha', new THREE.InstancedBufferAttribute(colorAlphaArray, 4));

    outerMesh1.position.set(x, y + 2.0, z);
    outerMesh2.position.set(x, y + 2.0, z);
    flameMesh.position.set(x, y + 2.0, z);
    ringMesh.position.set(x, y + 0.03, z); // Positioned slightly above ground floor
    ringMesh.rotation.x = -Math.PI / 2;
    smokeMesh.position.set(x, y, z);

    outerMesh1.scale.set(0.01, 0.01, 0.01);
    outerMesh2.scale.set(0.01, 0.01, 0.01);
    flameMesh.scale.set(0.01, 0.01, 0.01);
    ringMesh.scale.set(0.01, 0.01, 0.01);
    smokeMesh.scale.set(0.01, 0.01, 0.01);

    this.scene.add(outerMesh1);
    this.scene.add(outerMesh2);
    this.scene.add(flameMesh);
    this.scene.add(ringMesh);
    this.scene.add(smokeMesh);

    const particles: SmokeParticle[] = [];
    for (let i = 0; i < maxParticles; i++) {
      particles.push(this.createSmokeParticle());
    }

    this.activeFX.push({
      outerMesh1,
      outerMesh2,
      flameMesh,
      ringMesh,
      smokeMesh,
      outerMat1,
      outerMat2,
      flameMat,
      ringMat,
      smokeMat,
      particles,
      age: 0,
      maxLife: 3.5,
      spawnPos: new THREE.Vector3(x, y, z),
    });
  }

  private createSmokeParticle(): SmokeParticle {
    const age = Math.random() * -1.5;
    const maxLife = 1.2 + Math.random() * 0.8;
    
    // Slower upward and spin speeds for smoke particles
    const speedY = 0.5 + Math.random() * 0.5;
    const spinSpeed = 0.8 + Math.random() * 0.8;
    const radius = 0.2 + Math.random() * 0.6;

    return {
      x: 0,
      y: 0,
      z: 0,
      angle: Math.random() * Math.PI * 2,
      radius,
      speedY,
      spinSpeed,
      size: 1.0 + Math.random() * 1.0,
      age,
      maxLife,
      rot: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 0.8,
      opacity: 0.5 + Math.random() * 0.3,
    };
  }

  public update(delta: number) {
    const dummy = new THREE.Object3D();
    const cfgColor = new THREE.Color(CHARACTER_CONFIG.skills.tornado.hudColor);
    const baseColor = cfgColor.clone();
    const highlightColor = new THREE.Color(1.0, 1.0, 1.0).lerp(cfgColor, 0.3);

    for (let i = this.activeFX.length - 1; i >= 0; i--) {
      const fx = this.activeFX[i];
      fx.age += delta;

      if (fx.age >= fx.maxLife) {
        this.scene.remove(fx.outerMesh1);
        this.scene.remove(fx.outerMesh2);
        this.scene.remove(fx.flameMesh);
        this.scene.remove(fx.ringMesh);
        this.scene.remove(fx.smokeMesh);
        fx.outerMat1.dispose();
        fx.outerMat2.dispose();
        fx.flameMat.dispose();
        fx.ringMat.dispose();
        fx.smokeMat.dispose();
        this.activeFX.splice(i, 1);
        continue;
      }

      // Update shader uniforms
      fx.outerMat1.uniforms.uTime.value = fx.age;
      fx.outerMat2.uniforms.uTime.value = fx.age;
      fx.flameMat.uniforms.uTime.value = fx.age;
      fx.ringMat.uniforms.uTime.value = fx.age;

      const progress = fx.age / fx.maxLife;
      let scale = 1.0;
      if (progress < 0.12) {
        scale = progress / 0.12;
      } else if (progress > 0.75) {
        scale = (1.0 - progress) / 0.25;
      }

      const sizeScale = scale * 1.1;
      fx.outerMesh1.scale.set(sizeScale, sizeScale, sizeScale);
      fx.outerMesh2.scale.set(sizeScale, sizeScale, sizeScale);
      fx.flameMesh.scale.set(sizeScale, sizeScale, sizeScale);
      fx.ringMesh.scale.set(sizeScale, sizeScale, sizeScale);
      fx.smokeMesh.scale.set(sizeScale, sizeScale, sizeScale);

      const attr = fx.smokeMesh.geometry.getAttribute('aColorAlpha') as THREE.InstancedBufferAttribute;
      const colorAlpha = attr.array as Float32Array;

      for (let p = 0; p < fx.particles.length; p++) {
        const pt = fx.particles[p];
        pt.age += delta;

        if (pt.age >= pt.maxLife) {
          Object.assign(pt, this.createSmokeParticle());
          pt.age = 0;
        }

        if (pt.age < 0) {
          dummy.scale.set(0, 0, 0);
          dummy.updateMatrix();
          fx.smokeMesh.setMatrixAt(p, dummy.matrix);
          continue;
        }

        pt.angle += pt.spinSpeed * delta;
        pt.y += pt.speedY * delta;
        
        const wobbleX = Math.sin(pt.y * 1.5 - fx.age * 1.5) * 0.18;
        const wobbleZ = Math.cos(pt.y * 1.5 - fx.age * 1.5) * 0.18;

        const coneRadius = pt.radius * (1.0 + pt.y * 0.65);

        pt.x = Math.cos(pt.angle) * coneRadius + wobbleX;
        pt.z = Math.sin(pt.angle) * coneRadius + wobbleZ;
        pt.rot += pt.rotSpeed * delta;

        const lifeRatio = pt.age / pt.maxLife;
        
        let ptScale = pt.size * sizeScale;
        if (lifeRatio < 0.2) {
          ptScale *= (lifeRatio / 0.2);
        } else {
          ptScale *= (1.0 - lifeRatio);
        }

        dummy.position.set(pt.x, pt.y, pt.z);
        dummy.rotation.copy(this.camera.rotation);
        dummy.rotation.z += pt.rot;
        dummy.scale.set(ptScale, ptScale, ptScale);
        dummy.updateMatrix();
        fx.smokeMesh.setMatrixAt(p, dummy.matrix);

        const pColor = baseColor.clone().lerp(highlightColor, lifeRatio);
        const pAlpha = pt.opacity * (1.0 - lifeRatio) * scale;

        const idx = p * 4;
        colorAlpha[idx] = pColor.r;
        colorAlpha[idx + 1] = pColor.g;
        colorAlpha[idx + 2] = pColor.b;
        colorAlpha[idx + 3] = pAlpha;
      }

      attr.needsUpdate = true;
      fx.smokeMesh.instanceMatrix.needsUpdate = true;

      if (progress > 0.75) {
        const fade = (1.0 - progress) / 0.25;
        fx.outerMat1.uniforms.uOpacity.value = fade;
        fx.outerMat2.uniforms.uOpacity.value = fade;
        fx.flameMat.uniforms.uOpacity.value = fade;
        fx.ringMat.uniforms.uOpacity.value = fade;
        fx.smokeMat.uniforms.uOpacity.value = fade;
      }
    }
  }
}
