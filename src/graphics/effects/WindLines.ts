import * as THREE from 'three';

// Geometri Pita WindLineGeometry sederhana
function createWindLineGeometry(segments = 32): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    const vertices: number[] = [];
    const ratios: number[] = [];
    const sides: number[] = [];

    for (let i = 0; i <= segments; i++) {
        const ratio = i / segments;
        const z = -ratio * 12.0; // Panjang hembusan angin

        // Vertex kiri
        vertices.push(0, 0, z);
        ratios.push(ratio);
        sides.push(-0.5);

        // Vertex kanan
        vertices.push(0, 0, z);
        ratios.push(ratio);
        sides.push(0.5);
    }

    const indices: number[] = [];
    for (let i = 0; i < segments; i++) {
        const a = i * 2;
        const b = i * 2 + 1;
        const c = (i + 1) * 2;
        const d = (i + 1) * 2 + 1;

        indices.push(a, c, b);
        indices.push(b, c, d);
    }

    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('ratio', new THREE.Float32BufferAttribute(ratios, 1));
    geometry.setAttribute('side', new THREE.Float32BufferAttribute(sides, 1));
    geometry.setIndex(indices);

    return geometry;
}

// ponytail: share satu ShaderMaterial — 6 clone dari 1 program, bukan 6 compile terpisah
const _sharedWindGeo = createWindLineGeometry();
const _sharedWindMat = new THREE.ShaderMaterial({
    uniforms: {
        uColor:     { value: new THREE.Color(0xffffff) },
        uThickness: { value: 0.18 },
        uProgress:  { value: 0.0 },
    },
    vertexShader: `
        uniform float uThickness;
        uniform float uProgress;

        attribute float ratio;
        attribute float side;

        varying float vAlpha;

        void main() {
            float baseThickness = smoothstep(0.0, 1.0, 1.0 - abs(ratio - 0.5) * 2.0);
            float remapedProgress = uProgress * 3.0 - 1.0;
            float progressThickness = smoothstep(0.0, 1.0, 1.0 - abs(ratio - remapedProgress));
            float finalThickness = uThickness * baseThickness * progressThickness;

            vec3 tangent = normalize(vec3(0.0, 1.0, -1.0));
            vec3 sideOffset = tangent * (side * finalThickness);
            vec3 localPos = position + sideOffset;

            vAlpha = baseThickness * progressThickness * 0.7;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(localPos, 1.0);
        }
    `,
    fragmentShader: `
        uniform vec3 uColor;
        varying float vAlpha;
        void main() {
            gl_FragColor = vec4(uColor, vAlpha);
        }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide
});

interface WindLineState {
    mesh: THREE.Mesh;
    // per-instance uniforms di-override via clone
    uniforms: { uProgress: { value: number } };
    available: boolean;
    // state untuk delta update — tidak butuh gsap
    age: number;
    duration: number;
    startX: number;
    startZ: number;
    endX: number;
    endZ: number;
    startY: number;
    angle: number;
}

export class WindEffectManager {
    private intervalId: ReturnType<typeof setTimeout> | null = null;
    private active = false;
    private pool: WindLineState[] = [];

    constructor(scene: THREE.Scene) {
        // ponytail: 6 clone dari 1 ShaderMaterial — 1 program compile, 6 pakai
        for (let i = 0; i < 6; i++) {
            const mat = _sharedWindMat.clone();
            const mesh = new THREE.Mesh(_sharedWindGeo, mat);
            mesh.renderOrder = 1;
            mesh.visible = false;
            scene.add(mesh);
            this.pool.push({
                mesh,
                uniforms: (mat as THREE.ShaderMaterial).uniforms as { uProgress: { value: number } },
                available: true,
                age: 0, duration: 1, startX: 0, startZ: 0, endX: 0, endZ: 0, startY: 0, angle: 0,
            });
        }
    }

    start() {
        if (this.active) return;
        this.active = true;

        const triggerLoop = () => {
            if (!this.active) return;
            this.display();
            const nextSpawn = 300 + Math.random() * 1200;
            this.intervalId = setTimeout(triggerLoop, nextSpawn);
        };
        triggerLoop();
    }

    stop() {
        this.active = false;
        if (this.intervalId) clearTimeout(this.intervalId);
    }

    // ponytail: update dipanggil dari render loop — tidak butuh gsap timer
    update(delta: number) {
        for (const w of this.pool) {
            if (w.available || !w.mesh.visible) continue;
            w.age += delta;
            const t = w.age / w.duration;
            if (t >= 1) {
                w.mesh.visible = false;
                w.available = true;
                continue;
            }
            // Gerakkan posisi via interpolasi sederhana
            w.mesh.position.x = w.startX + (w.endX - w.startX) * t;
            w.mesh.position.z = w.startZ + (w.endZ - w.startZ) * t;
            w.uniforms.uProgress.value = t;
        }
    }

    private display() {
        const w = this.pool.find(x => x.available);
        if (!w) return;

        w.available = false;
        w.age = 0;
        w.duration = 2.0 + Math.random() * 1.5;

        const startX = (Math.random() - 0.5) * 120;
        const startZ = (Math.random() - 0.5) * 80;
        const startY = 0.3 + Math.random() * 0.8;
        const angle  = -Math.PI / 4 + (Math.random() - 0.5) * 0.2;
        const distance = 25 + Math.random() * 15;

        w.startX = startX;
        w.startZ = startZ;
        w.endX   = startX + Math.sin(angle) * distance;
        w.endZ   = startZ + Math.cos(angle) * distance;
        w.startY = startY;
        w.angle  = angle;
        w.uniforms.uProgress.value = 0;

        w.mesh.position.set(startX, startY, startZ);
        w.mesh.rotation.y = angle;
        w.mesh.visible = true;
    }
}
