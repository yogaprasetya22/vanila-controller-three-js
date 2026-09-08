import * as THREE from "three";
import { getTerrainHeight } from "../../simulation/constants";

// ponytail: 1 PlaneGeometry + 5 specialized Shape Shaders.
// Pre-compiles 5 specialized, 100% branchless materials to avoid GPU instruction divergence.
// Uses Additive Blending and custom GLSL noise for premium, organic AAA energy effects.

const _sharedGeo = new THREE.PlaneGeometry(2.5, 2.5); // Larger size to prevent glow clipping

const VERTEX_SHADER = `
    varying vec2 vUv;
    void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

// Helper to compile a highly optimized, branchless fragment shader per shape
const createShapeShader = (shapeSdfAndFillGLSL: string) => new THREE.ShaderMaterial({
    uniforms: {
        uOutlineOnly: { value: 0 },
        uFill: { value: 0 },
        uBoom: { value: 0 },
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(0xff2200) },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: `
        uniform int uOutlineOnly;
        uniform float uFill;
        uniform float uBoom;
        uniform float uTime;
        uniform vec3 uColor;
        varying vec2 vUv;

        // Cheap 2D value noise for swirling energy aura
        float hash(vec2 p) {
            return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
        }
        float noise(vec2 p) {
            vec2 i = floor(p);
            vec2 f = fract(p);
            f = f * f * (3.0 - 2.0 * f);
            return mix(
                mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), f.x),
                mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
                f.y
            );
        }

        void main() {
            // Map UV to local coordinates [-1.25, 1.25]
            vec2 p = vUv * 2.5 - 1.25;

            float d = 1.0;
            float fillVal = 0.0;
            float fillMask = 0.0;

            ${shapeSdfAndFillGLSL}

            // Swirling organic noise using polar coordinates
            float theta = atan(p.y, p.x);
            float energyPattern = noise(vec2(theta * 2.5 - uTime * 3.5, length(p) * 2.0 - uTime * 1.5));
            energyPattern = mix(0.4, 1.0, energyPattern);

            // Shape mask with soft feathering
            float shapeMask = mix(
                smoothstep(0.01, -0.05, d),                  // Full mode: soft interior drop-off
                smoothstep(0.08, 0.0, abs(d)),              // Outline mode: soft border drop-off
                float(uOutlineOnly)
            ) * fillMask;

            if (shapeMask <= 0.01 && uBoom <= 0.01) {
                discard;
            }

            // ── Telegraph Phase (Core Glow + Additive Soft-edges) ──
            float pulse = 0.75 + 0.25 * sin(uTime * 5.0 + energyPattern * 2.0);
            
            // Bright scanline laser ring at the front of uFill progress
            float scanGlow = smoothstep(0.05, 0.0, abs(fillVal - uFill)) * 0.45;

            // HDR-like White-hot core glow on boundaries
            float borderGlow = smoothstep(0.1, 0.0, abs(d));
            float whiteHotCore = smoothstep(0.02, 0.0, abs(d)) * 0.85;

            float teleAlpha = shapeMask * (0.6 * pulse * energyPattern);
            teleAlpha = max(teleAlpha, (borderGlow * 0.35 + whiteHotCore * 0.6) * shapeMask);
            teleAlpha = max(teleAlpha, scanGlow * shapeMask);

            // ── Boom Phase (Shockwave flash) ──
            float boomPos = (1.0 - uBoom) * 0.85 + 0.15;
            float shockRing = smoothstep(boomPos - 0.06, boomPos, length(p)) * smoothstep(boomPos + 0.06, boomPos, length(p)) * uBoom * 3.0 * shapeMask;
            float flashDisc = (1.0 - smoothstep(0.0, 0.95, length(p))) * uBoom * 0.85 * shapeMask;
            float boomAlpha = max(shockRing, flashDisc);

            float alpha = max(teleAlpha, boomAlpha);

            // Dynamic HDR Color combining (uColor -> HDR White core -> Boom flash)
            vec3 finalCol = mix(uColor, vec3(1.0, 0.9, 0.6), uBoom);
            finalCol = mix(finalCol, vec3(1.0, 1.0, 1.0), (whiteHotCore * 0.5 + shockRing * 0.8) * shapeMask);

            gl_FragColor = vec4(finalCol, alpha);
        }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending, // Enable AAA Additive Glow blending
    side: THREE.DoubleSide,
});

// Specialized GLSL code blocks for each shape
const SHADERS = {
    Circle: createShapeShader(`
        d = length(p) - 1.0;
        fillVal = length(p);
        fillMask = step(fillVal, uFill);
    `),
    Cone: createShapeShader(`
        float angle = abs(atan(p.x, p.y));
        d = max(length(p) - 1.0, angle - 0.785);
        fillVal = length(p);
        fillMask = step(fillVal, uFill);
    `),
    Line: createShapeShader(`
        float dx = abs(p.x) - 0.18;
        float dy = abs(p.y) - 1.0;
        d = max(dx, dy);
        fillVal = p.y;
        fillMask = step(fillVal, uFill * 2.0 - 1.0);
    `),
    Ring: createShapeShader(`
        d = max(0.55 - length(p), length(p) - 1.0);
        fillVal = length(p);
        fillMask = step(fillVal, 0.55 + uFill * 0.45);
    `),
    Cross: createShapeShader(`
        float dx1 = abs(p.x) - 0.18;
        float dy1 = abs(p.y) - 1.0;
        float d_v = max(dx1, dy1);
        float dx2 = abs(p.y) - 0.18;
        float dy2 = abs(p.x) - 1.0;
        float d_h = max(dx2, dy2);
        d = max(min(d_v, d_h), length(p) - 1.0);
        fillVal = length(p);
        fillMask = step(fillVal, uFill);
    `),
};

