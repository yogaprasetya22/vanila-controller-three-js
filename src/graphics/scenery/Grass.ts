import * as THREE from "three";
import {
    getTerrainHeight,
    BF_HALF_X,
    BF_HALF_Z,
    BF_BLEND,
    LAKES,
} from "../../simulation/constants";

/**
 * Grass.ts — Clustered natural grass patches.
 * World divided into 12×9 large cells (each ~6.7×6.7 units).
 * Each cell gets 0–6 clump patches based on terrain height.
 * Each patch = 4–10 tufts clustered within 1.2 unit radius.
 * Total: ~500 patches × ~7 tufts × 5 blades ≈ 17,500 visual blades.
 * Two-frequency wind, per-blade color variation, Early-Z enabled.
 *
 * Density: zero on flat battlefield, dense on forest slopes, zero near lake centers.
 */

interface Patch {
    cx: number;
    cz: number;
    count: number;
}

function smoothstep(e0: number, e1: number, x: number): number {
    const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
}

/** How deep inside a lake bowl (0=outside, 1=deepest center) */
function lakeWetness(x: number, z: number): number {
    let maxWet = 0;
    for (const lake of LAKES) {
        const dx = (x - lake.cx) / lake.rx;
        const dz = (z - lake.cz) / lake.rz;
        const distSq = dx * dx + dz * dz;
        const wet = Math.exp(-distSq * 0.5);
        if (wet > maxWet) maxWet = wet;
    }
    return maxWet;
}

export class Grass {
    meshes: THREE.Mesh[] = [];
    chunkCenters: THREE.Vector3[] = [];

