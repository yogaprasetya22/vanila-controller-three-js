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

    constructor(scene: THREE.Scene, uniforms: { uTime: { value: number } }) {
        const bladesPerClump = 5;
        // ponytail: expanded coverage from 180x140 to 860x860 to match the new open world size
        const worldW = 860;
        const worldH = 860;

        // ── Spatial grid for patches (denser cells for a lush, rich forest carpet) ──
        const cellW = 13.5;
        const cellH = 13.5;
        const cellsX = Math.ceil(worldW / cellW); // 27
        const cellsZ = Math.ceil(worldH / cellH); // 21
        const x0 = -worldW / 2;
        const z0 = -worldH / 2;

        // ── Density function: dense in forest, zero on battlefield, zero near lakes ──
        const densityAt = (x: number, z: number): number => {
            const h = getTerrainHeight(x, z);

            // Compute battlefield → forest factor
            const dxEdge = Math.max(0, Math.abs(x) - BF_HALF_X);
            const dzEdge = Math.max(0, Math.abs(z) - BF_HALF_Z);
            const edgeDist = Math.sqrt(dxEdge * dxEdge + dzEdge * dzEdge);
            const forestFactor = smoothstep(0, BF_BLEND, edgeDist);

            // No grass in lake bowls
            const wet = lakeWetness(x, z);
            if (wet > 0.3) return 0;

            // No grass on flat battlefield
            if (forestFactor < 0.05) return 0;

            // Density scales with forest factor and terrain elevation (grows up on high valleys)
            if (h < 0.2) return forestFactor * 0.6;
            if (h < 1.0) return forestFactor * 0.85;
            if (h < 4.0) return forestFactor * 0.65;
            if (h < 12.0) return forestFactor * 0.35;
            return 0;
        };

        // ── Generate patches ──
        const patches: Patch[] = [];
        const rng = mulberry32(42); // deterministic seed

        for (let ci = 0; ci < cellsX; ci++) {
            for (let cj = 0; cj < cellsZ; cj++) {
                const cxCell = x0 + ci * cellW + cellW / 2;
                const czCell = z0 + cj * cellH + cellH / 2;
                const d = densityAt(cxCell, czCell);
                if (d <= 0) continue;

                // ponytail: increased patches multiplier from 6 to 9 for a denser forest floor
                const maxPatches = Math.floor(d * 9);
                const numPatches =
                    maxPatches > 0 ? 1 + Math.floor(rng() * maxPatches) : 0;

                for (let p = 0; p < numPatches; p++) {
                    const px = cxCell + (rng() - 0.5) * cellW * 0.8;
                    const pz = czCell + (rng() - 0.5) * cellH * 0.8;
                    const hCheck = getTerrainHeight(px, pz);

                    // Skip underwater or lake area
                    if (hCheck < -0.05) continue;
                    if (lakeWetness(px, pz) > 0.35) continue;

                    // Re-check forest factor at exact position
                    const pdxEdge = Math.max(0, Math.abs(px) - BF_HALF_X);
                    const pdzEdge = Math.max(0, Math.abs(pz) - BF_HALF_Z);
                    const pEdgeDist = Math.sqrt(
                        pdxEdge * pdxEdge + pdzEdge * pdzEdge,
                    );
                    if (pEdgeDist < 1.0) continue; // too close to battlefield

                    // Limit on steep slopes
                    const nx = getTerrainHeight(px + 1, pz) - hCheck;
                    const nz = getTerrainHeight(px, pz + 1) - hCheck;
                    const steepness = Math.sqrt(nx * nx + nz * nz);
                    if (steepness > 1.5) continue;

                    // ponytail: increased tuft count from 4-10 to 6-14 tufts per patch
                    const count = 6 + Math.floor(rng() * 9); // 6–14 tufts
                    patches.push({ cx: px, cz: pz, count });
                }
            }
        }

        const totalClumps = patches.reduce((s, p) => s + p.count, 0);
        const totalVertices = totalClumps * bladesPerClump * 3;

        // ── Build single merged geometry ──
        const positions = new Float32Array(totalVertices * 3);
        const params = new Float32Array(totalVertices * 4);
        const clumpOffsets = new Float32Array(totalVertices * 3);
        const colorVars = new Float32Array(totalVertices);

        const colorBottom = new THREE.Color(0x4a6530);
        const colorTop = new THREE.Color(0x8dbd4a);

        let vi = 0;
        for (const patch of patches) {
            const py = getTerrainHeight(patch.cx, patch.cz);

            for (let t = 0; t < patch.count; t++) {
                // Random offset within patch radius
                const angle = rng() * Math.PI * 2;
                const dist = rng() * 1.2;
                const tx = patch.cx + Math.cos(angle) * dist;
                const tz = patch.cz + Math.sin(angle) * dist;
                const ty = getTerrainHeight(tx, tz);

                // Skip if steep within patch
                if (Math.abs(ty - py) > 0.8) continue;

                const baseRotation = rng() * Math.PI * 2;
                const clumpScaleY = 0.6 + rng() * 0.6;
                const clumpScaleX = 0.6 + rng() * 0.5;

                for (let b = 0; b < bladesPerClump; b++) {
                    const fanAngle =
                        (b / bladesPerClump - 0.5) * Math.PI * 0.65;
                    const angleOffset = fanAngle + (rng() - 0.5) * 0.3;
                    const clumpDist = 0.06 + b * 0.05 + rng() * 0.06;
                    const cx = Math.cos(baseRotation + angleOffset) * clumpDist;
                    const cz = Math.sin(baseRotation + angleOffset) * clumpDist;

                    const bladeScaleY = clumpScaleY * (0.75 + rng() * 0.5);
                    const bladeScaleX = clumpScaleX * (0.7 + rng() * 0.6);
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
                        clumpOffsets[oi + 2] = angleOffset;

                        colorVars[vi] = colorVar;
                        vi++;
                    }
                }
            }
        }

        // Trim to actual
        const actualVerts = vi;
        if (actualVerts === 0) return;

        const trimPos = new Float32Array(positions.buffer, 0, actualVerts * 3);
        const trimParams = new Float32Array(params.buffer, 0, actualVerts * 4);
        const trimOff = new Float32Array(
            clumpOffsets.buffer,
            0,
            actualVerts * 3,
        );
        const trimCol = new Float32Array(colorVars.buffer, 0, actualVerts);

        const geo = new THREE.BufferGeometry();
        geo.setAttribute(
            "position",
            new THREE.BufferAttribute(new Float32Array(trimPos), 3),
        );
        geo.setAttribute(
            "aGrassParams",
            new THREE.BufferAttribute(new Float32Array(trimParams), 4),
        );
        geo.setAttribute(
            "aClumpOffset",
            new THREE.BufferAttribute(new Float32Array(trimOff), 3),
        );
        geo.setAttribute(
            "aColorVar",
            new THREE.BufferAttribute(new Float32Array(trimCol), 1),
        );
        geo.computeBoundingSphere();

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

                    // ponytail: collapse grass blade scale to 0.0 if further than 100 meters from camera to save render cost
                    vec4 worldPos = modelMatrix * vec4(position, 1.0);
                    float distToCam = distance(cameraPosition, worldPos.xyz);
                    if (distToCam > 100.0) {
                        scaleY = 0.0;
                        scaleX = 0.0;
                    } else if (distToCam > 85.0) {
                        // Smooth fade-out scale between 85m and 100m
                        float fade = 1.0 - (distToCam - 85.0) / 15.0;
                        scaleY *= fade;
                        scaleX *= fade;
                    }

                    float bladeWidth  = 0.09 * scaleX;
                    float bladeHeight = 0.55 * scaleY;

                    vec3 localOffset = vec3(0.0);
                    if (vertexIdx < 0.5) {
                        localOffset.y = bladeHeight;
                    } else if (vertexIdx < 1.5) {
                        localOffset.x = -bladeWidth * 0.3;
                    } else {
                        localOffset.x = bladeWidth * 0.3;
                    }

                    float rot = baseRot + aClumpOffset.z;
                    float cr = cos(rot);
                    float sr = sin(rot);

                    vec3 rotated = vec3(
                        localOffset.x * cr + aClumpOffset.x,
                        localOffset.y,
                        localOffset.x * sr + aClumpOffset.y
                    );

                    float worldX = position.x + rotated.x;
                    float worldZ = position.z + rotated.z;
                    float heightRatio = rotated.y / 0.55;

                    float wind1 = sin(uTime * 1.5 + worldX * 1.5 + worldZ) * 0.12;
                    float wind2 = sin(uTime * 3.8 + worldX * 3.5 + worldZ * 2.0) * 0.05;
                    float wind = (wind1 + wind2) * heightRatio * heightRatio;

                    rotated.x += wind;
                    rotated.z += wind * 0.35;

                    float tipness = vertexIdx < 0.5 ? 1.0 : 0.0;
                    vec3 baseColor = mix(colorBottom, colorTop, tipness);
                    float variation = 0.82 + aColorVar * 0.36;
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

        const mesh = new THREE.Mesh(geo, grassMat);
        mesh.frustumCulled = true;
        scene.add(mesh);
        this.meshes.push(mesh);
    }
}

/** Deterministic PRNG for reproducible patch placement */
function mulberry32(a: number): () => number {
    return () => {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
