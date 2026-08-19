#!/usr/bin/env node
/**
 * quarks-to-native.mjs
 *
 * Converts a three.quarks JSON effect file into a standalone native Three.js TypeScript class.
 *
 * Usage:
 *   node scripts/quarks-to-native.mjs <path-to-quarks.json>
 *
 * Output:
 *   public/vfx/<slug>/           → extracted texture PNGs
 *   src/vfx/<ClassName>VFX.ts    → generated native Three.js TypeScript class
 */

import fs from 'fs';
import path from 'path';

// ─── helpers ────────────────────────────────────────────────────────────────

function toPascalCase(str) {
  return str
    .replace(/[^a-zA-Z0-9 ]/g, ' ')
    .split(/\s+/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join('');
}

function toKebabCase(str) {
  return str
    .replace(/[^a-zA-Z0-9 ]/g, ' ')
    .trim()
    .split(/\s+/)
    .join('-')
    .toLowerCase();
}

function blendingName(blending) {
  const map = { 0: 'THREE.NormalBlending', 1: 'THREE.AdditiveBlending', 2: 'THREE.SubtractiveBlending' };
  return map[blending] ?? 'THREE.NormalBlending';
}

function renderModeName(mode) {
  return mode;
}

function fmtColor(c) {
  return `{ r: ${c.r.toFixed(5)}, g: ${c.g.toFixed(5)}, b: ${c.b.toFixed(5)} }`;
}

function fmtAlphaKeys(keys) {
  return '[' + keys.map(k => `{ value: ${k.value.toFixed(5)}, pos: ${k.pos.toFixed(5)} }`).join(', ') + ']';
}

function fmtColorKeys(keys) {
  return '[' + keys.map(k =>
    `{ value: ${fmtColor(k.value)}, pos: ${k.pos.toFixed(5)} }`
  ).join(', ') + ']';
}

function fmtInterval(v) {
  if (v.type === 'ConstantValue') return `[${v.value}, ${v.value}]`;
  if (v.type === 'IntervalValue') return `[${v.a}, ${v.b}]`;
  if (v.type === 'PiecewiseBezier') {
    const fn = v.functions[0].function;
    return `[${fn.p0}, ${fn.p3}]`;
  }
  return '[0, 0]';
}

function getIntervalMax(v) {
  if (!v) return 1;
  if (v.type === 'ConstantValue') return v.value;
  if (v.type === 'IntervalValue') return v.b;
  if (v.type === 'PiecewiseBezier') {
    const fn = v.functions[0].function;
    return Math.max(fn.p0, fn.p3);
  }
  return 1;
}

function fmtBezier(v, fallback = '[1, 1, 1, 1]') {
  if (!v) return fallback;
  if (v.type === 'ConstantValue') return `[${v.value}, ${v.value}, ${v.value}, ${v.value}]`;
  if (v.type === 'PiecewiseBezier') {
    const fn = v.functions[0].function;
    return `[${fn.p0}, ${fn.p1}, ${fn.p2}, ${fn.p3}]`;
  }
  if (v.type === 'IntervalValue') return `[${v.a}, ${v.a}, ${v.b}, ${v.b}]`;
  return fallback;
}

function fmtPiecewiseBezierArray(v) {
  if (!v) return '[]';
  if (v.type === 'ConstantValue') {
    return `[{start: 0, end: 1.0, p0: ${v.value}, p1: ${v.value}, p2: ${v.value}, p3: ${v.value}}]`;
  }
  if (v.type === 'IntervalValue') {
    return `[{start: 0, end: 1.0, p0: ${v.a}, p1: ${v.a}, p2: ${v.b}, p3: ${v.b}}]`;
  }
  if (v.type === 'PiecewiseBezier') {
    const list = [];
    for (let i = 0; i < v.functions.length; i++) {
      const f = v.functions[i];
      const start = f.start;
      const end = (i + 1 < v.functions.length) ? v.functions[i + 1].start : 1.0;
      const fn = f.function;
      list.push(`{start: ${start}, end: ${end}, p0: ${fn.p0}, p1: ${fn.p1}, p2: ${fn.p2}, p3: ${fn.p3}}`);
    }
    return `[${list.join(', ')}]`;
  }
  return '[]';
}

// ─── parse quarks JSON ───────────────────────────────────────────────────────

const inputPath = process.argv[2];
if (!inputPath) {
  console.error('Usage: node scripts/quarks-to-native.mjs <path-to-quarks.json>');
  process.exit(1);
}

const absInput = path.resolve(inputPath);
let fileRaw = fs.readFileSync(absInput, 'utf-8').trim();

// Strip TypeScript export syntax or comments if present
const startIdx = fileRaw.indexOf('{');
const endIdx = fileRaw.lastIndexOf('}');
if (startIdx !== -1 && endIdx !== -1) {
  fileRaw = fileRaw.substring(startIdx, endIdx + 1);
}

const data = JSON.parse(fileRaw);

const baseName = path.basename(absInput, '.ts').replace(/\.json$/, '');
const className = toPascalCase(baseName);
const slug = toKebabCase(baseName);

// ─── extract images ──────────────────────────────────────────────────────────

const publicDir = `public/vfx/${slug}`;
fs.mkdirSync(publicDir, { recursive: true });

const imgByUUID = {};
(data.images || []).forEach((img, i) => {
  const url = img.url || '';
  const fname = `tex_${i}.png`;
  const fpath = path.join(publicDir, fname);
  if (url.startsWith('data:image/png;base64,')) {
    const b64 = url.split(',')[1];
    fs.writeFileSync(fpath, Buffer.from(b64, 'base64'));
    console.log(`  Extracted: ${fpath}`);
  }
  imgByUUID[img.uuid] = { index: i, fname };
});

// ─── build material → image index map ────────────────────────────────────────

const texByUUID = {};
(data.textures || []).forEach(t => { texByUUID[t.uuid] = t; });

const matToImageIndex = {};
(data.materials || []).forEach(m => {
  const texUUID = m.map;
  if (texUUID && texByUUID[texUUID]) {
    const imgUUID = texByUUID[texUUID].image;
    if (imgByUUID[imgUUID] !== undefined) {
      matToImageIndex[m.uuid] = imgByUUID[imgUUID];
    }
  }
});

const geoByUUID = {};
(data.geometries || []).forEach(g => {
  geoByUUID[g.uuid] = g;
});

// ─── collect emitters ────────────────────────────────────────────────────────

const emitters = [];
const emitterByUUID = {};

function collectEmitters(obj) {
  if (obj.type === 'ParticleEmitter') {
    const ps = obj.ps || {};
    const safeName = (obj.name || 'Emitter').replace(/[^a-zA-Z0-9]/g, '_');
    emitterByUUID[obj.uuid] = safeName;
    if (ps.uuid) {
      emitterByUUID[ps.uuid] = safeName;
    }

    const matUUID = ps.material;
    const imgInfo = matToImageIndex[matUUID] || { index: -1, fname: null };
    const texIdx = imgInfo.index;

    const geoUUID = ps.instancingGeometry;
    const geoInfo = geoUUID ? geoByUUID[geoUUID] : null;
    let geoCode = `new THREE.PlaneGeometry(1.0, 1.0)`;
    if (geoInfo) {
      if (geoInfo.type === 'SphereGeometry') {
        geoCode = `new THREE.SphereGeometry(${geoInfo.radius || 0.5}, ${geoInfo.widthSegments || 16}, ${geoInfo.heightSegments || 8})`;
      } else if (geoInfo.type === 'PlaneGeometry') {
        geoCode = `new THREE.PlaneGeometry(${geoInfo.width || 1.0}, ${geoInfo.height || 1.0})`;
      }
    }

    const behaviors = {};
    for (const b of (ps.behaviors || [])) {
      behaviors[b.type] = b;
    }

    const maxLifeVal = getIntervalMax(ps.startLife || { type: 'ConstantValue', value: 1 });
    const rateVal = ps.emissionOverTime?.value ?? 0;
    let burstVal = 0;
    (ps.emissionBursts || []).forEach(b => {
      if (b.count) burstVal += b.count.value ?? 0;
    });

    const onlyUsedByOther = ps.onlyUsedByOther === true;
    let poolCount = Math.max(1, Math.ceil((rateVal * maxLifeVal) * 2.0) + burstVal + 10);
    if (onlyUsedByOther) {
      poolCount = 300;
    }

    let subEmitterTarget = null;
    let subEmitterMode = null;
    if (behaviors.EmitSubParticleSystem) {
      subEmitterTarget = behaviors.EmitSubParticleSystem.subParticleSystem;
      subEmitterMode = behaviors.EmitSubParticleSystem.mode;
    }

    emitters.push({
      name: obj.name || 'Emitter',
      texIdx,
      texFname: imgInfo.fname,
      uTiles: ps.uTileCount || 1,
      vTiles: ps.vTileCount || 1,
      blending: ps.renderMode === 1 ? 'THREE.NormalBlending' : 'THREE.AdditiveBlending',
      renderMode: ps.renderMode || 0,
      duration: ps.duration || 1,
      startLife: fmtInterval(ps.startLife || { type: 'ConstantValue', value: 1 }),
      startSpeed: fmtInterval(ps.startSpeed || { type: 'ConstantValue', value: 1 }),
      startSize: fmtInterval(ps.startSize || { type: 'ConstantValue', value: 1 }),
      startRotation: fmtInterval(ps.startRotation || { type: 'ConstantValue', value: 0 }),
      startColor: ps.startColor?.color || { r: 1, g: 1, b: 1, a: 1 },
      emissionCount: poolCount,
      burstCount: burstVal,
      emissionRate: rateVal,
      emissionOverDistance: ps.emissionOverDistance?.value || 0,
      shapeType: ps.shape?.type || 'sphere',
      shapeRadius: ps.shape?.radius || 0,
      shapeArc: ps.shape?.arc ?? (Math.PI * 2),
      shapeAngle: ps.shape?.angle ?? 0,
      worldSpace: ps.worldSpace !== false,
      behaviors,
      onlyUsedByOther,
      subEmitterTarget,
      subEmitterMode,
      // ColorOverLife details
      colorGradient: behaviors.ColorOverLife?.color?.color?.keys || null,
      alphaGradient: behaviors.ColorOverLife?.color?.alpha?.keys || null,
      // SizeOverLife
      sizeBezier: fmtPiecewiseBezierArray(behaviors.SizeOverLife?.size),
      // Gravity (ForceOverLife Y)
      gravityY: behaviors.ForceOverLife?.y?.value ?? 0,
      // LimitSpeed
      limitDampen: behaviors.LimitSpeedOverLife?.dampen ?? 0,
      // FrameOverLife
      frameBezier: behaviors.FrameOverLife ? fmtPiecewiseBezierArray(behaviors.FrameOverLife.frame) : null,
      frameInterval: behaviors.FrameOverLife ? fmtInterval(behaviors.FrameOverLife.frame) : null,
      totalFrames: (ps.uTileCount || 1) * (ps.vTileCount || 1),
      // RotationOverLife
      rotSpeedBezier: behaviors.RotationOverLife ? fmtPiecewiseBezierArray(behaviors.RotationOverLife.angularVelocity) : null,
      // Stretched billboard
      speedFactor: ps.rendererEmitterSettings?.speedFactor ?? 0,
      lengthFactor: ps.rendererEmitterSettings?.lengthFactor ?? 1,
      geometryCode: geoCode,
      renderMode: ps.renderMode || 0,
    });
  }

  for (const child of (obj.children || [])) {
    collectEmitters(child);
  }
}

collectEmitters(data.object || {});

// Resolve subemitter targets
for (const e of emitters) {
  if (e.subEmitterTarget) {
    const targetName = emitterByUUID[e.subEmitterTarget];
    const targetEmitter = emitters.find(x => x.name.replace(/[^a-zA-Z0-9]/g, '_') === targetName);
    if (targetEmitter) {
      e.resolvedSubEmitter = targetName;
      e.resolvedSubEmitterDist = targetEmitter.emissionOverDistance;
    } else {
      e.resolvedSubEmitter = null;
      e.resolvedSubEmitterDist = 0;
    }
  } else {
    e.resolvedSubEmitter = null;
    e.resolvedSubEmitterDist = 0;
  }
}

// ─── collect unique texture indices ──────────────────────────────────────────

const usedTexIndices = [...new Set(emitters.map(e => e.texIdx).filter(i => i >= 0))].sort();

// ─── generate TypeScript ──────────────────────────────────────────────────────

const vfxDir = 'src/vfx';
const targetFolder = `${vfxDir}/${slug}`;
fs.mkdirSync(targetFolder, { recursive: true });
const outPath = `${targetFolder}/Native.ts`;

let code = `import * as THREE from 'three';

// Generated by scripts/quarks-to-native.mjs
// Source: ${path.basename(absInput)}
// DO NOT EDIT — re-run the converter to regenerate.

// ─── Bezier/curve helpers ────────────────────────────────────────────────────

function bezier3(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const u = 1 - t; return u*u*u*p0 + 3*u*u*t*p1 + 3*u*t*t*p2 + t*t*t*p3;
}

interface PiecewiseCurve { start: number; end: number; p0: number; p1: number; p2: number; p3: number; }

function evalPiecewise(curves: PiecewiseCurve[], t: number): number {
  if (curves.length === 0) return 0;
  for (let i = 0; i < curves.length; i++) {
    const c = curves[i];
    if (t >= c.start && t <= c.end) {
      const nt = (c.end === c.start) ? 0 : (t - c.start) / (c.end - c.start);
      return bezier3(c.p0, c.p1, c.p2, c.p3, nt);
    }
  }
  if (t < curves[0].start) return bezier3(curves[0].p0, curves[0].p1, curves[0].p2, curves[0].p3, 0);
  const last = curves[curves.length - 1];
  return bezier3(last.p0, last.p1, last.p2, last.p3, 1.0);
}

interface ColorKey { value: { r: number; g: number; b: number }; pos: number; }
interface AlphaKey { value: number; pos: number; }

function evalAlpha(keys: AlphaKey[], t: number): number {
  for (let i = 0; i < keys.length - 1; i++) {
    if (t <= keys[i+1].pos) {
      const lt = (t - keys[i].pos) / (keys[i+1].pos - keys[i].pos);
      return keys[i].value + lt * (keys[i+1].value - keys[i].value);
    }
  }
  return keys[keys.length-1].value;
}

function evalColor(keys: ColorKey[], t: number) {
  for (let i = 0; i < keys.length - 1; i++) {
    if (t <= keys[i+1].pos) {
      const lt = (t - keys[i].pos) / (keys[i+1].pos - keys[i].pos);
      return {
        r: keys[i].value.r + lt * (keys[i+1].value.r - keys[i].value.r),
        g: keys[i].value.g + lt * (keys[i+1].value.g - keys[i].value.g),
        b: keys[i].value.b + lt * (keys[i+1].value.b - keys[i].value.b),
      };
    }
  }
  return keys[keys.length-1].value;
}

function rng(a: number, b: number) { return a + Math.random() * (b - a); }

// ─── VFX Class ───────────────────────────────────────────────────────────────

export class ${className}NativeVFX {
  private scene: THREE.Scene;
  private camera: THREE.Camera;
  private activeFX: Array<{ update: (delta: number) => boolean }> = [];
`;

// Texture properties
for (const i of usedTexIndices) {
  code += `  private tex${i}: THREE.Texture;\n`;
}

code += `
  constructor(scene: THREE.Scene, camera: THREE.Camera) {
    this.scene = scene;
    this.camera = camera;
    const L = new THREE.TextureLoader();
`;

for (const i of usedTexIndices) {
  const fname = imgByUUID[Object.keys(imgByUUID).find(k => imgByUUID[k].index === i)]?.fname ?? `tex_${i}.png`;
  code += `    this.tex${i} = L.load('/vfx/${slug}/${fname}');\n`;
}

code += `  }

  public spawn(x: number, y: number, z: number) {
    const origin = new THREE.Vector3(x, y, z);
    const T = new THREE.Object3D();
    const hideM = new THREE.Matrix4().makeScale(0, 0, 0);
    const cq = this.camera.quaternion;
    let age = 0;
    const cleanups: (() => void)[] = [];
`;

// Generate emitter blocks
for (let ei = 0; ei < emitters.length; ei++) {
  const e = emitters[ei];
  const safeName = e.name.replace(/[^a-zA-Z0-9]/g, '_');
  const count = e.emissionCount;
  const burstCount = e.burstCount;
  const emissionRate = e.emissionRate;
  const hasSheet = e.uTiles > 1 || e.vTiles > 1 || e.renderMode === 1;
  const texVar = e.texIdx >= 0 ? `this.tex${e.texIdx}` : 'undefined';

  code += `
    // ══════════════════════════════════════════════════════════
    // Emitter: ${e.name}  (count=${count}, life=${e.startLife}, speed=${e.startSpeed})
    // Texture: tex_${e.texIdx}.png  Grid: ${e.uTiles}x${e.vTiles}
    // ══════════════════════════════════════════════════════════
    const cnt_${safeName} = ${count};
    const geo_${safeName} = ${e.geometryCode};\n`;

  const hasTexture = e.texIdx >= 0;
  if (e.renderMode === 1) {
    // StretchedBillboard: view-space velocity stretching (matches three.quarks exactly)
    code += `    const mat_${safeName} = new THREE.ShaderMaterial({
      uniforms: ${hasTexture ? `{ uMap: { value: ${texVar} }, speedFactor: { value: ${e.speedFactor.toFixed(4)} } }` : `{ speedFactor: { value: ${e.speedFactor.toFixed(4)} } }`},
      vertexShader: \`
        attribute float aFrame; attribute float aOpacity; attribute vec3 aColor; attribute vec3 aVelocity; attribute vec3 aOffset;
        varying vec2 vUv; varying float vOpacity; varying vec3 vColor;
        uniform float speedFactor;
        void main() {
          float c = mod(aFrame, ${e.uTiles}.0); float r = floor(aFrame / ${e.uTiles}.0);
          vUv = vec2((c + uv.x) / ${e.uTiles}.0, 1.0 - (r + 1.0 - uv.y) / ${e.vTiles}.0);
          vOpacity = aOpacity; vColor = aColor;
          vec4 mvPos = modelViewMatrix * vec4(aOffset, 1.0);
          vec3 viewVel = normalMatrix * aVelocity;
          float vlength = length(viewVel);
          float avgSize = (instanceMatrix[0][0] + instanceMatrix[1][1]) * 0.5;
          float sz = length(vec3(instanceMatrix[0][0], instanceMatrix[0][1], instanceMatrix[0][2]));
          mvPos.xyz += position.y * normalize(cross(mvPos.xyz, viewVel)) * sz;
          mvPos.xyz -= (position.x + 0.5) * viewVel * (1.0 + ${e.lengthFactor.toFixed(4)} / max(vlength, 0.001)) * sz;
          vOpacity = aOpacity; vColor = aColor;
          gl_Position = projectionMatrix * mvPos;
        }
      \`,
      fragmentShader: \`
        ${hasTexture ? 'uniform sampler2D uMap;' : ''}
        varying vec2 vUv; varying float vOpacity; varying vec3 vColor;
        void main() {
          ${hasTexture ? `
          vec4 t = texture2D(uMap, vUv); if (t.a < 0.05) discard;
          gl_FragColor = vec4(t.rgb * vColor, t.a * vOpacity);
          ` : `
          gl_FragColor = vec4(vColor, vOpacity);
          `}
        }
      \`,
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: ${e.blending}
    });\n`;
  } else {
    // Normal ShaderMaterial for all other emitters (standard billboard, horizontal billboard, vertical billboard, meshes)
    code += `    const mat_${safeName} = new THREE.ShaderMaterial({
      uniforms: ${hasTexture ? `{ uMap: { value: ${texVar} } }` : '{}'},
      vertexShader: \`
        attribute float aFrame; attribute float aOpacity; attribute vec3 aColor;
        varying vec2 vUv; varying float vOpacity; varying vec3 vColor;
        void main() {
          ${e.uTiles > 1 || e.vTiles > 1 ? `
          float c = mod(aFrame, ${e.uTiles}.0); float r = floor(aFrame / ${e.uTiles}.0);
          vUv = vec2((c + uv.x) / ${e.uTiles}.0, 1.0 - (r + 1.0 - uv.y) / ${e.vTiles}.0);
          ` : `
          vUv = uv;
          `}
          vOpacity = aOpacity; vColor = aColor;
          gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        }
      \`,
      fragmentShader: \`
        ${hasTexture ? 'uniform sampler2D uMap;' : ''}
        varying vec2 vUv; varying float vOpacity; varying vec3 vColor;
        void main() {
          ${hasTexture ? `
          vec4 t = texture2D(uMap, vUv); if (t.a < 0.05) discard;
          gl_FragColor = vec4(t.rgb * vColor, t.a * vOpacity);
          ` : `
          gl_FragColor = vec4(vColor, vOpacity);
          `}
        }
      \`,
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: ${e.blending}
    });\n`;
  }

  code += `    const mesh_${safeName} = new THREE.InstancedMesh(geo_${safeName}, mat_${safeName}, cnt_${safeName});
    mesh_${safeName}.frustumCulled = false;
    this.scene.add(mesh_${safeName});\n`;

    code += `    const frm_${safeName} = new Float32Array(cnt_${safeName});
    const opc_${safeName} = new Float32Array(cnt_${safeName});
    const clr_${safeName} = new Float32Array(cnt_${safeName} * 3);
    mesh_${safeName}.geometry.setAttribute('aFrame', new THREE.InstancedBufferAttribute(frm_${safeName}, 1));
    mesh_${safeName}.geometry.setAttribute('aOpacity', new THREE.InstancedBufferAttribute(opc_${safeName}, 1));
    mesh_${safeName}.geometry.setAttribute('aColor', new THREE.InstancedBufferAttribute(clr_${safeName}, 3));
`;
    if (e.renderMode === 1) {
      code += `    const vel_buf_${safeName} = new Float32Array(cnt_${safeName} * 3);
    const off_buf_${safeName} = new Float32Array(cnt_${safeName} * 3);
    mesh_${safeName}.geometry.setAttribute('aVelocity', new THREE.InstancedBufferAttribute(vel_buf_${safeName}, 3));
    mesh_${safeName}.geometry.setAttribute('aOffset', new THREE.InstancedBufferAttribute(off_buf_${safeName}, 3));
`;
    }
    code += `\n`;

  // Per-particle state arrays
  const life0 = JSON.parse(e.startLife);
  const speed0 = JSON.parse(e.startSpeed);
  const size0 = JSON.parse(e.startSize);

  code += `    const life_${safeName}: number[] = [];
    const maxLife_${safeName}: number[] = [];
    const pos_${safeName}: THREE.Vector3[] = [];
    const vel_${safeName}: THREE.Vector3[] = [];
    const sz_${safeName}: number[] = [];
    const rot_${safeName}: number[] = [];
    ${e.resolvedSubEmitter ? `const accumulatedDist_${safeName}: number[] = [];` : ''}

    // Pre-initialize pool items as inactive (life = maxLife)
    for (let i = 0; i < cnt_${safeName}; i++) {
      life_${safeName}.push(1.0);
      maxLife_${safeName}.push(1.0);
      pos_${safeName}.push(new THREE.Vector3(x, y, z));
      vel_${safeName}.push(new THREE.Vector3(0, 0, 0));
      sz_${safeName}.push(0);
      rot_${safeName}.push(0);
      ${e.resolvedSubEmitter ? `accumulatedDist_${safeName}.push(0);` : ''}
    }

    let ptr_${safeName} = 0;
    let spawnTimer_${safeName} = 0;

    const spawnParticle_${safeName} = (i: number) => {
      life_${safeName}[i] = 0;
      maxLife_${safeName}[i] = rng(${life0[0]}, ${life0[1]});
      sz_${safeName}[i] = rng(${size0[0]}, ${size0[1]});
      rot_${safeName}[i] = rng(0, Math.PI * 2);
      ${e.resolvedSubEmitter ? `accumulatedDist_${safeName}[i] = 0;` : ''}
`;

  if (e.shapeType === 'cone') {
    code += `      const u = Math.random();
      const rand = Math.random();
      const theta = u * ${e.shapeArc};
      const r = Math.sqrt(rand);
      const sinTheta = Math.sin(theta);
      const cosTheta = Math.cos(theta);
      const pX = r * cosTheta;
      const pY = r * sinTheta;
      
      const angle = ${e.shapeAngle} * r;
      const speed = rng(${speed0[0]}, ${speed0[1]}) * 2.0;
      const srad = ${e.shapeRadius} * 2.0;
      
      pos_${safeName}[i].set(
        x + pX * srad,
        y + pY * srad,
        z
      );
      vel_${safeName}[i].set(
        pX * Math.sin(angle) * speed,
        pY * Math.sin(angle) * speed,
        Math.cos(angle) * speed
      );
    };
`;
  } else {
    code += `      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(rng(-1, 1));
      const speed = rng(${speed0[0]}, ${speed0[1]}) * 2.0;
      const srad = ${e.shapeRadius} * 2.0;
      pos_${safeName}[i].set(
        x + Math.sin(phi) * Math.cos(theta) * srad,
        y + Math.sin(phi) * Math.sin(theta) * srad,
        z + Math.cos(phi) * srad
      );
      vel_${safeName}[i].set(
        Math.sin(phi) * Math.cos(theta) * speed,
        Math.sin(phi) * Math.sin(theta) * speed,
        Math.cos(phi) * speed
      );
    };
`;
  }

  code += `
    // Trigger initial bursts
    const initialBurst_${safeName} = ${burstCount};
    for (let i = 0; i < Math.min(cnt_${safeName}, initialBurst_${safeName}); i++) {
      spawnParticle_${safeName}(ptr_${safeName});
      ptr_${safeName} = (ptr_${safeName} + 1) % cnt_${safeName};
    }
  `;

  // Alpha/color gradient
  let colorKeysStr = 'null';
  let alphaKeysStr = 'null';
  if (e.colorGradient) colorKeysStr = fmtColorKeys(e.colorGradient);
  if (e.alphaGradient) alphaKeysStr = fmtAlphaKeys(e.alphaGradient);

  const sizeBez = e.sizeBezier;
  const gravY = e.gravityY * 2.0; // scale gravity by 2.0 system scale
  const dampen = e.limitDampen;
  let limitDampenCode = '';
  if (dampen > 0) {
    const limitVal = e.behaviors.LimitSpeedOverLife?.speed?.value ?? 0;
    limitDampenCode = `
        const speed_${safeName} = vel_${safeName}[i].length();
        const limit_${safeName} = ${limitVal} * 2.0;
        if (speed_${safeName} > limit_${safeName}) {
          const percent = (speed_${safeName} - limit_${safeName}) / speed_${safeName};
          vel_${safeName}[i].multiplyScalar(Math.max(0, 1 - percent * ${dampen} * dt * 20));
        }
    `;
  }

  code += `
    const colorKeys_${safeName}: ColorKey[] | null = ${colorKeysStr};
    const alphaKeys_${safeName}: AlphaKey[] | null = ${alphaKeysStr};

    // Update closure captured for this emitter
    const update_${safeName} = (dt: number) => {
      // Spawn particles continuously over time
      const rate = ${emissionRate};
      if (rate > 0) {
        spawnTimer_${safeName} += dt;
        const interval = 1.0 / rate;
        while (spawnTimer_${safeName} >= interval) {
          spawnParticle_${safeName}(ptr_${safeName});
          ptr_${safeName} = (ptr_${safeName} + 1) % cnt_${safeName};
          spawnTimer_${safeName} -= interval;
        }
      }

      for (let i = 0; i < cnt_${safeName}; i++) {
        if (life_${safeName}[i] >= maxLife_${safeName}[i]) {
          mesh_${safeName}.setMatrixAt(i, hideM);
          ${hasSheet ? `opc_${safeName}[i] = 0;` : ''}
          continue;
        }
        life_${safeName}[i] += dt;
        const pct = Math.min(1, life_${safeName}[i] / maxLife_${safeName}[i]);
        if (life_${safeName}[i] >= maxLife_${safeName}[i]) {
          mesh_${safeName}.setMatrixAt(i, hideM);
          ${hasSheet ? `opc_${safeName}[i] = 0;` : ''}
          continue;
        }
        // Physics: gravity + drag
        vel_${safeName}[i].y += ${gravY} * dt;
        ${limitDampenCode}
        pos_${safeName}[i].addScaledVector(vel_${safeName}[i], dt);
        ${e.rotSpeedBezier ? `
        const rotSpeedBez_${safeName}: PiecewiseCurve[] = ${e.rotSpeedBezier};
        rot_${safeName}[i] += evalPiecewise(rotSpeedBez_${safeName}, pct) * dt;
        ` : ''}


        ${e.resolvedSubEmitter ? `
        const distMoved_${safeName} = vel_${safeName}[i].length() * dt;
        accumulatedDist_${safeName}[i] += distMoved_${safeName};
        const subDist_${safeName} = ${e.resolvedSubEmitterDist} > 0 ? (1.0 / ${e.resolvedSubEmitterDist}) * 2.0 : 0;
        if (subDist_${safeName} > 0) {
          while (accumulatedDist_${safeName}[i] >= subDist_${safeName}) {
            spawnParticle_${e.resolvedSubEmitter}(ptr_${e.resolvedSubEmitter});
            pos_${e.resolvedSubEmitter}[ptr_${e.resolvedSubEmitter}].copy(pos_${safeName}[i]);
            ptr_${e.resolvedSubEmitter} = (ptr_${e.resolvedSubEmitter} + 1) % cnt_${e.resolvedSubEmitter};
            accumulatedDist_${safeName}[i] -= subDist_${safeName};
          }
        }
        ` : ''}

        const sizeBez: PiecewiseCurve[] = ${sizeBez};
        const scaledSz = sz_${safeName}[i] * 2.0 * evalPiecewise(sizeBez, pct);

        const alpha = alphaKeys_${safeName} ? evalAlpha(alphaKeys_${safeName}, pct) : (1 - pct);
        const col = colorKeys_${safeName} ? evalColor(colorKeys_${safeName}, pct) : { r: 1, g: 1, b: 1 };

        T.position.set(0, 0, 0);
        T.quaternion.set(0, 0, 0, 1);
        ${e.renderMode === 1 ? `
        // StretchedBillboard: shader handles orientation via aVelocity/aOffset
        T.scale.setScalar(scaledSz);
        off_buf_${safeName}[i*3+0] = pos_${safeName}[i].x;
        off_buf_${safeName}[i*3+1] = pos_${safeName}[i].y;
        off_buf_${safeName}[i*3+2] = pos_${safeName}[i].z;
        vel_buf_${safeName}[i*3+0] = vel_${safeName}[i].x * ${e.speedFactor.toFixed(4)};
        vel_buf_${safeName}[i*3+1] = vel_${safeName}[i].y * ${e.speedFactor.toFixed(4)};
        vel_buf_${safeName}[i*3+2] = vel_${safeName}[i].z * ${e.speedFactor.toFixed(4)};
        ` : `
        T.position.copy(pos_${safeName}[i]);
        ${e.renderMode === 2 ? `
        T.quaternion.setFromEuler(new THREE.Euler(0, 0, rot_${safeName}[i]));
        ` : `
        T.quaternion.copy(cq);
        T.rotateZ(rot_${safeName}[i]);
        `}
        T.scale.setScalar(scaledSz);
        `}
        T.updateMatrix();
        mesh_${safeName}.setMatrixAt(i, T.matrix);
`;

    const totalFrames = e.totalFrames;
    const bezF = e.frameBezier;
    code += `
        const frameBez: PiecewiseCurve[] = ${bezF || '[]'};
        const frameRaw = ${bezF ? `evalPiecewise(frameBez, pct)` : `pct * ${totalFrames}`};
        frm_${safeName}[i] = Math.min(${totalFrames - 1}, Math.floor(frameRaw));
        opc_${safeName}[i] = alpha;
        clr_${safeName}[i*3+0] = col.r; clr_${safeName}[i*3+1] = col.g; clr_${safeName}[i*3+2] = col.b;
`;
    if (e.renderMode === 1) {
      code += `        mesh_${safeName}.geometry.attributes.aVelocity.needsUpdate = true;
        mesh_${safeName}.geometry.attributes.aOffset.needsUpdate = true;
`;
    }

  code += `      }
      mesh_${safeName}.instanceMatrix.needsUpdate = true;
      (mesh_${safeName}.geometry.getAttribute('aFrame') as THREE.InstancedBufferAttribute).needsUpdate = true;
      (mesh_${safeName}.geometry.getAttribute('aOpacity') as THREE.InstancedBufferAttribute).needsUpdate = true;
      (mesh_${safeName}.geometry.getAttribute('aColor') as THREE.InstancedBufferAttribute).needsUpdate = true;
`;

  code += `    };

    cleanups.push(() => {
      this.scene.remove(mesh_${safeName});
      geo_${safeName}.dispose(); mat_${safeName}.dispose();
      (mesh_${safeName} as THREE.InstancedMesh).dispose();
    });
`;
}

code += `
    // ── Main animation tick ───────────────────────────────────────
    this.activeFX.push({
      update: (dt: number) => {
        age += dt;
        if (age > ${Math.max(...emitters.map(e => e.duration)) + 1.0}) {
          cleanups.forEach(fn => fn());
          return false;
        }
        const cq = this.camera.quaternion;
        void cq;
`;

for (const e of emitters) {
  const safeName = e.name.replace(/[^a-zA-Z0-9]/g, '_');
  code += `        update_${safeName}(dt);\n`;
}

code += `        return true;
      }
    });
  }

  public update(delta: number) {
    for (let i = this.activeFX.length - 1; i >= 0; i--) {
      if (!this.activeFX[i].update(delta)) this.activeFX.splice(i, 1);
    }
  }
}
`;

fs.writeFileSync(outPath, code, 'utf-8');
console.log(`\n✅ Generated: ${outPath}`);
console.log(`   Textures : ${publicDir}/`);
console.log(`   Emitters : ${emitters.map(e => e.name).join(', ')}`);
console.log(`\nUsage in Three.js:`);
console.log(`  import { ${className}NativeVFX } from './vfx/${slug}/Native.ts';`);
console.log(`  const vfx = new ${className}NativeVFX(scene, camera);`);
console.log(`  vfx.spawn(x, y, z);`);
console.log(`  // in animate loop: vfx.update(delta);`);