    constructor(scene: THREE.Scene, uniforms: { uTime: { value: number } }) {
        const bladesPerClump = 1; // 1 Wide Stylized Triangle per clump = ultra featherlight 60 FPS
        // ponytail: Full 2400x2400m open-world coverage with high-density, ultra-optimized meadow.
        const worldW = 2400;
        const worldH = 2400;

        // ── Spatial grid for patches ──
        const cellW = 12.0;
        const cellH = 12.0;
        const cellsX = Math.ceil(worldW / cellW);
        const cellsZ = Math.ceil(worldH / cellH);
        const x0 = -worldW / 2;
        const z0 = -worldH / 2;

        // ── Chunk Configuration (64m chunks for ultra-responsive frustum culling) ──
        const chunkSize = 64; 
        const chunksPerAxis = Math.ceil(worldW / chunkSize);
        const chunkPatches: Patch[][] = Array.from({ length: chunksPerAxis * chunksPerAxis }, () => []);

        // ── Density function ──
        const densityAt = (x: number, z: number): number => {
            const h = getTerrainHeight(x, z);

            const dxEdge = Math.max(0, Math.abs(x) - BF_HALF_X);
            const dzEdge = Math.max(0, Math.abs(z) - BF_HALF_Z);
            const edgeDist = Math.sqrt(dxEdge * dxEdge + dzEdge * dzEdge);
            const forestFactor = smoothstep(0, BF_BLEND, edgeDist);

            const wet = lakeWetness(x, z);
            if (wet > 0.3) return 0;
            if (forestFactor < 0.05) return 0;

            if (h < 0.2) return forestFactor * 0.90;
            if (h < 1.0) return forestFactor * 1.0;
            if (h < 4.0) return forestFactor * 0.98;
            if (h < 12.0) return forestFactor * 0.75;
            return 0;
        };

        const rng = mulberry32(42);

        for (let ci = 0; ci < cellsX; ci++) {
            for (let cj = 0; cj < cellsZ; cj++) {
                const cxCell = x0 + ci * cellW + cellW / 2;
                const czCell = z0 + cj * cellH + cellH / 2;
                const d = densityAt(cxCell, czCell);
                if (d <= 0) continue;

                // 3-6 multi-clump patches per cell to make meadow look lush and dense
                const numPatches = 3 + Math.floor(rng() * (d * 3.5));

                for (let p = 0; p < numPatches; p++) {
                    const px = cxCell + (rng() - 0.5) * cellW * 0.92;
                    const pz = czCell + (rng() - 0.5) * cellH * 0.92;
                    const hCheck = getTerrainHeight(px, pz);

                    if (hCheck < -0.05) continue;
                    if (lakeWetness(px, pz) > 0.35) continue;

                    const pdxEdge = Math.max(0, Math.abs(px) - BF_HALF_X);
                    const pdzEdge = Math.max(0, Math.abs(pz) - BF_HALF_Z);
                    const pEdgeDist = Math.sqrt(pdxEdge * pdxEdge + pdzEdge * pdzEdge);
                    if (pEdgeDist < 1.0) continue;

                    const nx = getTerrainHeight(px + 1, pz) - hCheck;
                    const nz = getTerrainHeight(px, pz + 1) - hCheck;
                    const steepness = Math.sqrt(nx * nx + nz * nz);
                    if (steepness > 1.5) continue;

                    const count = 14 + Math.floor(rng() * 12); // 14-25 clumps per patch for dense anime carpet
                    const patch = { cx: px, cz: pz, count };

                    const chunkX = Math.min(chunksPerAxis - 1, Math.max(0, Math.floor((px - x0) / chunkSize)));
                    const chunkZ = Math.min(chunksPerAxis - 1, Math.max(0, Math.floor((pz - z0) / chunkSize)));
                    const chunkIdx = chunkZ * chunksPerAxis + chunkX;
                    chunkPatches[chunkIdx].push(patch);
                }
            }
        }

        // Cartoon / Anime Studio Ghibli Grass Palette
        const colorBottom = new THREE.Color(0x1a461a); // Rich moss emerald base
        const colorTop = new THREE.Color(0xa8f238);    // Luminous sunlit anime chartreuse tip

        // Single shared material
        const grassMat = new THREE.ShaderMaterial({
            uniforms: {
                uTime: uniforms.uTime,
                colorBottom: { value: colorBottom },
                colorTop: { value: colorTop },
            },
            vertexShader: /* glsl */ `
                uniform float uTime;
                uniform vec3 colorBottom;
                uniform vec3 colorTop;
                attribute vec4 aGrassParams;
                attribute vec3 aClumpOffset;
                attribute float aColorVar;
                varying vec3 vColor;

                void main() {
                    float vertexIdx = aGrassParams.x;
                    float baseRot   = aGrassParams.y;
                    float scaleY    = aGrassParams.z;
                    float scaleX    = aGrassParams.w;

                    vec4 worldPos = modelMatrix * vec4(position, 1.0);
                    float distToCam = distance(cameraPosition, worldPos.xyz);
                    if (distToCam > 72.0) {
                        scaleY = 0.0;
                        scaleX = 0.0;
                    } else if (distToCam > 48.0) {
                        float fade = 1.0 - (distToCam - 48.0) / 24.0;
                        scaleY *= fade;
                        scaleX *= fade;
                    }

                    // ponytail: Wide stylized 1-triangle clump silhouette for lush cartoon coverage
                    float bladeWidth  = 0.58 * scaleX;
                    float bladeHeight = 0.95 * scaleY;

                    vec3 localOffset = vec3(0.0);
                    if (vertexIdx < 0.5) {
                        localOffset.y = bladeHeight;
                    } else if (vertexIdx < 1.5) {
                        localOffset.x = -bladeWidth * 0.5;
                    } else {
                        localOffset.x = bladeWidth * 0.5;
                    }

                    float angleToCamera = atan(worldPos.z - cameraPosition.z, worldPos.x - cameraPosition.x) - 1.57079632679;
                    float rot = angleToCamera;
                    float cr = cos(rot);
                    float sr = sin(rot);

                    vec3 rotated = vec3(
                        localOffset.x * cr + aClumpOffset.x,
                        localOffset.y,
                        localOffset.x * sr + aClumpOffset.y
                    );

                    float worldX = worldPos.x + rotated.x;
                    float worldZ = worldPos.z + rotated.z;
                    float heightRatio = rotated.y / 0.95;

                    float wind1 = sin(uTime * 1.6 + worldX * 1.4 + worldZ) * 0.16;
                    float wind2 = sin(uTime * 3.8 + worldX * 3.2 + worldZ * 2.0) * 0.06;
                    float wind = (wind1 + wind2) * heightRatio * heightRatio;

                    rotated.x += wind;
                    rotated.z += wind * 0.35;

                    float tipness = vertexIdx < 0.5 ? 1.0 : 0.0;
                    vec3 baseColor = mix(colorBottom, colorTop, tipness);
                    float variation = 0.88 + aColorVar * 0.25;
                    vColor = baseColor * variation;

                    vec3 transformed = position + rotated;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
                }
            `,
            fragmentShader: /* glsl */ `
                varying vec3 vColor;
                void main() {
                    gl_FragColor = vec4(vColor, 1.0);
                }
            `,
            side: THREE.DoubleSide,
            transparent: false,
            depthWrite: true,
            depthTest: true,
        });

        // Instantiate chunks
        for (let chunkIdx = 0; chunkIdx < chunkPatches.length; chunkIdx++) {
            const patches = chunkPatches[chunkIdx];
            if (patches.length === 0) continue;

            const totalClumps = patches.reduce((s, p) => s + p.count, 0);
            const totalVertices = totalClumps * bladesPerClump * 3;

            const positions = new Float32Array(totalVertices * 3);
            const params = new Float32Array(totalVertices * 4);
            const clumpOffsets = new Float32Array(totalVertices * 3);
            const colorVars = new Float32Array(totalVertices);

            let vi = 0;
            for (const patch of patches) {
                const py = getTerrainHeight(patch.cx, patch.cz);

                for (let t = 0; t < patch.count; t++) {
                    const angle = rng() * Math.PI * 2;
                    const dist = rng() * 3.2;
                    const tx = patch.cx + Math.cos(angle) * dist;
                    const tz = patch.cz + Math.sin(angle) * dist;
                    const ty = getTerrainHeight(tx, tz);

                    if (Math.abs(ty - py) > 0.8) continue;

                    const baseRotation = rng() * Math.PI * 2;
                    const clumpScaleY = 0.85 + rng() * 0.55;
                    const clumpScaleX = 0.85 + rng() * 0.55;

                    for (let b = 0; b < bladesPerClump; b++) {
                        const cx = (rng() - 0.5) * 0.15;
                        const cz = (rng() - 0.5) * 0.15;

                        const bladeScaleY = clumpScaleY * (0.9 + rng() * 0.2);
                        const bladeScaleX = clumpScaleX * (0.9 + rng() * 0.2);
                        const colorVar = rng();

                        for (let v = 0; v < 3; v++) {
                            const idx = vi * 3;
                            positions[idx] = tx;
                            positions[idx + 1] = ty;
                            positions[idx + 2] = tz;

                            const pi = vi * 4;
                            params[pi] = v;
                            params[pi + 1] = baseRotation;
                            params[pi + 2] = bladeScaleY;
                            params[pi + 3] = bladeScaleX;

                            const oi = vi * 3;
                            clumpOffsets[oi] = cx;
                            clumpOffsets[oi + 1] = cz;
                            clumpOffsets[oi + 2] = 0;

                            colorVars[vi] = colorVar;
                            vi++;
                        }
                    }
                }
            }

            const actualVerts = vi;
            if (actualVerts === 0) continue;

            const trimPos = new Float32Array(positions.buffer, 0, actualVerts * 3);
            const trimParams = new Float32Array(params.buffer, 0, actualVerts * 4);
            const trimOff = new Float32Array(clumpOffsets.buffer, 0, actualVerts * 3);
            const trimCol = new Float32Array(colorVars.buffer, 0, actualVerts);

            const geo = new THREE.BufferGeometry();
            geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(trimPos), 3));
            geo.setAttribute("aGrassParams", new THREE.BufferAttribute(new Float32Array(trimParams), 4));
            geo.setAttribute("aClumpOffset", new THREE.BufferAttribute(new Float32Array(trimOff), 3));
            geo.setAttribute("aColorVar", new THREE.BufferAttribute(new Float32Array(trimCol), 1));
            geo.computeBoundingSphere();

            const mesh = new THREE.Mesh(geo, grassMat);
            // ponytail: avoid Three.js bounding sphere mismatch during vertex shader wind & lod transformations
            mesh.frustumCulled = false;

            const chunkX = (chunkIdx % chunksPerAxis) * chunkSize + x0 + chunkSize / 2;
            const chunkZ = Math.floor(chunkIdx / chunksPerAxis) * chunkSize + z0 + chunkSize / 2;
            const center = new THREE.Vector3(chunkX, getTerrainHeight(chunkX, chunkZ), chunkZ);

            scene.add(mesh);
            this.meshes.push(mesh);
            this.chunkCenters.push(center);
        }
    }

    update(camPos: THREE.Vector3) {
        // ponytail: 2D Horizontal distance check (75m radius = 5625 sq units) prevents flight altitude from falsely over-loading grass chunks
        const maxDistSq = 5625; // 75 * 75
        for (let i = 0; i < this.meshes.length; i++) {
            const mesh = this.meshes[i];
            const center = this.chunkCenters[i];
            const dx = camPos.x - center.x;
            const dz = camPos.z - center.z;
            mesh.visible = (dx * dx + dz * dz) < maxDistSq;
        }
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

