import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
export interface CameraOcclusionConfig {
  /** Radius of the cutout "hole" punched around the player chest. */
  maskRadius?: number;
  /** Cone radius at the camera end — widens the cutout near the cam. */
  nearConeRadius?: number;
  /** Hard-clip everything closer than N metres to camera. */
  nearClipDistance?: number;
  /** 0→1; where along cam→player the cone starts narrowing. */
  coneFalloff?: number;
  /** Extra Y offset above player.position.y used as the "chest" target. */
  playerHeightOffset?: number;
  /** Object names to skip from occlusion patching (exact match). */
  excludedNames?: string[];
  /** 'solid' = clean discard; 'stipple' = dithered checkerboard dissolve. */
  cutoutStyle?: 'solid' | 'stipple';
  // ── Leaf fade ──
  /** Minimum opacity for leaf materials blocking the cam→player segment. */
  leafMinOpacity?: number;
  /** Metres around the cam→player segment that triggers leaf fade. */
  leafFadeRadius?: number;
  /** Lerp speed for leaf fade (6 = snappy, 2 = cinematic). */
  leafFadeSpeed?: number;
  /**
   * Lerp speed for uniform smoothing — reduces jitter on thin trunks.
   * Higher = snappier but more jitter. Lower = smoother but slightly laggy.
   * Default: 8
   */
  uniformSmoothSpeed?: number;
}

const DEFAULTS: Required<CameraOcclusionConfig> = {
  maskRadius:         0.8,   // ponytail: kecilkan hole di sekitar player
  nearConeRadius:     1.6,   // ponytail: HALF dari sebelumnya — hapus blob merah besar
  nearClipDistance:   2.5,
  coneFalloff:        0.92,  // cone tetap sempit lebih lama → hanya area dekat player yang terbuka
  playerHeightOffset: 1.0,
  excludedNames: ['terrain', 'water', 'floor', 'rock', 'pebble', 'stone', 'boulder', 'rocks', 'boulders'],
  cutoutStyle:        'stipple',
  leafMinOpacity:     0.12,
  leafFadeRadius:     2.2,
  leafFadeSpeed:      6.0,
  uniformSmoothSpeed: 12.0,  // lebih responsif
};

// ---------------------------------------------------------------------------
// Shader uniform block
// ---------------------------------------------------------------------------
interface OcclusionUniforms {
  uPlayerPos:        { value: THREE.Vector3 };
  uCamPos:           { value: THREE.Vector3 };
  uMaskRadiusSq:     { value: number };
  uNearConeRadius:   { value: number };
  uNearClipDistance: { value: number };
  uConeFalloff:      { value: number };
  /** Soft-edge blend width in world metres (larger = wider fade, less pop) */
  uEdgeSoftness:     { value: number };
}

// ---------------------------------------------------------------------------
// Module-level scratch — zero alloc per frame
// ---------------------------------------------------------------------------
const _segStart   = new THREE.Vector3();
const _segEnd     = new THREE.Vector3();
const _closest    = new THREE.Vector3();
const _tmp        = new THREE.Vector3();
const _center     = new THREE.Vector3();
const _instMatrix = new THREE.Matrix4();
const _instPos    = new THREE.Vector3();

/** Squared distance from point P to segment A→B. */
function ptToSegDistSq(P: THREE.Vector3, A: THREE.Vector3, B: THREE.Vector3): number {
  _tmp.subVectors(B, A);
  const lenSq = _tmp.dot(_tmp);
  if (lenSq < 1e-8) return P.distanceToSquared(A);
  const t = Math.max(0, Math.min(1, _tmp.dot(_closest.subVectors(P, A)) / lenSq));
  _closest.copy(A).addScaledVector(_tmp, t);
  return P.distanceToSquared(_closest);
}

