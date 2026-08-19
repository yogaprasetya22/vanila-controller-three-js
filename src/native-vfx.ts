import * as THREE from 'three';

// ─── Math helpers ─────────────────────────────────────────────────────────────

function bez(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const u = 1 - t;
  return u*u*u*p0 + 3*u*u*t*p1 + 3*u*t*t*p2 + t*t*t*p3;
}

function evalAlpha(keys: { value: number; pos: number }[], t: number): number {
  for (let i = 0; i < keys.length - 1; i++) {
    if (t <= keys[i + 1].pos) {
      const lt = (t - keys[i].pos) / (keys[i + 1].pos - keys[i].pos);
      return keys[i].value + lt * (keys[i + 1].value - keys[i].value);
    }
  }
  return keys[keys.length - 1].value;
}

function evalColor(keys: { value: THREE.Color; pos: number }[], t: number): THREE.Color {
  for (let i = 0; i < keys.length - 1; i++) {
    if (t <= keys[i + 1].pos) {
      const lt = (t - keys[i].pos) / (keys[i + 1].pos - keys[i].pos);
      return new THREE.Color(
        keys[i].value.r + lt * (keys[i + 1].value.r - keys[i].value.r),
        keys[i].value.g + lt * (keys[i + 1].value.g - keys[i].value.g),
        keys[i].value.b + lt * (keys[i + 1].value.b - keys[i].value.b),
      );
    }
  }
  return keys[keys.length - 1].value.clone();
}

function rng(a: number, b: number) { return a + Math.random() * (b - a); }

// LimitSpeedOverLife: only damp velocity when over limitSpeed (matches quarks behavior)
function limitSpeed(vel: THREE.Vector3, limit: number, dampen: number, dt: number) {
  const spd = vel.length();
  if (spd > limit) vel.multiplyScalar(1 - dampen * dt * 30);
}

