/**
 * FXCore.ts — Shared FX infrastructure: easing curves, geometry/material pools,
 * texture loading, activeFX management, shader materials, reusable helpers.
 * Extracted from SkillFX.ts to reduce cohesion.
 */

import * as THREE from "three";
import { camera } from "../core/scene";

// ═══════════════════════════════════════════════════════════════
// Easing curves
// ═══════════════════════════════════════════════════════════════
export function easeOutCubic(t: number): number {
    const u = 1 - t;
    return 1 - u * u * u;
}
export function easeOutQuad(t: number): number {
    return t * (2 - t);
}
export function easeOutBack(t: number): number {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

// ═══════════════════════════════════════════════════════════════
// Shared geometry pool
// ═══════════════════════════════════════════════════════════════
const _geoPool = new Map<string, THREE.PlaneGeometry>();
export function pooledPlane(w: number, h: number): THREE.PlaneGeometry {
    const key = `${w.toFixed(2)}x${h.toFixed(2)}`;
    if (!_geoPool.has(key)) _geoPool.set(key, new THREE.PlaneGeometry(w, h));
    return _geoPool.get(key)!;
}

// Pooled ring geometry
const _ringGeoPool = new Map<string, THREE.RingGeometry>();
export function pooledRing(
    inner: number,
    outer: number,
    segs: number,
    thetaStart = 0,
    thetaLength = Math.PI * 2,
): THREE.RingGeometry {
    const key = `${inner.toFixed(2)}_${outer.toFixed(2)}_${segs}_${thetaStart.toFixed(2)}_${thetaLength.toFixed(2)}`;
    if (!_ringGeoPool.has(key))
        _ringGeoPool.set(
            key,
            new THREE.RingGeometry(
                inner,
                outer,
                segs,
                1,
                thetaStart,
                thetaLength,
            ),
        );
    return _ringGeoPool.get(key)!;
}

// Pooled cylinder geometry — avoids per-call allocations for Arrow Volley (60×) & Chain Lightning segments
const _cylinderGeoPool = new Map<string, THREE.CylinderGeometry>();
export function pooledCylinder(
    radiusTop: number,
    radiusBottom: number,
    height: number,
    radialSegments: number,
): THREE.CylinderGeometry {
    const key = `${radiusTop.toFixed(3)}_${radiusBottom.toFixed(3)}_${height.toFixed(2)}_${radialSegments}`;
    if (!_cylinderGeoPool.has(key))
        _cylinderGeoPool.set(
            key,
            new THREE.CylinderGeometry(
                radiusTop,
                radiusBottom,
                height,
                radialSegments,
            ),
        );
    return _cylinderGeoPool.get(key)!;
}

// ═══════════════════════════════════════════════════════════════
// Texture loading — once at module init
// ═══════════════════════════════════════════════════════════════
const texLoader = new THREE.TextureLoader();
const baseUrl = import.meta.env.BASE_URL;
function loadTex(path: string) {
    return texLoader.load(baseUrl + path);
}

export const starTex = loadTex("particle-pack/PNG (Transparent)/star_05.png");
export const circleTex = loadTex(
    "particle-pack/PNG (Transparent)/circle_03.png",
);
export const sparkTex = loadTex("particle-pack/PNG (Transparent)/spark_04.png");
export const smokeTex = loadTex("particle-pack/PNG (Transparent)/smoke_04.png");
export const fireTex = loadTex("particle-pack/PNG (Transparent)/fire_01.png");
export const flameTex = loadTex("particle-pack/PNG (Transparent)/flame_01.png");
export const lightTex = loadTex("particle-pack/PNG (Transparent)/light_02.png");
export const star2Tex = loadTex("particle-pack/PNG (Transparent)/star_08.png");

export const blueFlameSmokeTex = loadTex("particle-pack/flamethrower_smoke.png");
export const blueFlameEmberTex = loadTex("particle-pack/flamethrower_ember.png");
export const blueFlameCoreTex = loadTex("particle-pack/flamethrower_core.png");

export const gasExplosionGlowTex = loadTex("particle-pack/gas_explosion_glow.png");
export const gasExplosionCloudTex = loadTex("particle-pack/gas_explosion_cloud.png");



// ═══════════════════════════════════════════════════════════════
// Shared uniform for shader-based effects
// ═══════════════════════════════════════════════════════════════
export const effectUniforms = { uTime: { value: 0 } };

// ═══════════════════════════════════════════════════════════════
// Material pool
// ═══════════════════════════════════════════════════════════════
export interface MatSpecs {
    color?: number;
    map?: THREE.Texture | null;
    transparent?: boolean;
    opacity?: number;
    blending?: THREE.Blending;
    depthWrite?: boolean;
    depthTest?: boolean;
    side?: THREE.Side;
}

const _matPool = new Map<string, THREE.MeshBasicMaterial[]>();
export function getPooledMaterial(specs: MatSpecs): THREE.MeshBasicMaterial {
    const mapKey = specs.map ? specs.map.uuid : "none";
    const key = `${specs.color ?? 0xffffff}_${mapKey}_${specs.transparent ?? false}_${specs.blending ?? THREE.NormalBlending}_${specs.depthWrite ?? true}_${specs.depthTest ?? true}_${specs.side ?? THREE.FrontSide}`;

    let list = _matPool.get(key);
    if (!list) {
        list = [];
        _matPool.set(key, list);
    }

    if (list.length > 0) {
        const mat = list.pop()!;
        if (specs.opacity !== undefined) mat.opacity = specs.opacity;
        return mat;
    }

    const config: any = {};
    if (specs.color !== undefined) config.color = specs.color;
    if (specs.map !== undefined) config.map = specs.map;
    if (specs.transparent !== undefined) config.transparent = specs.transparent;
    if (specs.opacity !== undefined) config.opacity = specs.opacity;
    if (specs.blending !== undefined) config.blending = specs.blending;
    if (specs.depthWrite !== undefined) config.depthWrite = specs.depthWrite;
    if (specs.depthTest !== undefined) config.depthTest = specs.depthTest;
    if (specs.side !== undefined) config.side = specs.side;

    return new THREE.MeshBasicMaterial(config);
}

export function releasePooledMaterial(mat: THREE.MeshBasicMaterial) {
    const mapKey = mat.map ? mat.map.uuid : "none";
    const key = `${mat.color.getHex()}_${mapKey}_${mat.transparent}_${mat.blending}_${mat.depthWrite}_${mat.depthTest}_${mat.side}`;

    let list = _matPool.get(key);
    if (!list) {
        list = [];
        _matPool.set(key, list);
    }
    if (list.length < 40) {
        list.push(mat);
    } else {
        mat.dispose();
    }
}

// ═══════════════════════════════════════════════════════════════
// Active FX management
// ═══════════════════════════════════════════════════════════════
const MAX_FX_HARSH = 150;
export const activeFX: Array<{ update: (delta: number) => boolean }> = [];

export function updateFX(delta: number) {
    for (let i = activeFX.length - 1; i >= 0; i--) {
        if (!activeFX[i].update(delta)) activeFX.splice(i, 1);
    }
}

export function canSpawnFX(): boolean {
    return activeFX.length < MAX_FX_HARSH;
}

export function fxQualityScale(): number {
    const n = activeFX.length;
    if (n < 5) return 1.0;
    if (n < 12) return 0.4;
    return 0.15;
}

// ═══════════════════════════════════════════════════════════════
// Reusable helpers
// ═══════════════════════════════════════════════════════════════
const _camQuad = new THREE.Quaternion();
export function getCamQuad(): THREE.Quaternion {
    _camQuad.copy(camera.quaternion);
    return _camQuad;
}

export const _tempObj = new THREE.Object3D();

export function spawnScreenFlash(
    scene: THREE.Scene,
    pos: THREE.Vector3,
    color: number,
    size: number,
): THREE.Mesh {
    const geo = new THREE.PlaneGeometry(size, size);
    const mat = new THREE.MeshBasicMaterial({
        map: lightTex,
        color,
        transparent: true,
        opacity: 1.0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(pos);
    mesh.quaternion.copy(getCamQuad());
    scene.add(mesh);
    return mesh;
}

// Generic explosion helper
export function spawnExplosion(
    scene: THREE.Scene,
    pos: THREE.Vector3,
    color: number,
    count: number = 20,
    size: number = 0.25,
) {
    const qScale = fxQualityScale();
    const actualCount = Math.max(4, Math.round(count * qScale));
    if (!canSpawnFX()) return;

    const geo = pooledPlane(size, size);
    const mat = getPooledMaterial({
        map: sparkTex,
        color,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
    });
    const instancedMesh = new THREE.InstancedMesh(geo, mat, actualCount);
    instancedMesh.frustumCulled = false;
    scene.add(instancedMesh);

    const positions: THREE.Vector3[] = [];
    const velocities: THREE.Vector3[] = [];
    const rotations: number[] = [];

    for (let i = 0; i < actualCount; i++) {
        positions.push(pos.clone());
        rotations.push(Math.random() * Math.PI * 2);

        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(Math.random() * 2 - 1);
        const speed = 1.2 + Math.random() * 2.5;
        velocities.push(
            new THREE.Vector3(
                Math.sin(phi) * Math.cos(theta) * speed,
                Math.sin(phi) * Math.sin(theta) * speed + 0.7,
                Math.cos(phi) * speed,
            ),
        );
    }

    let age = 0;
    const duration = 0.5;
    activeFX.push({
        update(delta) {
            age += delta;
            const t = Math.min(1, age / duration);
            if (t >= 1) {
                scene.remove(instancedMesh);
                instancedMesh.dispose();
                releasePooledMaterial(mat);
                return false;
            }
            const et = easeOutCubic(t);
            mat.opacity = 1 - et;

            const cq = camera.quaternion;
            for (let i = 0; i < actualCount; i++) {
                positions[i].addScaledVector(velocities[i], delta);

                _tempObj.position.copy(positions[i]);
                _tempObj.quaternion.copy(cq);
                _tempObj.rotateZ(rotations[i]);
                _tempObj.scale.setScalar(1 - et);
                _tempObj.updateMatrix();

                instancedMesh.setMatrixAt(i, _tempObj.matrix);
            }
            instancedMesh.instanceMatrix.needsUpdate = true;
            return true;
        },
    });
}

export function spawnBlueFlamethrower(
    scene: THREE.Scene,
    position: THREE.Vector3,
    direction: THREE.Vector3,
    duration = 1.0,
) {
    if (!canSpawnFX()) return;

    const qScale = fxQualityScale();

    const maxCore = Math.max(10, Math.round(50 * qScale));
    const maxSmoke = Math.max(5, Math.round(30 * qScale));
    const maxEmber = Math.max(10, Math.round(40 * qScale));

    const geo = pooledPlane(1.0, 1.0);

    const coreMat = new THREE.ShaderMaterial({
        uniforms: { uMap: { value: blueFlameCoreTex } },
        vertexShader: `
            attribute float aFrameIdx;
            attribute float aOpacity;
            varying vec2 vUv;
            varying float vOpacity;
            void main() {
                float c = mod(aFrameIdx, 3.0);
                float r = floor(aFrameIdx / 3.0);
                vUv = vec2((c + uv.x) / 3.0, 1.0 - (r + 1.0 - uv.y) / 6.0);
                vOpacity = aOpacity;
                gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform sampler2D uMap;
            varying vec2 vUv;
            varying float vOpacity;
            void main() {
                vec4 tex = texture2D(uMap, vUv);
                if (tex.a < 0.05) discard;
                vec3 cyan = vec3(0.0, 0.65, 1.0);
                gl_FragColor = vec4(tex.rgb * cyan * 1.5, tex.a * vOpacity);
            }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
    });

    const aCoreFrameIdx = new Float32Array(maxCore);
    const aCoreOpacity = new Float32Array(maxCore);
    const coreMesh = new THREE.InstancedMesh(geo, coreMat, maxCore);
    coreMesh.frustumCulled = false;
    coreMesh.geometry.setAttribute("aFrameIdx", new THREE.InstancedBufferAttribute(aCoreFrameIdx, 1));
    coreMesh.geometry.setAttribute("aOpacity", new THREE.InstancedBufferAttribute(aCoreOpacity, 1));
    scene.add(coreMesh);

    const smokeMat = new THREE.ShaderMaterial({
        uniforms: { uMap: { value: blueFlameSmokeTex } },
        vertexShader: `
            attribute float aFrameIdx;
            attribute float aOpacity;
            varying vec2 vUv;
            varying float vOpacity;
            void main() {
                float c = mod(aFrameIdx, 2.0);
                float r = floor(aFrameIdx / 2.0);
                vUv = vec2((c + uv.x) / 2.0, 1.0 - (r + 1.0 - uv.y) / 2.0);
                vOpacity = aOpacity;
                gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform sampler2D uMap;
            varying vec2 vUv;
            varying float vOpacity;
            void main() {
                vec4 tex = texture2D(uMap, vUv);
                if (tex.a < 0.05) discard;
                vec3 darkBlue = vec3(0.0, 0.3, 0.8);
                gl_FragColor = vec4(tex.rgb * darkBlue, tex.a * vOpacity * 0.45);
            }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.NormalBlending,
        side: THREE.DoubleSide,
    });

    const aSmokeFrameIdx = new Float32Array(maxSmoke);
    const aSmokeOpacity = new Float32Array(maxSmoke);
    const smokeMesh = new THREE.InstancedMesh(geo, smokeMat, maxSmoke);
    smokeMesh.frustumCulled = false;
    smokeMesh.geometry.setAttribute("aFrameIdx", new THREE.InstancedBufferAttribute(aSmokeFrameIdx, 1));
    smokeMesh.geometry.setAttribute("aOpacity", new THREE.InstancedBufferAttribute(aSmokeOpacity, 1));
    scene.add(smokeMesh);

    const emberMat = new THREE.MeshBasicMaterial({
        map: blueFlameEmberTex,
        color: 0x00e5ff,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
    });
    const emberMesh = new THREE.InstancedMesh(geo, emberMat, maxEmber);
    emberMesh.frustumCulled = false;
    scene.add(emberMesh);

    const hideMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < maxCore; i++) {
        coreMesh.setMatrixAt(i, hideMatrix);
        aCoreOpacity[i] = 0;
    }
    for (let i = 0; i < maxSmoke; i++) {
        smokeMesh.setMatrixAt(i, hideMatrix);
        aSmokeOpacity[i] = 0;
    }
    for (let i = 0; i < maxEmber; i++) {
        emberMesh.setMatrixAt(i, hideMatrix);
    }

    interface Particle {
        pos: THREE.Vector3;
        vel: THREE.Vector3;
        scale: number;
        maxScale: number;
        age: number;
        life: number;
        rotation: number;
        rotVel: number;
    }

    const cores: Particle[] = [];
    const smokes: Particle[] = [];
    const embers: Particle[] = [];

    let totalAge = 0;
    let spawnAccumulator = 0;
    const spawnRate = 25;

    activeFX.push({
        update(delta) {
            totalAge += delta;
            const isStreaming = totalAge < duration;

            if (isStreaming) {
                spawnAccumulator += delta * spawnRate;
                while (spawnAccumulator >= 1.0) {
                    spawnAccumulator -= 1.0;

                    if (cores.length < maxCore) {
                        const spreadAngle = (Math.random() - 0.5) * 0.15;
                        const pDirection = direction.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), spreadAngle);
                        const speed = 4.0 + Math.random() * 2.0;
                        cores.push({
                            pos: position.clone(),
                            vel: pDirection.multiplyScalar(speed),
                            scale: 0.1,
                            maxScale: 1.0 + Math.random() * 0.6,
                            age: 0,
                            life: 0.4 + Math.random() * 0.2,
                            rotation: Math.random() * Math.PI * 2,
                            rotVel: (Math.random() - 0.5) * 2,
                        });
                    }

                    if (smokes.length < maxSmoke) {
                        const spreadAngle = (Math.random() - 0.5) * 0.4;
                        const pDirection = direction.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), spreadAngle);
                        const speed = 2.5 + Math.random() * 1.5;
                        smokes.push({
                            pos: position.clone(),
                            vel: pDirection.multiplyScalar(speed),
                            scale: 0.2,
                            maxScale: 1.5 + Math.random() * 1.0,
                            age: 0,
                            life: 0.6 + Math.random() * 0.3,
                            rotation: Math.random() * Math.PI * 2,
                            rotVel: (Math.random() - 0.5) * 1.0,
                        });
                    }

                    if (embers.length < maxEmber) {
                        const spreadAngle = (Math.random() - 0.5) * 0.6;
                        const pDirection = direction.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), spreadAngle);
                        const speed = 6.0 + Math.random() * 4.0;
                        embers.push({
                            pos: position.clone(),
                            vel: pDirection.multiplyScalar(speed),
                            scale: 0.05,
                            maxScale: 0.15 + Math.random() * 0.1,
                            age: 0,
                            life: 0.3 + Math.random() * 0.3,
                            rotation: Math.random() * Math.PI * 2,
                            rotVel: (Math.random() - 0.5) * 5,
                        });
                    }
                }
            }

            if (!isStreaming && cores.length === 0 && smokes.length === 0 && embers.length === 0) {
                scene.remove(coreMesh);
                scene.remove(smokeMesh);
                scene.remove(emberMesh);
                coreMesh.dispose();
                smokeMesh.dispose();
                emberMesh.dispose();
                coreMat.dispose();
                smokeMat.dispose();
                emberMat.dispose();
                return false;
            }

            const cq = camera.quaternion;

            for (let i = cores.length - 1; i >= 0; i--) {
                const p = cores[i];
                p.age += delta;
                if (p.age >= p.life) {
                    cores.splice(i, 1);
                    continue;
                }
                const t = p.age / p.life;
                p.pos.addScaledVector(p.vel, delta);
                p.pos.y += delta * 1.5;
                p.scale = THREE.MathUtils.lerp(p.maxScale * 0.2, p.maxScale, easeOutQuad(t));
                p.rotation += p.rotVel * delta;
            }

            for (let i = 0; i < maxCore; i++) {
                if (i < cores.length) {
                    const p = cores[i];
                    const t = p.age / p.life;
                    _tempObj.position.copy(p.pos);
                    _tempObj.quaternion.copy(cq);
                    _tempObj.rotateZ(p.rotation);
                    _tempObj.scale.setScalar(p.scale);
                    _tempObj.updateMatrix();

                    coreMesh.setMatrixAt(i, _tempObj.matrix);
                    aCoreOpacity[i] = 1.0 - t;
                    aCoreFrameIdx[i] = Math.min(17, Math.floor(t * 18));
                } else {
                    coreMesh.setMatrixAt(i, hideMatrix);
                    aCoreOpacity[i] = 0;
                }
            }
            coreMesh.instanceMatrix.needsUpdate = true;
            (coreMesh.geometry.attributes.aFrameIdx as THREE.InstancedBufferAttribute).needsUpdate = true;
            (coreMesh.geometry.attributes.aOpacity as THREE.InstancedBufferAttribute).needsUpdate = true;

            for (let i = smokes.length - 1; i >= 0; i--) {
                const p = smokes[i];
                p.age += delta;
                if (p.age >= p.life) {
                    smokes.splice(i, 1);
                    continue;
                }
                const t = p.age / p.life;
                p.pos.addScaledVector(p.vel, delta);
                p.pos.y += delta * 2.5;
                p.scale = THREE.MathUtils.lerp(p.maxScale * 0.3, p.maxScale, t);
                p.rotation += p.rotVel * delta;
            }

            for (let i = 0; i < maxSmoke; i++) {
                if (i < smokes.length) {
                    const p = smokes[i];
                    const t = p.age / p.life;
                    _tempObj.position.copy(p.pos);
                    _tempObj.quaternion.copy(cq);
                    _tempObj.rotateZ(p.rotation);
                    _tempObj.scale.setScalar(p.scale);
                    _tempObj.updateMatrix();

                    smokeMesh.setMatrixAt(i, _tempObj.matrix);
                    aSmokeOpacity[i] = 1.0 - t;
                    aSmokeFrameIdx[i] = Math.min(3, Math.floor(t * 4));
                } else {
                    smokeMesh.setMatrixAt(i, hideMatrix);
                    aSmokeOpacity[i] = 0;
                }
            }
            smokeMesh.instanceMatrix.needsUpdate = true;
            (smokeMesh.geometry.attributes.aFrameIdx as THREE.InstancedBufferAttribute).needsUpdate = true;
            (smokeMesh.geometry.attributes.aOpacity as THREE.InstancedBufferAttribute).needsUpdate = true;

            for (let i = embers.length - 1; i >= 0; i--) {
                const p = embers[i];
                p.age += delta;
                if (p.age >= p.life) {
                    emberMesh.setMatrixAt(i, hideMatrix);
                    embers.splice(i, 1);
                    continue;
                }
                const t = p.age / p.life;
                p.pos.addScaledVector(p.vel, delta);
                p.pos.y += Math.sin(totalAge * 10 + i) * 0.5 * delta;
                p.scale = THREE.MathUtils.lerp(p.maxScale, 0.01, t);
            }

            for (let i = 0; i < maxEmber; i++) {
                if (i < embers.length) {
                    const p = embers[i];
                    _tempObj.position.copy(p.pos);
                    _tempObj.quaternion.copy(cq);
                    _tempObj.scale.setScalar(p.scale);
                    _tempObj.updateMatrix();

                    emberMesh.setMatrixAt(i, _tempObj.matrix);
                } else {
                    emberMesh.setMatrixAt(i, hideMatrix);
                }
            }
            emberMesh.instanceMatrix.needsUpdate = true;

            return true;
        },
    });
}