// ---------------------------------------------------------------------------
// Shader patch — call once per material (recompiles on next render)
// ---------------------------------------------------------------------------
function patchMaterial(
  mat: THREE.Material,
  uniforms: OcclusionUniforms,
  cutoutStyle: 'solid' | 'stipple',
  isLeafMat: boolean
): void {
  const prev = mat.onBeforeCompile;

  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    Object.assign(shader.uniforms, uniforms, {
      uIsLeaf:      { value: isLeafMat ? 1.0 : 0.0 },
      uEdgeSoftness: uniforms.uEdgeSoftness,
    });

    // ── Vertex shader: pass world-space position, object center, and scale to fragment ──
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `#include <common>
       varying vec3 vHoloWorldPos;
       varying vec3 vObjCenter;
       varying float vScale;`
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      `#include <project_vertex>
       vec4 _tmpWP = vec4(transformed, 1.0);
       #ifdef USE_INSTANCING
         _tmpWP = instanceMatrix * _tmpWP;
         vObjCenter = (modelMatrix * vec4(instanceMatrix[3].xyz, 1.0)).xyz;
         vScale = length(instanceMatrix[0].xyz);
       #else
         vObjCenter = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
         vScale = 1.0;
       #endif
       _tmpWP = modelMatrix * _tmpWP;
       vHoloWorldPos = _tmpWP.xyz;`
    );

    // ── Fragment shader: cone-shaped cutout with soft edge to eliminate jitter ──
    //  Uses smoothstep instead of hard step → no flickering on thin trunks.
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>
       uniform vec3  uPlayerPos;
       uniform vec3  uCamPos;
       uniform float uMaskRadiusSq;
       uniform float uNearConeRadius;
       uniform float uNearClipDistance;
       uniform float uConeFalloff;
       uniform float uIsLeaf;
       uniform float uEdgeSoftness;
       varying vec3  vHoloWorldPos;
       varying vec3  vObjCenter;
       varying float vScale;

       // 4×4 Bayer ordered dither — no branching, stable per-pixel pattern
       float dither4x4(vec2 position) {
           vec2 pos = mod(position, 4.0);
           float val = 0.0;
           val += mod(pos.x, 2.0) * 8.0;
           val += step(2.0, pos.x) * 4.0;
           val += mod(pos.y, 2.0) * 2.0;
           val += step(2.0, pos.y) * 1.0;
           return (val + 0.5) / 16.0;
       }`
    );

    // Soft-edge discard: instead of hard discard, use dither modulated by distance
    // from the cone boundary → smooth fade, zero jitter on thin trunks.
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <dithering_fragment>',
      `#include <dithering_fragment>
       {
         vec3 pa = vHoloWorldPos - uCamPos;
         vec3 ba = uPlayerPos - uCamPos;
         float baSq = max(dot(ba, ba), 1e-5);
         float hRaw = dot(pa, ba) / baSq;
         float h    = clamp(hRaw, 0.0, 1.0);

         if (hRaw < uConeFalloff) {
           float r    = mix(uNearConeRadius, sqrt(uMaskRadiusSq), h);
           vec3  perp = pa - (ba * h);
           float d    = length(perp);

           // Soft band: [r - softness, r + softness] → smooth alpha
           float soft  = max(uEdgeSoftness * r, 0.05);
           float alpha = smoothstep(r - soft, r + soft, d);
           // alpha=0 → inside cone (should discard), alpha=1 → outside (keep)
           // Use dither to convert fractional alpha into stable binary per-pixel
           float threshold = dither4x4(gl_FragCoord.xy);
           if (alpha < threshold) discard;
         }
       }`
    );
  };

  mat.needsUpdate = true;
}

// ---------------------------------------------------------------------------
// Leaf material detection — STRICT: only actual leaf/foliage materials
// Bark, trunk, branch, wood materials MUST return false so they stay visible
// ---------------------------------------------------------------------------
function isLeaf(mat: THREE.Material): boolean {
  if (mat.userData?.isLeaf === true) return true;
  if (mat.userData?.isBark === true || mat.userData?.isRock === true) return false;
  const n = mat.name.toLowerCase();
  if (/leaf|leaves|foliage/.test(n)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Per-material leaf fade state (WeakMap → auto-GC on dispose)
// ---------------------------------------------------------------------------
interface LeafMeta { base: number; cur: number }

// ---------------------------------------------------------------------------
// Tree mesh heuristic (strictly foliage/trees, exclude rocks and ground)
// ---------------------------------------------------------------------------
function isTreeMesh(object: THREE.Object3D): boolean {
  if (object.userData?.isLeaf === true) return true;
  if (object.userData?.isRock === true || object.userData?.isBark === true) return false;
  const n = object.name.toLowerCase();
  if (/rock|pebble|stone|boulder|ground|terrain|floor/.test(n)) return false;
  return /tree|pine|birch|maple|leaf|leaves|foliage/.test(n);
}

// ---------------------------------------------------------------------------
// CameraOcclusionManager (vanilla Three.js class)
// ---------------------------------------------------------------------------
export class CameraOcclusionManager {
  private cfg: Required<CameraOcclusionConfig>;
  private scene: THREE.Scene;
  private camera: THREE.Camera;
  private excludedNames: Set<string>;

  private uniforms: OcclusionUniforms;

  // Smooth target values — uniforms are lerped toward these each frame
  private _targetPlayerPos = new THREE.Vector3();
  private _targetCamPos    = new THREE.Vector3();

  // Patch queue (budgeted recompile)
  private claimed    = new WeakSet<THREE.Material>();
  private patchQueue: THREE.Material[] = [];

  // Leaf fade
  private leafMeta          = new WeakMap<THREE.Material, LeafMeta>();
  private leafMats:           THREE.Material[] = [];
  private leafFadeRadiusSq:   number;
  private treeMeshes:         (THREE.Mesh | THREE.InstancedMesh)[] = [];

  // Re-scan timer
  private scanTimer        = 0;
  private readonly SCAN_INTERVAL = 1.5; // seconds
  private readonly PATCH_BUDGET  = 4;   // materials per frame

  // Player position (set externally each frame)
  private playerPos = new THREE.Vector3();

  constructor(
    scene: THREE.Scene,
    camera: THREE.Camera,
    config: CameraOcclusionConfig = {}
  ) {
    this.cfg    = { ...DEFAULTS, ...config };
    this.scene  = scene;
    this.camera = camera;
    this.excludedNames    = new Set(this.cfg.excludedNames);
    this.leafFadeRadiusSq = this.cfg.leafFadeRadius * this.cfg.leafFadeRadius;

    this.uniforms = {
      uPlayerPos:        { value: new THREE.Vector3() },
      uCamPos:           { value: new THREE.Vector3() },
      uMaskRadiusSq:     { value: this.cfg.maskRadius * this.cfg.maskRadius },
      uNearConeRadius:   { value: this.cfg.nearConeRadius },
      uNearClipDistance: { value: this.cfg.nearClipDistance },
      uConeFalloff:      { value: this.cfg.coneFalloff },
      uEdgeSoftness:     { value: 0.10 }, // ponytail: 10% of cone → soft band ≈0.16m not 0.4m
    };

    // Initial scan
    this.scan();
  }

  /** Call this every frame with the local player's position and frame delta. */
  update(playerWorldPos: THREE.Vector3, delta: number): void {
    this.playerPos.copy(playerWorldPos);
    this.playerPos.y += this.cfg.playerHeightOffset;

    // Set smooth targets
    this._targetPlayerPos.copy(this.playerPos);
    this._targetCamPos.copy(this.camera.position);

    // Lerp GPU uniforms toward targets — eliminates hard snapping / jitter
    const t = Math.min(1.0, delta * this.cfg.uniformSmoothSpeed);
    this.uniforms.uPlayerPos.value.lerp(this._targetPlayerPos, t);
    this.uniforms.uCamPos.value.lerp(this._targetCamPos, t);

    // Drain patch queue at budget
    let patched = 0;
    while (this.patchQueue.length > 0 && patched < this.PATCH_BUDGET) {
      const mat = this.patchQueue.shift()!;
      patchMaterial(mat, this.uniforms, this.cfg.cutoutStyle, isLeaf(mat));
      patched++;
    }

    // Leaf transparency fade — DISABLED: causes GPU overdraw on instanced forests
    // this.updateLeafFade(delta);

    // Periodic re-scan
    this.scanTimer += delta;
    if (this.scanTimer >= this.SCAN_INTERVAL) {
      this.scanTimer = 0;
      this.scan();
    }
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private scan(): void {
    const next:   THREE.Material[] = [];
    const meshes: (THREE.Mesh | THREE.InstancedMesh)[] = [];

    this.scene.traverse((child) => {
      if (!isTreeMesh(child)) return;
      if (this.excludedNames.has(child.name)) return;
      if (child.userData?.excludeOcclusion === true) return;

      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh && !(mesh as any).isInstancedMesh) return;
      if (!mesh.material) return;

      meshes.push(mesh);

      const mats: THREE.Material[] = Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material];

      for (const mat of mats) {
        if (mat.userData?.excludeOcclusion === true) continue;
        if (!isLeaf(mat)) continue; // Only patch leaf/foliage, not bark

        // Queue for cutout shader patch
        if (!this.claimed.has(mat)) {
          this.claimed.add(mat);
          this.patchQueue.push(mat);
        }

        next.push(mat);

        // High-performance alpha clip — eliminates overdraw fillrate bottleneck
        const m = mat as THREE.MeshStandardMaterial;
        m.transparent = false;
        m.alphaTest   = 0.5;
        m.depthWrite  = true;
        m.needsUpdate = true;

        if (!this.leafMeta.has(mat)) {
          const base = m.opacity ?? 1.0;
          this.leafMeta.set(mat, { base, cur: base });
        }
      }
    });

    this.leafMats  = next;
    this.treeMeshes = meshes;
  }

  private updateLeafFade(delta: number): void {
    _segStart.copy(this.camera.position);
    _segEnd.copy(this.playerPos);

    const blockingMaterials = new Set<THREE.Material>();

    for (const mesh of this.treeMeshes) {
      const mats: THREE.Material[] = Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material];

      let meshBlocking = false;

      if ((mesh as THREE.InstancedMesh).isInstancedMesh) {
        const instMesh = mesh as THREE.InstancedMesh;
        const count    = instMesh.count;
        for (let i = 0; i < count; i++) {
          instMesh.getMatrixAt(i, _instMatrix);
          _instPos.setFromMatrixPosition(_instMatrix);

          if (ptToSegDistSq(_instPos, _segStart, _segEnd) < this.leafFadeRadiusSq) {
            meshBlocking = true;
            break;
          }
        }
      } else {
        if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
        _center.copy(mesh.geometry.boundingSphere!.center).applyMatrix4(mesh.matrixWorld);

        if (ptToSegDistSq(_center, _segStart, _segEnd) < this.leafFadeRadiusSq) {
          meshBlocking = true;
        }
      }

      if (meshBlocking) {
        for (const mat of mats) {
          blockingMaterials.add(mat);
        }
      }
    }

    for (const mat of this.leafMats) {
      const meta = this.leafMeta.get(mat);
      if (!meta) continue;

      const blocking = blockingMaterials.has(mat);
      const target   = blocking ? this.cfg.leafMinOpacity : meta.base;
      meta.cur       = THREE.MathUtils.lerp(meta.cur, target, delta * this.cfg.leafFadeSpeed);

      const m = mat as THREE.MeshStandardMaterial;
      if (Math.abs(m.opacity - meta.cur) > 0.001) {
        m.opacity     = meta.cur;
        m.transparent = meta.cur < 0.99;
      }
    }
  }
}

/*
 * TUNING GUIDE
 * ============
 * Occlusion cutout (solid objects hiding player):
 *   maskRadius        — radius of the "hole" around the player. Default 1.2m
 *   nearConeRadius    — cone radius at camera end. Default 3.2m (smaller = less false-positives on thin trunks)
 *   nearClipDistance  — anything closer than this to cam is clipped. Default 2.5m
 *   coneFalloff       — 0→1, where along the segment the cone tightens. Default 0.85
 *   cutoutStyle       — 'solid' clean hole | 'stipple' dithered dissolve
 *   uEdgeSoftness     — 0.25 = 25% of cone radius as soft blend band (anti-jitter key!)
 *   uniformSmoothSpeed — lerp speed of camera/player uniform positions. 8=smooth. Lower for more smoothing.
 *
 * Leaf transparency:
 *   leafMinOpacity — how see-through leaves get (0=invisible). Default 0.12
 *   leafFadeRadius — metres around cam→player segment to trigger fade. Default 2.2
 *   leafFadeSpeed  — lerp speed (6=snappy, 2=cinematic). Default 6.0
 *
 * Excluding objects:
 *   object.name in excludedNames array
 *   OR object.userData.excludeOcclusion = true
 *   OR mat.userData.excludeOcclusion = true
 *
 * Anti-jitter strategy (thin trunks):
 *   - GPU uniforms (uPlayerPos, uCamPos) are LERPED each frame at uniformSmoothSpeed
 *     so they don't snap abruptly when camera moves
 *   - Cone boundary uses smoothstep + Bayer dither instead of hard step
 *   - nearConeRadius reduced from 4.5 → 3.2 to avoid over-triggering
 */
