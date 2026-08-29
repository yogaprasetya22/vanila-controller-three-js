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
}

const DEFAULTS: Required<CameraOcclusionConfig> = {
  maskRadius: 1.5,
  nearConeRadius: 4.5,
  nearClipDistance: 2.5,
  coneFalloff: 0.9,
  playerHeightOffset: 1.0,
  excludedNames: ['terrain', 'water', 'floor'],
  cutoutStyle: 'stipple',
  leafMinOpacity: 0.12,
  leafFadeRadius: 2.2,
  leafFadeSpeed: 6.0,
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
}

// ---------------------------------------------------------------------------
// Module-level scratch — zero alloc per frame
// ---------------------------------------------------------------------------
const _segStart = new THREE.Vector3();
const _segEnd   = new THREE.Vector3();
const _closest  = new THREE.Vector3();
const _tmp      = new THREE.Vector3();
const _center   = new THREE.Vector3();
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
      uIsLeaf: { value: isLeafMat ? 1.0 : 0.0 }
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

    // ── Fragment shader: cone-shaped cutout with per-pixel leaf culling ──
    const stippleFn = cutoutStyle === 'stipple'
      ? `float occStipple(vec2 fc){vec2 p=fc/2.;return fract((floor(p.x)+floor(p.y))/2.);}`
      : '';

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
       varying vec3  vHoloWorldPos;
       varying vec3  vObjCenter;
       varying float vScale;
       ${stippleFn}

       // 4x4 Bayer dither pattern computed mathematically to avoid branching
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

    const discard = cutoutStyle === 'stipple'
      ? 'if(occStipple(gl_FragCoord.xy)==0.)discard;'
      : 'discard;';

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <dithering_fragment>',
      `#include <dithering_fragment>
       {
         // Cone-based cutout (for both leaves and bark blocking player visibility)
         vec3 pa=vHoloWorldPos-uCamPos;
         vec3 ba=uPlayerPos-uCamPos;
         float baSq=max(dot(ba,ba),1e-5);
         float hRaw=dot(pa,ba)/baSq;
         float h=clamp(hRaw,0.,1.);
         if(hRaw<uConeFalloff){
           float r=mix(uNearConeRadius,sqrt(uMaskRadiusSq),h);
           vec3 perp=pa-(ba*h);
           float dSq=dot(perp,perp);
           if(dSq<r*r){${discard}}
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
  // Explicit tag from Trees.ts loader (most reliable)
  if (mat.userData?.isLeaf === true) return true;
  if (mat.userData?.isBark === true) return false; // explicit bark, never treat as leaf

  // Name-based: ONLY match clear leaf/foliage keywords
  const n = mat.name.toLowerCase();
  if (/leaf|leaves|foliage/.test(n)) return true;

  // DO NOT match bark|branch|tree|trunk|pine|birch|maple — those are trunk materials!
  return false;
}

// ---------------------------------------------------------------------------
// Per-material leaf fade state (WeakMap → auto-GC on dispose)
// ---------------------------------------------------------------------------
interface LeafMeta { base: number; cur: number }

// ---------------------------------------------------------------------------
// Tree mesh heuristic
// ---------------------------------------------------------------------------
function isTreeMesh(object: THREE.Object3D): boolean {
  if (object.userData?.isTree === true || object.userData?.isRock === true) return true;
  const n = object.name.toLowerCase();
  return /tree|pine|birch|maple|rock|pebble/.test(n);
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

  // Patch queue (budgeted recompile)
  private claimed = new WeakSet<THREE.Material>();
  private patchQueue: THREE.Material[] = [];

  // Leaf fade
  private leafMeta = new WeakMap<THREE.Material, LeafMeta>();
  private leafMats: THREE.Material[] = [];
  private leafFadeRadiusSq: number;
  private treeMeshes: (THREE.Mesh | THREE.InstancedMesh)[] = [];

  // Re-scan timer
  private scanTimer = 0;
  private readonly SCAN_INTERVAL = 1.5; // seconds
  private readonly PATCH_BUDGET   = 4;   // materials per frame

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
    this.excludedNames = new Set(this.cfg.excludedNames);
    this.leafFadeRadiusSq = this.cfg.leafFadeRadius * this.cfg.leafFadeRadius;

    this.uniforms = {
      uPlayerPos:        { value: new THREE.Vector3() },
      uCamPos:           { value: new THREE.Vector3() },
      uMaskRadiusSq:     { value: this.cfg.maskRadius * this.cfg.maskRadius },
      uNearConeRadius:   { value: this.cfg.nearConeRadius },
      uNearClipDistance: { value: this.cfg.nearClipDistance },
      uConeFalloff:      { value: this.cfg.coneFalloff },
    };

    // Initial scan
    this.scan();
  }

  /** Call this every frame with the local player's position and frame delta. */
  update(playerWorldPos: THREE.Vector3, delta: number): void {
    this.playerPos.copy(playerWorldPos);
    this.playerPos.y += this.cfg.playerHeightOffset;

    // Update GPU uniforms
    this.uniforms.uPlayerPos.value.copy(this.playerPos);
    this.uniforms.uCamPos.value.copy(this.camera.position);

    // Drain patch queue at budget
    let patched = 0;
    while (this.patchQueue.length > 0 && patched < this.PATCH_BUDGET) {
      const mat = this.patchQueue.shift()!;
      patchMaterial(mat, this.uniforms, this.cfg.cutoutStyle, isLeaf(mat));
      patched++;
    }

    // Leaf transparency fade - DISABLED to prevent entire instanced forest from becoming transparent (causes severe overdraw / fillrate GPU bottleneck)
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
    const next: THREE.Material[] = [];
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

        // Queue for cutout shader patch
        if (!this.claimed.has(mat)) {
          this.claimed.add(mat);
          this.patchQueue.push(mat);
        }

        // Register leaf mats for fade
        if (isLeaf(mat)) {
          next.push(mat);

          // Enforce high-performance alpha clipping instead of blending to eliminate overdraw fillrate bottleneck
          const m = mat as THREE.MeshStandardMaterial;
          m.transparent = false;
          m.alphaTest = 0.5;
          m.depthWrite = true;
          m.needsUpdate = true;

          if (!this.leafMeta.has(mat)) {
            const base = m.opacity ?? 1.0;
            this.leafMeta.set(mat, { base, cur: base });
          }
        }
      }
    });

    this.leafMats = next;
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
        const count = instMesh.count;
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
      const target = blocking ? this.cfg.leafMinOpacity : meta.base;
      meta.cur = THREE.MathUtils.lerp(meta.cur, target, delta * this.cfg.leafFadeSpeed);

      const m = mat as THREE.MeshStandardMaterial;
      if (Math.abs(m.opacity - meta.cur) > 0.001) {
        m.opacity    = meta.cur;
        m.transparent = meta.cur < 0.99;
      }
    }
  }
}

/*
 * TUNING GUIDE
 * ============
 * Occlusion cutout (solid objects hiding player):
 *   maskRadius        — radius of the "hole" around the player. Default 1.5m
 *   nearConeRadius    — cone radius at camera end. Default 4.5m
 *   nearClipDistance  — anything closer than this to cam is clipped. Default 2.5m
 *   coneFalloff       — 0→1, where along the segment the cone tightens. Default 0.9
 *   cutoutStyle       — 'solid' clean hole | 'stipple' dithered dissolve
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
 */