interface SlamState {
    mesh: THREE.Mesh;
    materials: THREE.ShaderMaterial[];
    uniforms: {
        uOutlineOnly: { value: number };
        uFill: { value: number };
        uBoom: { value: number };
        uTime: { value: number };
        uColor: { value: THREE.Color };
    } | null;
    available: boolean;
    age: number;
    telegraphDuration: number;
    boomDuration: number;
    radius: number;
    phase: 0 | 1;
    onBoom: (() => void) | null;
    boomTriggered: boolean;
}

export class BossGroundSlamFX {
    private pool: SlamState[] = [];

    constructor(scene: THREE.Scene) {
        const matClones = [
            SHADERS.Circle.clone(),
            SHADERS.Cone.clone(),
            SHADERS.Line.clone(),
            SHADERS.Ring.clone(),
            SHADERS.Cross.clone(),
        ];

        for (let i = 0; i < 6; i++) {
            const geom = new THREE.PlaneGeometry(2.5, 2.5, 12, 12); // 12x12 subdivisions to fit terrain slopes
            const mesh = new THREE.Mesh(geom, matClones[0]);
            mesh.rotation.order = 'YXZ'; // Critical for flat ground orientation with Y yaw
            mesh.renderOrder = 2;
            mesh.visible = false;
            scene.add(mesh);

            this.pool.push({
                mesh,
                materials: matClones.map(m => m.clone()),
                uniforms: null,
                available: true,
                age: 0,
                telegraphDuration: 1.5,
                boomDuration: 0.4,
                radius: 5,
                phase: 0,
                onBoom: null,
                boomTriggered: false,
            });
        }
    }

    spawn(
        x: number,
        z: number,
        radius: number,
        telegraphDuration: number,
        onBoom: (() => void) | null,
        shapeMode = 0,
        outlineOnly = false,
        rotationY = 0,
        colorHex = 0xff2200
    ) {
        const s = this.pool.find((p) => p.available);
        if (!s) return;

        s.available = false;
        s.age = 0;
        s.radius = radius;
        s.telegraphDuration = telegraphDuration;
        s.phase = 0;
        s.onBoom = onBoom;
        s.boomTriggered = false;

        // Switch to the pre-compiled shape-specific material
        const activeMat = s.materials[shapeMode] || s.materials[0];
        s.mesh.material = activeMat;

        // Extract and assign shape-specific uniforms
        s.uniforms = activeMat.uniforms as any;
        s.uniforms!.uOutlineOnly.value = outlineOnly ? 1 : 0;
        s.uniforms!.uColor.value.setHex(colorHex);
        s.uniforms!.uFill.value = 0;
        s.uniforms!.uBoom.value = 0;
        s.uniforms!.uTime.value = 0;

        s.mesh.position.set(x, 0.0, z);
        s.mesh.rotation.set(-Math.PI / 2, rotationY, 0);
        s.mesh.scale.setScalar(radius);
        s.mesh.updateMatrixWorld(true);

        // Conform plane vertices to the sloped terrain contours
        const geom = s.mesh.geometry;
        const posAttr = geom.attributes.position;
        const count = posAttr.count;
        const tempV = new THREE.Vector3();

        for (let i = 0; i < count; i++) {
            tempV.set(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
            tempV.applyMatrix4(s.mesh.matrixWorld);
            const terrainY = getTerrainHeight(tempV.x, tempV.z);
            // Local Z maps to World Y after -PI/2 X rotation. Add 0.05m offset to float cleanly.
            posAttr.setZ(i, (terrainY + 0.05) / radius);
        }
        posAttr.needsUpdate = true;
        geom.computeVertexNormals();

        s.mesh.visible = true;
    }

    update(delta: number) {
        for (const s of this.pool) {
            if (s.available || !s.mesh.visible || !s.uniforms) continue;
            s.age += delta;
            s.uniforms.uTime.value += delta;

            if (s.phase === 0) {
                const t = s.age / s.telegraphDuration;
                s.uniforms.uFill.value = Math.min(1, t);
                if (t >= 1) {
                    s.phase = 1;
                    s.age = 0;
                    s.uniforms.uBoom.value = 1;
                    if (!s.boomTriggered && s.onBoom) {
                        s.boomTriggered = true;
                        s.onBoom();
                    }
                }
            } else {
                const t = s.age / s.boomDuration;
                s.uniforms.uBoom.value = Math.max(0, 1 - t);
                if (t >= 1) {
                    s.mesh.visible = false;
                    s.available = true;
                }
            }
        }
    }

    public dispose() {
        for (const s of this.pool) {
            // Clean up cloned materials and geometries
            s.materials.forEach(mat => mat.dispose());
            if (s.mesh.geometry) {
                s.mesh.geometry.dispose();
            }
            if (s.mesh.parent) {
                s.mesh.parent.remove(s.mesh);
            }
        }
        // Note: _sharedGeo is not disposed here because it is a file-level shared constant geometry.
        this.pool = [];
    }
}