// Shared billboard vertex + per-instance opacity/color/frame shader (handles both static and sheet textures)
// uTiles/vTiles = 1 for static textures
function makeInstMat(tex: THREE.Texture, uTiles: number, vTiles: number, additive = false): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uMap: { value: tex }, uTiles: { value: new THREE.Vector2(uTiles, vTiles) } },
    vertexShader: `
      attribute float aFrame;
      attribute float aOpacity;
      attribute vec3  aColor;
      varying vec2  vUv;
      varying float vOpacity;
      varying vec3  vColor;
      uniform vec2  uTiles;
      void main() {
        float c = mod(aFrame, uTiles.x);
        float r = floor(aFrame / uTiles.x);
        vUv = vec2((c + uv.x) / uTiles.x, 1.0 - (r + 1.0 - uv.y) / uTiles.y);
        vOpacity = aOpacity;
        vColor   = aColor;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D uMap;
      varying vec2  vUv;
      varying float vOpacity;
      varying vec3  vColor;
      void main() {
        vec4 t = texture2D(uMap, vUv);
        if (t.a < 0.02) discard;
        gl_FragColor = vec4(t.rgb * vColor, t.a * vOpacity);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
}

function makeAttribs(mesh: THREE.InstancedMesh, count: number) {
  const aFrame   = new Float32Array(count);
  const aOpacity = new Float32Array(count);
  const aColor   = new Float32Array(count * 3);
  mesh.geometry.setAttribute('aFrame',   new THREE.InstancedBufferAttribute(aFrame,   1));
  mesh.geometry.setAttribute('aOpacity', new THREE.InstancedBufferAttribute(aOpacity, 1));
  mesh.geometry.setAttribute('aColor',   new THREE.InstancedBufferAttribute(aColor,   3));
  return { aFrame, aOpacity, aColor };
}

function flushAttribs(mesh: THREE.InstancedMesh) {
  mesh.instanceMatrix.needsUpdate = true;
  (mesh.geometry.getAttribute('aFrame')   as THREE.InstancedBufferAttribute).needsUpdate = true;
  (mesh.geometry.getAttribute('aOpacity') as THREE.InstancedBufferAttribute).needsUpdate = true;
  (mesh.geometry.getAttribute('aColor')   as THREE.InstancedBufferAttribute).needsUpdate = true;
}

function addInstMesh(scene: THREE.Scene, count: number, tex: THREE.Texture, uT: number, vT: number, additive = false) {
  const geo  = new THREE.PlaneGeometry(1, 1);
  const mat  = makeInstMat(tex, uT, vT, additive);
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.frustumCulled = false;
  scene.add(mesh);
  const attribs = makeAttribs(mesh, count);
  return { geo, mat, mesh, ...attribs };
}

const HIDE = new THREE.Matrix4().makeScale(0, 0, 0);

// ─── Color gradient constants (from quarks JSON) ─────────────────────────────

const DARK_BLUE_TO_GRAY = [
  { value: new THREE.Color(0, 0.3764706, 0.5647059), pos: 0 },
  { value: new THREE.Color(0.1764706, 0.18039216, 0.23529412), pos: 1 },
];
const WHITE_ALPHA_PEAK = [
  { value: 1, pos: 0 },
  { value: 1, pos: 0.9 },
  { value: 0, pos: 1 },
];
const SPARK_ALPHA = [
  { value: 0, pos: 0 },
  { value: 1, pos: 0.2235294 },
  { value: 1, pos: 0.8348668 },
  { value: 0, pos: 1 },
];
const GLOW_COLOR = [
  { value: new THREE.Color(0.7294118, 0.9764706, 1), pos: 0 },
  { value: new THREE.Color(0, 1, 1), pos: 1 },
];

// ─── NativeVFXManager ────────────────────────────────────────────────────────

export class NativeVFXManager {
  private scene: THREE.Scene;
  private camera: THREE.Camera;
  private activeFX: Array<{ update: (delta: number) => boolean }> = [];

  // image_0 = spark/smoke (256x256 static)
  // image_1 = glow ring  (512x512 static)
  // image_2 = cloud puff (512x512, 2x2 sheet)
  // image_3 = gas burst  (2048x1024, 3x3 sheet)
  private tex0: THREE.Texture;
  private tex1: THREE.Texture;
  private tex2: THREE.Texture;
  private tex3: THREE.Texture;

  constructor(scene: THREE.Scene, camera: THREE.Camera) {
    this.scene = scene;
    this.camera = camera;
    const L = new THREE.TextureLoader();
    this.tex0 = L.load('quarks/image_0_e2d016c1-ee6d-4aba-bb40-544689810e38.png');
    this.tex1 = L.load('quarks/image_1_5433af3e-1379-49bc-a649-f451c5db770f.png');
    this.tex2 = L.load('quarks/image_2_b9373c34-5c0c-4b91-846b-876741ea48d7.png');
    this.tex3 = L.load('quarks/image_3_81f9e1f8-c8eb-478e-99f7-28fbda4f4198.png');
  }

  // PONYTAIL: Faithful native port of CartoonBlueGasExplosion.json.
  // All counts, speeds, sizes, bezier curves from quarks JSON.
  // Ceiling: CPU per-particle updates with InstancedMesh.
  // Upgrade path: SharedArrayBuffer + WebWorker for particle physics.
  public spawnExplosion(x: number, y: number, z: number) {
    const O = new THREE.Vector3(x, y, z);
    const T = new THREE.Object3D();
    // cq is a REFERENCE to camera.quaternion — always current
    const cq = this.camera.quaternion;

    // ═══════════════════════════════════════════════════════════════
    // GlowEmitter — 1 particle, size=5.75, life=0.3, tex1 (static additive)
    // SizeOverLife: bezier(1,1,0.89,0.61) shrink
    // ColorOverLife: cyan→teal, alpha linear fade
    // ═══════════════════════════════════════════════════════════════
    const glowI = addInstMesh(this.scene, 1, this.tex1, 1, 1, true);
    // ground-flat, no billboard
    const glowPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(5.75, 5.75),
      new THREE.MeshBasicMaterial({ map: this.tex1, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })
    );
    glowPlane.rotation.x = -Math.PI / 2;
    glowPlane.position.copy(O).y += 0.05;
    this.scene.add(glowPlane);
    // We also need a billboard glow — the GlowEmitter in quarks is a billboard particle
    glowI.aColor.set([0.7294118, 0.9764706, 1]);
    glowI.aOpacity[0] = 1;
    glowI.aFrame[0] = 0;

    // ═══════════════════════════════════════════════════════════════
    // GasExplosionBlueEmitter — 4 particles, billboard, 3x3 sheet, tex3
    // size=2.2-2.3, life=0.17-0.3, speed=0.1
    // SizeOverLife bezier(0.587,0.952,1,1) grow
    // ColorOverLife white→cyan, alpha stays then drops
    // ═══════════════════════════════════════════════════════════════
    const GAS_COUNT = 4;
    const gasI = addInstMesh(this.scene, GAS_COUNT, this.tex3, 3, 3, false);
    const gasLife = Array.from({ length: GAS_COUNT }, () => 0);
    const gasMaxLife = Array.from({ length: GAS_COUNT }, () => rng(0.17, 0.3));
    const gasSize = Array.from({ length: GAS_COUNT }, () => rng(2.2, 2.3));
    const gasVel = Array.from({ length: GAS_COUNT }, () => {
      const a = Math.random() * Math.PI * 2;
      return new THREE.Vector3(Math.cos(a) * 0.1, 0, Math.sin(a) * 0.1);
    });

    // ═══════════════════════════════════════════════════════════════
    // CloudBurstEmitter — 14 particles, 2x2 sheet tex2
    // speed=1-8, life=0.6-0.7, size=0.9-1.2
    // LimitSpeed(0.5, 0.2): damp when faster than 0.5
    // ColorOverLife: dark blue→dark gray
    // ═══════════════════════════════════════════════════════════════
    const CLOUD_COUNT = 14;
    const cloudI = addInstMesh(this.scene, CLOUD_COUNT, this.tex2, 2, 2, false);
    const cloudLife    = Array.from({ length: CLOUD_COUNT }, () => 0);
    const cloudMaxLife = Array.from({ length: CLOUD_COUNT }, () => rng(0.6, 0.7));
    const cloudPos     = Array.from({ length: CLOUD_COUNT }, () => O.clone());
    const cloudVel: THREE.Vector3[] = [];
    const cloudSize    = Array.from({ length: CLOUD_COUNT }, () => rng(0.9, 1.2));
    const cloudRot     = Array.from({ length: CLOUD_COUNT }, () => rng(0, Math.PI * 2));
    const cloudFrame   = Array.from({ length: CLOUD_COUNT }, () => Math.floor(Math.random() * 4));

    for (let i = 0; i < CLOUD_COUNT; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi   = Math.acos(rng(-1, 1));
      const speed = rng(1, 8);
      cloudVel.push(new THREE.Vector3(
        Math.sin(phi) * Math.cos(theta) * speed,
        Math.sin(phi) * Math.sin(theta) * speed,
        Math.cos(phi) * speed
      ));
    }

    // ═══════════════════════════════════════════════════════════════
    // SmokeTrailEmitter — 7 particles, speed=25-40, life=0.3-0.55
    // tex0 (static additive), size=0.24-0.27, gravity=-9.8
    // LimitSpeed(2, 0.25): damp only when >2 m/s
    // Sub-emits TrailEmitter along its path (EmitSubParticleSystem mode=1)
    // ═══════════════════════════════════════════════════════════════
    const SMOKE_COUNT = 7;
    const smokeI = addInstMesh(this.scene, SMOKE_COUNT, this.tex0, 1, 1, true);
    const smokeLife    = Array.from({ length: SMOKE_COUNT }, () => 0);
    const smokeMaxLife = Array.from({ length: SMOKE_COUNT }, () => rng(0.3, 0.55));
    const smokePos     = Array.from({ length: SMOKE_COUNT }, () => O.clone());
    const smokeVel: THREE.Vector3[] = [];
    const smokeSize    = Array.from({ length: SMOKE_COUNT }, () => rng(0.24, 0.27));
    const smokeTimer   = Array.from({ length: SMOKE_COUNT }, () => 0);

    for (let i = 0; i < SMOKE_COUNT; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi   = Math.acos(rng(-1, 1));
      const speed = rng(25, 40);
      smokeVel.push(new THREE.Vector3(
        Math.sin(phi) * Math.cos(theta) * speed,
        Math.sin(phi) * Math.sin(theta) * speed,
        Math.cos(phi) * speed
      ));
      // start color = cyan (0.388, 0.976, 1)
      smokeI.aColor[i * 3 + 0] = 0.388;
      smokeI.aColor[i * 3 + 1] = 0.976;
      smokeI.aColor[i * 3 + 2] = 1.0;
    }

    // ═══════════════════════════════════════════════════════════════
    // TrailEmitter — sub-particles spawned along SmokeTrail path
    // speed=0 (from point), life=0.25-0.6, size bezier
    // ForceY=+0.98 (rise up), ColorOverLife dark blue→dark gray
    // ═══════════════════════════════════════════════════════════════
    const MAX_TRAILS = 500;
    const trailI = addInstMesh(this.scene, MAX_TRAILS, this.tex2, 2, 2, false);
    for (let i = 0; i < MAX_TRAILS; i++) {
      trailI.mesh.setMatrixAt(i, HIDE);
      trailI.aOpacity[i] = 0;
    }
    trailI.mesh.instanceMatrix.needsUpdate = true;

    interface Trail {
      pos: THREE.Vector3;
      vel: THREE.Vector3;
      age: number;
      maxLife: number;
      startScale: number;
      rot: number;
      frame: number;
    }
    const trails: Trail[] = [];

    // ═══════════════════════════════════════════════════════════════
    // SparksEmitter — 13 particles, speed=12-28, life=0.25-0.35
    // tex0 (static additive), size=0.07, gravity=-9.8
    // LimitSpeed(1, 0.2), alpha 0→1→1→0
    // ═══════════════════════════════════════════════════════════════
    const SPARK_COUNT = 13;
    const sparkI = addInstMesh(this.scene, SPARK_COUNT, this.tex0, 1, 1, true);
    const sparkLife    = Array.from({ length: SPARK_COUNT }, () => 0);
    const sparkMaxLife = Array.from({ length: SPARK_COUNT }, () => rng(0.25, 0.35));
    const sparkPos: THREE.Vector3[] = [];
    const sparkVel: THREE.Vector3[] = [];

    for (let i = 0; i < SPARK_COUNT; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi   = Math.acos(rng(-1, 1));
      const r     = 0.25; // sphere shell radius
      const speed = rng(12, 28);
      sparkPos.push(new THREE.Vector3(
        x + Math.sin(phi) * Math.cos(theta) * r,
        y + Math.sin(phi) * Math.sin(theta) * r,
        z + Math.cos(phi) * r
      ));
      sparkVel.push(new THREE.Vector3(
        Math.sin(phi) * Math.cos(theta) * speed,
        Math.sin(phi) * Math.sin(theta) * speed,
        Math.cos(phi) * speed
      ));
      // color = cyan
      sparkI.aColor[i * 3 + 0] = 0.388;
      sparkI.aColor[i * 3 + 1] = 0.925;
      sparkI.aColor[i * 3 + 2] = 1.0;
    }

    let age = 0;

    this.activeFX.push({
      update: (dt: number) => {
        age += dt;

        // All particles expired → dispose
        if (age > 2.5 && trails.length === 0) {
          this.scene.remove(glowPlane);
          [glowI, gasI, smokeI, trailI, cloudI, sparkI].forEach(em => {
            this.scene.remove(em.mesh);
            em.geo.dispose();
            em.mat.dispose();
            em.mesh.dispose();
          });
          glowPlane.geometry.dispose();
          (glowPlane.material as THREE.Material).dispose();
          return false;
        }

        // ── Glow ground decal (life=0.3s) ──
        const glowT = Math.min(1, age / 0.3);
        glowPlane.scale.setScalar(1.0 + glowT * 3.0);
        (glowPlane.material as THREE.MeshBasicMaterial).opacity = 1 - glowT;

        // Glow billboard particle
        if (age < 0.3) {
          const gsz = 5.75 * 2.0 * bez(1, 1, 0.89311555, 0.61313975, glowT);
          const gc  = evalColor(GLOW_COLOR, glowT);
          const ga  = 1 - glowT;
          glowI.aColor.set([gc.r, gc.g, gc.b]);
          glowI.aOpacity[0] = ga;
          T.position.copy(O);
          T.quaternion.copy(cq);
          T.scale.setScalar(gsz);
          T.updateMatrix();
          glowI.mesh.setMatrixAt(0, T.matrix);
        } else {
          glowI.mesh.setMatrixAt(0, HIDE);
          glowI.aOpacity[0] = 0;
        }
        flushAttribs(glowI.mesh);

        // ── GasExplosionBlue (3x3 sheet, billboards) ──
        for (let i = 0; i < GAS_COUNT; i++) {
          gasLife[i] += dt;
          const pct = Math.min(1, gasLife[i] / gasMaxLife[i]);
          if (gasLife[i] >= gasMaxLife[i]) { gasI.mesh.setMatrixAt(i, HIDE); gasI.aOpacity[i] = 0; continue; }

          gasVel[i].multiplyScalar(1 - 0.09 * dt * 30);
          const frame = Math.min(8, Math.floor(bez(0, 3, 6, 9, pct)));
          const alpha = evalAlpha([{ value: 1, pos: 0 }, { value: 1, pos: 0.9 }, { value: 0, pos: 1 }], pct);
          // Color: white → cyan
          const gr = 1 + pct * (0.44313726 - 1);
          const gg = 1 + pct * (0.9529412  - 1);
          const gb = 1.0;
          const gsz = gasSize[i] * 2.0 * bez(0.58750004, 0.9525568, 1, 1, pct);

          gasI.aFrame[i]       = frame;
          gasI.aOpacity[i]     = alpha;
          gasI.aColor[i*3+0]   = gr;
          gasI.aColor[i*3+1]   = gg;
          gasI.aColor[i*3+2]   = gb;

          T.position.copy(O); T.position.addScaledVector(gasVel[i], gasLife[i]);
          T.quaternion.copy(cq);
          T.scale.setScalar(gsz);
          T.updateMatrix();
          gasI.mesh.setMatrixAt(i, T.matrix);
        }
        flushAttribs(gasI.mesh);

        // ── SmokeTrail + sub-emitter ──
        for (let i = 0; i < SMOKE_COUNT; i++) {
          smokeLife[i] += dt;
          const pct = Math.min(1, smokeLife[i] / smokeMaxLife[i]);
          if (smokeLife[i] >= smokeMaxLife[i]) { smokeI.mesh.setMatrixAt(i, HIDE); smokeI.aOpacity[i] = 0; continue; }

          // Gravity -9.8 then LimitSpeed(2, 0.25)
          smokeVel[i].y -= 9.8 * dt;
          limitSpeed(smokeVel[i], 2, 0.25, dt);
          smokePos[i].addScaledVector(smokeVel[i], dt);

          // SizeOverLife bezier(0.77,0.77,0.78,0.47)
          const ssz = smokeSize[i] * 2.0 * bez(0.7692308, 0.7692308, 0.7843341, 0.46901894, pct);
          // Alpha: white, 1→0 at end (WHITE_ALPHA_PEAK)
          const sa = evalAlpha(WHITE_ALPHA_PEAK, pct);

          smokeI.aFrame[i]     = 0;
          smokeI.aOpacity[i]   = sa;
          // color stays cyan

          T.position.copy(smokePos[i]);
          T.quaternion.copy(cq);
          T.scale.setScalar(ssz);
          T.updateMatrix();
          smokeI.mesh.setMatrixAt(i, T.matrix);

          // Spawn TrailEmitter sub-particles (EmitSubParticleSystem mode=1 = on birth+lifetime)
          smokeTimer[i] += dt;
          if (smokeTimer[i] > 0.02 && trails.length < MAX_TRAILS - 10) {
            smokeTimer[i] = 0;
            // startSize: bezier(1,1,0.569,0.569) * random scale
            const ts = bez(1, 1, 0.56875, 0.56875, Math.random());
            trails.push({
              pos: smokePos[i].clone(),
              vel: new THREE.Vector3(
                (Math.random() - 0.5) * 0.3,
                0,
                (Math.random() - 0.5) * 0.3
              ),
              age: 0,
              maxLife: rng(0.25, 0.6),
              startScale: ts,
              rot: rng(0, Math.PI * 2),
              frame: Math.floor(Math.random() * 4),
            });
          }
        }
        flushAttribs(smokeI.mesh);

        // ── Trail sub-particles ──
        for (let i = trails.length - 1; i >= 0; i--) {
          const tr = trails[i];
          tr.age += dt;
          if (tr.age >= tr.maxLife) { trails.splice(i, 1); }
        }

        let ri = 0;
        for (const tr of trails) {
          if (ri >= MAX_TRAILS) break;
          const pct = tr.age / tr.maxLife;

          // ForceY=+0.98 (rises), LimitSpeed(0, 0.05) = heavy drag
          tr.vel.y += 0.98 * dt;
          limitSpeed(tr.vel, 0.01, 0.05, dt);
          tr.pos.addScaledVector(tr.vel, dt);

          // SizeOverLife: piecewise bezier from JSON
          let tsz: number;
          const bp = 0.21464643;
          if (pct < bp) {
            tsz = bez(0.27548078, 0.27548078, 0.7724670, 0.77080387, pct / bp);
          } else {
            tsz = bez(0.77080387, 0.7647184, 0.6540969, 0, (pct - bp) / (1 - bp));
          }

          const tc = evalColor(DARK_BLUE_TO_GRAY, pct);
          const ta = evalAlpha(WHITE_ALPHA_PEAK, pct);

          trailI.aFrame[ri]     = tr.frame;
          trailI.aOpacity[ri]   = ta;
          trailI.aColor[ri*3+0] = tc.r;
          trailI.aColor[ri*3+1] = tc.g;
          trailI.aColor[ri*3+2] = tc.b;

          T.position.copy(tr.pos);
          T.quaternion.copy(cq);
          T.rotateZ(tr.rot + tr.age * 1.2);
          T.scale.setScalar(tr.startScale * tsz * 3.5);
          T.updateMatrix();
          trailI.mesh.setMatrixAt(ri, T.matrix);
          ri++;
        }
        for (let i = ri; i < MAX_TRAILS; i++) {
          trailI.mesh.setMatrixAt(i, HIDE);
          trailI.aOpacity[i] = 0;
        }
        flushAttribs(trailI.mesh);

        // ── CloudBurst (2x2 sheet, slower) ──
        for (let i = 0; i < CLOUD_COUNT; i++) {
          cloudLife[i] += dt;
          const pct = Math.min(1, cloudLife[i] / cloudMaxLife[i]);
          if (cloudLife[i] >= cloudMaxLife[i]) { cloudI.mesh.setMatrixAt(i, HIDE); cloudI.aOpacity[i] = 0; continue; }

          // LimitSpeed(0.5, 0.2)
          limitSpeed(cloudVel[i], 0.5, 0.2, dt);
          cloudPos[i].addScaledVector(cloudVel[i], dt);
          cloudRot[i] += (Math.random() - 0.5) * 0.8 * dt;

          // SizeOverLife: bezier(1,1,0.67,0) shrink
          const csz = cloudSize[i] * 2.0 * bez(1, 1, 0.6666666, 0, pct);
          const cc = evalColor(DARK_BLUE_TO_GRAY, pct);
          const ca = evalAlpha(WHITE_ALPHA_PEAK, pct);

          cloudI.aFrame[i]     = cloudFrame[i]; // fixed frame per particle
          cloudI.aOpacity[i]   = ca;
          cloudI.aColor[i*3+0] = cc.r;
          cloudI.aColor[i*3+1] = cc.g;
          cloudI.aColor[i*3+2] = cc.b;

          T.position.copy(cloudPos[i]);
          T.quaternion.copy(cq);
          T.rotateZ(cloudRot[i]);
          T.scale.setScalar(csz);
          T.updateMatrix();
          cloudI.mesh.setMatrixAt(i, T.matrix);
        }
        flushAttribs(cloudI.mesh);

        // ── Sparks (additive, gravity, limit speed) ──
        for (let i = 0; i < SPARK_COUNT; i++) {
          sparkLife[i] += dt;
          const pct = Math.min(1, sparkLife[i] / sparkMaxLife[i]);
          if (sparkLife[i] >= sparkMaxLife[i]) { sparkI.mesh.setMatrixAt(i, HIDE); sparkI.aOpacity[i] = 0; continue; }

          sparkVel[i].y -= 9.8 * dt;
          limitSpeed(sparkVel[i], 1, 0.2, dt);
          sparkPos[i].addScaledVector(sparkVel[i], dt);

          // SizeOverLife: bezier(1,1,0.67,0) → final size = 0.07 * 2.0
          const ssz = 0.07 * 2.0 * bez(1, 1, 0.6666666, 0, pct);
          const sa  = evalAlpha(SPARK_ALPHA, pct);

          sparkI.aFrame[i]     = 0;
          sparkI.aOpacity[i]   = sa;
          // color stays cyan (set at init)

          T.position.copy(sparkPos[i]);
          T.quaternion.copy(cq);
          T.scale.setScalar(ssz);
          T.updateMatrix();
          sparkI.mesh.setMatrixAt(i, T.matrix);
        }
        flushAttribs(sparkI.mesh);

        return true;
      }
    });
  }

  public update(delta: number) {
    for (let i = this.activeFX.length - 1; i >= 0; i--) {
      if (!this.activeFX[i].update(delta)) this.activeFX.splice(i, 1);
    }
  }
}