export function spawnGasExplosionFX(scene: THREE.Scene, pos: THREE.Vector3, team?: number): void {
    if (!canSpawnFX()) return;
    const isBlue = team === 1;

    // 1. Glow Emitter
    const glowGeo = pooledPlane(5.75, 5.75);
    const glowMat = new THREE.MeshBasicMaterial({
        map: gasExplosionGlowTex,
        color: isBlue ? 0x00aaff : 0xffaa00,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide
    });
    const glowMesh = new THREE.Mesh(glowGeo, glowMat);
    glowMesh.position.copy(pos).y += 0.1;
    glowMesh.rotation.x = -Math.PI / 2;
    scene.add(glowMesh);

    // 2. Cloud Burst (2x2 sprite animation, count 14)
    const cloudCount = 14;
    const cloudGeo = pooledPlane(1.1, 1.1);
    const cloudMat = new THREE.ShaderMaterial({
        uniforms: { 
            uMap: { value: gasExplosionCloudTex },
            uColor: { value: isBlue ? new THREE.Color(0.0, 0.4, 0.9) : new THREE.Color(0.9, 0.2, 0.0) }
        },
        vertexShader: `
            attribute float aFrameIdx;
            attribute float aOpacity;
            varying vec2 vUv;
            varying float vOpacity;
            void main() {
                float c = mod(aFrameIdx, 2.0);
                float r = floor(aFrameIdx / 2.0);
                vUv = vec2((c + uv.x) / 2.0, 1.0 - (r + 1.0 - uv.y) / 2.0);
                vOpacity = aOpacity;
                gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform sampler2D uMap;
            uniform vec3 uColor;
            varying vec2 vUv;
            varying float vOpacity;
            void main() {
                vec4 tex = texture2D(uMap, vUv);
                if (tex.a < 0.05) discard;
                gl_FragColor = vec4(tex.rgb * uColor, tex.a * vOpacity * 0.85);
            }
        `,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide
    });
    const cloudMesh = new THREE.InstancedMesh(cloudGeo, cloudMat, cloudCount);
    cloudMesh.frustumCulled = false;
    scene.add(cloudMesh);

    const aCloudFrameIdx = new Float32Array(cloudCount);
    const aCloudOpacity = new Float32Array(cloudCount);
    cloudMesh.geometry.setAttribute("aFrameIdx", new THREE.InstancedBufferAttribute(aCloudFrameIdx, 1));
    cloudMesh.geometry.setAttribute("aOpacity", new THREE.InstancedBufferAttribute(aCloudOpacity, 1));

    const cloudOffsets: THREE.Vector3[] = [];
    const cloudVels: THREE.Vector3[] = [];
    const cloudLifetimes: number[] = [];
    const cloudDurations: number[] = [];
    for (let i = 0; i < cloudCount; i++) {
        cloudOffsets.push(new THREE.Vector3());
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(Math.random() * 2 - 1);
        const speed = 1.0 + Math.random() * 5.0;
        cloudVels.push(
            new THREE.Vector3(
                Math.sin(phi) * Math.cos(theta) * speed,
                Math.abs(Math.sin(phi) * Math.sin(theta) * speed) * 0.8 + 0.5,
                Math.cos(phi) * speed
            )
        );
        cloudLifetimes.push(0);
        cloudDurations.push(0.5 + Math.random() * 0.2); // ~0.6s
    }

    let age = 0;
    const duration = 0.85;

    activeFX.push({
        update(delta) {
            age += delta;
            const t = Math.min(1, age / duration);

            if (t >= 1) {
                scene.remove(glowMesh);
                scene.remove(cloudMesh);

                glowMat.dispose();
                cloudMat.dispose();

                cloudMesh.dispose();
                return false;
            }

            // Update Glow
            const glowT = Math.min(1, age / 0.3);
            glowMesh.scale.setScalar(1.0 + glowT * 4.75);
            glowMat.opacity = 1.0 - easeOutCubic(glowT);

            const cq = camera.quaternion;

            // Update Cloud Burst
            for (let i = 0; i < cloudCount; i++) {
                cloudLifetimes[i] += delta;
                const pct = Math.min(1, cloudLifetimes[i] / cloudDurations[i]);
                
                cloudOffsets[i].addScaledVector(cloudVels[i], delta);
                cloudVels[i].multiplyScalar(0.92);

                const frameIdx = Math.floor(pct * 3.99); // 0 to 3 frames
                aCloudFrameIdx[i] = frameIdx;
                aCloudOpacity[i] = 1.0 - pct;

                _tempObj.position.copy(pos).add(cloudOffsets[i]);
                _tempObj.quaternion.copy(cq);
                _tempObj.scale.setScalar(0.5 + pct * 1.6);
                _tempObj.updateMatrix();
                cloudMesh.setMatrixAt(i, _tempObj.matrix);
            }
            cloudMesh.instanceMatrix.needsUpdate = true;
            (cloudMesh.geometry.getAttribute("aFrameIdx") as THREE.InstancedBufferAttribute).needsUpdate = true;
            (cloudMesh.geometry.getAttribute("aOpacity") as THREE.InstancedBufferAttribute).needsUpdate = true;

            return true;
        }
    });
}

