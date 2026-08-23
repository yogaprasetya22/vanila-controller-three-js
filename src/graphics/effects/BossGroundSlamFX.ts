import * as THREE from "three";

// ponytail: 1 RingGeometry + 1 ShaderMaterial, pool of 6 clones.
// Phase 1 (telegraph): red circle fills 0→1, pulsing + rotating warning stripes.
// Phase 2 (boom): expanding shockwave ring + white-hot flash + fade over 0.4s.
// Driven from render loop via update(delta) — no gsap, no setTimeout.

const _sharedGeo = new THREE.RingGeometry(0.82, 1.0, 64, 1);
_sharedGeo.rotateX(-Math.PI / 2); // flat on ground

const _sharedMat = new THREE.ShaderMaterial({
    uniforms: {
        uFill: { value: 0 },
        uBoom: { value: 0 },
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(0xff2200) },
    },
    vertexShader: `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform float uFill;
        uniform float uBoom;
        uniform float uTime;
        uniform vec3 uColor;
        varying vec2 vUv;
        void main() {
            // vUv.y: 0=inner, 1=outer (radial). vUv.x: 0→1 around ring (angular).
            float r = vUv.y;

            // ── Telegraph phase ──
            float fillEdge = 1.0 - smoothstep(uFill - 0.02, uFill + 0.02, r);
            float pulse = 0.6 + 0.4 * sin(uTime * 6.0);
            float stripes = step(0.5, fract(vUv.x * 12.0 + uTime * 0.4));
            float innerGlow = (1.0 - smoothstep(uFill - 0.15, uFill, r)) * 0.25 * pulse;
            float teleAlpha = fillEdge * 0.7 * pulse;
            teleAlpha = max(teleAlpha, innerGlow);
            teleAlpha *= mix(0.5, 1.0, stripes * fillEdge);

            // ── Boom phase ──
            float boomPos = (1.0 - uBoom) * 0.85 + 0.15;
            float shockRing = 1.0 - smoothstep(boomPos - 0.04, boomPos + 0.04, r);
            shockRing *= uBoom * 1.8;
            float flashDisc = (1.0 - smoothstep(0.0, 0.95, r)) * uBoom * 0.6;
            float boomAlpha = max(shockRing, flashDisc);

            // ── Combine ──
            float alpha = max(teleAlpha, boomAlpha);
            vec3 col = mix(uColor, vec3(1.0, 0.9, 0.5), uBoom);
            col = mix(col, vec3(1.0, 1.0, 0.95), shockRing * 0.6);

            gl_FragColor = vec4(col, alpha);
        }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
});

interface SlamState {
    mesh: THREE.Mesh;
    uniforms: { uFill: { value: number }; uBoom: { value: number }; uTime: { value: number } };
    available: boolean;
    age: number;
    telegraphDuration: number;
    boomDuration: number;
    radius: number;
    phase: 0 | 1; // 0=telegraph, 1=boom
    onBoom: (() => void) | null;
    boomTriggered: boolean;
}

export class BossGroundSlamFX {
    private pool: SlamState[] = [];

    constructor(scene: THREE.Scene) {
        for (let i = 0; i < 6; i++) {
            const mat = _sharedMat.clone();
            const mesh = new THREE.Mesh(_sharedGeo, mat);
            mesh.renderOrder = 2;
            mesh.visible = false;
            scene.add(mesh);
            this.pool.push({
                mesh,
                uniforms: mat.uniforms as {
                    uFill: { value: number };
                    uBoom: { value: number };
                    uTime: { value: number };
                },
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

    /**
     * Spawn a ground slam telegraph at (x, z).
     * @param x world x
     * @param z world z
     * @param radius AoE radius
     * @param telegraphDuration seconds before boom
     * @param onBoom callback fired once at boom moment (for damage check)
     */
    spawn(
        x: number,
        z: number,
        radius: number,
        telegraphDuration: number,
        onBoom: (() => void) | null,
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
        s.uniforms.uFill.value = 0;
        s.uniforms.uBoom.value = 0;
        s.uniforms.uTime.value = 0;

        s.mesh.position.set(x, 0.1, z);
        s.mesh.scale.setScalar(radius);
        s.mesh.visible = true;
    }

    update(delta: number) {
        for (const s of this.pool) {
            if (s.available || !s.mesh.visible) continue;
            s.age += delta;
            s.uniforms.uTime.value += delta;

            if (s.phase === 0) {
                // Telegraph: fill circle
                const t = s.age / s.telegraphDuration;
                s.uniforms.uFill.value = Math.min(1, t);
                if (t >= 1) {
                    s.phase = 1;
                    s.age = 0;
                    s.uniforms.uBoom.value = 1;
                    // Trigger damage callback at boom moment
                    if (!s.boomTriggered && s.onBoom) {
                        s.boomTriggered = true;
                        s.onBoom();
                    }
                }
            } else {
                // Boom: shockwave + flash + fade
                const t = s.age / s.boomDuration;
                s.uniforms.uBoom.value = Math.max(0, 1 - t);
                if (t >= 1) {
                    s.mesh.visible = false;
                    s.available = true;
                }
            }
        }
    }
}
