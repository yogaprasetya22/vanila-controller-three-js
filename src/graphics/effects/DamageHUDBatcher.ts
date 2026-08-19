import * as THREE from "three";
import { scene, camera } from "../core/scene";

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const MAX_EVENTS = 96;
const STRIDE     = 9;
const MAX_INST   = MAX_EVENTS * STRIDE;

const ATLAS_COLS = 6;
const ATLAS_ROWS = 4;

const CLUSTER_RADIUS = 1.8;   // world units
const LIFE_DURATION  = 1.6;   // base duration

// ─── ZERO-ALLOC HELPERS ──────────────────────────────────────────────────────
const _dummy = new THREE.Object3D();
const _v3    = new THREE.Vector3();
const _camDir = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up    = new THREE.Vector3();
const _hide  = new THREE.Matrix4().makeScale(0, 0, 0);
const _dbuf  = new Uint8Array(8);

// ─── COLORS ──────────────────────────────────────────────────────────────────
const C_CRIT_DIGIT   = new THREE.Color("#ffea00"); // Neon yellow/gold for crits
const C_NORMAL_DIGIT = new THREE.Color("#ffffff"); // Pure white for normal physical hits
const C_MAGIC_DIGIT  = new THREE.Color("#00e5ff"); // Electric cyan for magic/skills
const C_HEAL_DIGIT   = new THREE.Color("#33ff66"); // Lime green for heals
const C_DEBUFF_DIGIT = new THREE.Color("#00e5ff"); // Cyan for debuffs/negatives
const C_MISS_DIGIT   = new THREE.Color("#90a4ae"); // Light slate grey for misses
const C_TURRET_NORMAL_DIGIT = new THREE.Color("#ff7300"); // Bright orange for turret hits
const C_TURRET_CRIT_DIGIT   = new THREE.Color("#ff007f"); // Neon pink/magenta for turret critical hits

const IDX_PLUS  = 10;
const IDX_MINUS = 11;

// ─── ATLAS (digits only, white fill, thick black outline, Press Start 2P) ────
function buildAtlas(): THREE.CanvasTexture {
    const S   = 128;
    const cvs = document.createElement("canvas");
    cvs.width  = S * ATLAS_COLS;
    cvs.height = S * ATLAS_ROWS;
    const ctx  = cvs.getContext("2d")!;

    const chars = ["0","1","2","3","4","5","6","7","8","9","+","-","M","I","S","L","U","C","K","Y","."];
    ctx.textAlign    = "center";
    ctx.textBaseline = "middle";

    chars.forEach((ch, i) => {
        const col = i % ATLAS_COLS;
        const row = Math.floor(i / ATLAS_COLS);
        const cx  = col * S + S / 2;
        const cy  = row * S + S / 2;

        ctx.font       = "normal 90px 'Press Start 2P', monospace";
        ctx.lineJoin   = "round";
        ctx.miterLimit = 2;

        // Massive thick black outline for blocky pixel art/arcade feel
        ctx.shadowColor   = "rgba(0,0,0,0.95)";
        ctx.shadowBlur    = 8;
        ctx.shadowOffsetY = 4;
        ctx.strokeStyle   = "#000000";
        ctx.lineWidth     = 18;
        ctx.strokeText(ch, cx, cy);

        // Fill with white (colors applied via instanced color attributes)
        ctx.shadowColor = "transparent";
        ctx.fillStyle   = "#ffffff";
        ctx.fillText(ch, cx, cy);
    });

    const tex     = new THREE.CanvasTexture(cvs);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.anisotropy = 4;
    return tex;
}

// ─── AUTHENTIC 2D CRIT STAR TEXTURE ──────────────────────────────────────────
function buildStarTexture(): THREE.CanvasTexture {
    const S = 256;
    const cvs = document.createElement("canvas");
    cvs.width = S;
    cvs.height = S;
    const ctx = cvs.getContext("2d")!;

    const cx = S / 2;
    const cy = S / 2;

    const points = 10;
    const outerR = 108;
    const innerR = 48;

    const radiiPattern = [1.0, 0.85, 1.1, 0.9, 1.05, 0.95, 1.15, 0.88, 1.0, 0.92];

    ctx.lineJoin = "miter";
    ctx.miterLimit = 3;

    // 1. Draw outer black outline
    ctx.beginPath();
    for (let i = 0; i < points * 2; i++) {
        const angle = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
        const isOuter = i % 2 === 0;
        let r = isOuter ? outerR : innerR;
        if (isOuter) {
            r *= radiiPattern[(i / 2) % radiiPattern.length];
        }
        const x = cx + Math.cos(angle) * r;
        const y = cy + Math.sin(angle) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.strokeStyle = "#1e0000";
    ctx.lineWidth = 16;
    ctx.stroke();
    ctx.fillStyle = "#1e0000";
    ctx.fill();

    // 2. Draw vibrant red layer
    ctx.beginPath();
    for (let i = 0; i < points * 2; i++) {
        const angle = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
        const isOuter = i % 2 === 0;
        let r = (isOuter ? outerR : innerR) - 6;
        if (isOuter) {
            r *= radiiPattern[(i / 2) % radiiPattern.length];
        }
        const x = cx + Math.cos(angle) * r;
        const y = cy + Math.sin(angle) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = "#e84118";
    ctx.fill();

    // 3. Draw bright orange middle layer
    ctx.beginPath();
    for (let i = 0; i < points * 2; i++) {
        const angle = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
        const isOuter = i % 2 === 0;
        let r = (isOuter ? outerR * 0.72 : innerR * 0.85);
        if (isOuter) {
            r *= radiiPattern[(i / 2) % radiiPattern.length];
        }
        const x = cx + Math.cos(angle) * r;
        const y = cy + Math.sin(angle) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = "#f0932b";
    ctx.fill();

    // 4. Draw creamy yellow core
    ctx.beginPath();
    for (let i = 0; i < points * 2; i++) {
        const angle = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
        const isOuter = i % 2 === 0;
        let r = (isOuter ? outerR * 0.42 : innerR * 0.6);
        if (isOuter) {
            r *= radiiPattern[(i / 2) % radiiPattern.length];
        }
        const x = cx + Math.cos(angle) * r;
        const y = cy + Math.sin(angle) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = "#fbc531";
    ctx.fill();

    const tex = new THREE.CanvasTexture(cvs);
    tex.minFilter = THREE.NearestFilter;
    tex.magFilter = THREE.NearestFilter;
    return tex;
}

interface Evt {
    alive:      boolean;
    startTime:  number;
    duration:   number;
    spawnX:     number; spawnY: number; spawnZ: number;
    isCrit:     boolean;
    isMagic:    boolean;
    isHeal:     boolean;
    isDebuff:   boolean;
    numChars:   number;
    charIdx:    Uint8Array;
    digitColor: THREE.Color;
    clusterX:   number; clusterY: number; clusterZ: number;
    depthIdx:   number;
    vx:         number;
    vy:         number;
    grav:       number;
    _totalW?:   number;
    _GAP?:      number;
    _SW?:       number;
}

function makeEvt(): Evt {
    return {
        alive: false, startTime: 0, duration: LIFE_DURATION,
        spawnX:0, spawnY:0, spawnZ:0,
        isCrit:false, isMagic:false, isHeal:false, isDebuff:false,
        numChars:0, charIdx: new Uint8Array(STRIDE),
        digitColor: new THREE.Color("#ffffff"),
        clusterX:0, clusterY:0, clusterZ:0,
        depthIdx:0,
        vx: 0,
        vy: 0,
        grav: 15.0,
    };
}

export class DamageHUDBatcher {
    private digitMesh!: THREE.InstancedMesh;
    private starMesh!: THREE.InstancedMesh;
    private evts: Evt[] = Array.from({ length: MAX_EVENTS }, makeEvt);
    private evtPtr = 0;
    private atlas!: THREE.CanvasTexture;
    private starTex!: THREE.CanvasTexture;
    private uTime = { value: 0 };
    private elapsedTime = 0;
    private hadActive = false;

    // Instance Buffers
    private aCharIdx = new Float32Array(MAX_INST);
    private aOpacity = new Float32Array(MAX_INST);
    private aCrit    = new Float32Array(MAX_INST);
    private aCol     = new Float32Array(MAX_INST * 3);
    private sOpacity = new Float32Array(MAX_EVENTS);

    constructor() {
        this.init();
    }

    private init() {
        this.atlas = buildAtlas();
        this.starTex = buildStarTexture();

        const digitGeo = new THREE.PlaneGeometry(1, 1);
        const starGeo = new THREE.PlaneGeometry(1, 1);

        const digitMat = new THREE.ShaderMaterial({
            uniforms: { uAtlas: { value: this.atlas }, uTime: this.uTime },
            vertexShader: `
                attribute float aCharIdx;
                attribute float aOpacity;
                attribute float aCrit;
                attribute vec3  aCol;
                varying vec2  vUv;
                varying float vOp;
                varying float vCrit;
                varying vec3  vCol;
                void main() {
                    float c = mod(aCharIdx, ${ATLAS_COLS}.0);
                    float r = floor(aCharIdx / ${ATLAS_COLS}.0);
                    vUv  = vec2(
                        (c + uv.x) / ${ATLAS_COLS}.0,
                        1.0 - (r + 1.0 - uv.y) / ${ATLAS_ROWS}.0
                    );
                    vOp  = aOpacity;
                    vCrit = aCrit;
                    vCol  = aCol;
                    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform sampler2D uAtlas;
                uniform float     uTime;
                varying vec2  vUv;
                varying float vOp;
                varying float vCrit;
                varying vec3  vCol;
                void main() {
                    vec4 t = texture2D(uAtlas, vUv);
                    if (t.a < 0.05) discard;
                    vec3 c = t.rgb * vCol;
                    if(vCrit > 0.5){
                        float sweep = mod(vUv.x*1.2 + vUv.y*0.4 - uTime*4.0, 2.0);
                        float shine = smoothstep(0.0,0.18,sweep)*smoothstep(0.45,0.18,sweep);
                        float top   = pow(1.0-vUv.y, 4.0)*0.45;
                        c = mix(c, vec3(1.0,0.98,0.75), (shine*0.65+top)*t.a);
                    }
                    gl_FragColor = vec4(c, t.a * vOp);
                }
            `,
            transparent: true,
            depthTest: true,
            depthWrite: false,
            side: THREE.DoubleSide,
        });

        const starMat = new THREE.ShaderMaterial({
            uniforms: { uStarTex: { value: this.starTex } },
            vertexShader: `
                attribute float aOpacity;
                varying float vOp;
                varying vec2  vUv;
                void main(){
                    vOp = aOpacity;
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform sampler2D uStarTex;
                varying float vOp;
                varying vec2  vUv;
                void main(){
                    vec4 tex = texture2D(uStarTex, vUv);
                    if (tex.a < 0.05) discard;
                    gl_FragColor = vec4(tex.rgb, tex.a * vOp);
                }
            `,
            transparent: true,
            depthTest: true,
            depthWrite: false,
            side: THREE.DoubleSide,
        });

        this.starMesh = new THREE.InstancedMesh(starGeo, starMat, MAX_EVENTS);
        this.starMesh.renderOrder = 997;
        this.starMesh.frustumCulled = false;

        this.digitMesh = new THREE.InstancedMesh(digitGeo, digitMat, MAX_INST);
        this.digitMesh.renderOrder = 999;
        this.digitMesh.frustumCulled = false;

        for (let i = 0; i < MAX_INST; i++) this.digitMesh.setMatrixAt(i, _hide);
        this.digitMesh.geometry.setAttribute("aCharIdx", new THREE.InstancedBufferAttribute(this.aCharIdx, 1));
        this.digitMesh.geometry.setAttribute("aOpacity", new THREE.InstancedBufferAttribute(this.aOpacity, 1));
        this.digitMesh.geometry.setAttribute("aCrit",    new THREE.InstancedBufferAttribute(this.aCrit,    1));
        this.digitMesh.geometry.setAttribute("aCol",     new THREE.InstancedBufferAttribute(this.aCol,     3));
        this.digitMesh.instanceMatrix.needsUpdate = true;

        for (let i = 0; i < MAX_EVENTS; i++) this.starMesh.setMatrixAt(i, _hide);
        this.starMesh.geometry.setAttribute("aOpacity", new THREE.InstancedBufferAttribute(this.sOpacity, 1));
        this.starMesh.instanceMatrix.needsUpdate = true;

        scene.add(this.starMesh);
        scene.add(this.digitMesh);

        // Update atlas if web fonts are loaded later
        if (typeof document !== "undefined" && document.fonts) {
            document.fonts.ready.then(() => {
                const newCvs = buildAtlas().image as HTMLCanvasElement;
                if (this.atlas) {
                    this.atlas.image = newCvs;
                    this.atlas.needsUpdate = true;
                }
            });
        }
    }

    public spawn(event: { skill: string; value?: number; position: number[]; isCrit?: boolean; isMagic?: boolean; isTurret?: boolean }) {
        // return
        if (!event || !Array.isArray(event.position) || !Number.isFinite(event.position[0])) return;

        const isMiss   = event.skill === "miss";
        const isCrit   = !isMiss && !!event.isCrit;
        const isMagic  = !isMiss && !!event.isMagic;
        const isHeal   = event.skill === "heal";
        const isDebuff = !isMiss && !isHeal && (event.value ?? 0) < 0;
        const isTurret = !isMiss && !!event.isTurret;

        let totalChars = 0;
        let SW  = isCrit ? 0.85 : 0.72;
        let GAP = isCrit ? 0.45 : 0.36;

        const px = event.position[0], py = event.position[1], pz = event.position[2];
        let clusterX = px, clusterY = py, clusterZ = pz;

        for (let ei = 0; ei < MAX_EVENTS; ei++) {
            const e = this.evts[ei];
            if (!e.alive) continue;
            const dx = e.clusterX - px, dz = e.clusterZ - pz;
            if (dx*dx + dz*dz < CLUSTER_RADIUS * CLUSTER_RADIUS) {
                clusterX = e.clusterX;
                clusterY = e.clusterY;
                clusterZ = e.clusterZ;
                e.depthIdx = Math.min(e.depthIdx + 1, 6);
            }
        }

        const ei = this.evtPtr;
        this.evtPtr = (this.evtPtr + 1) % MAX_EVENTS;
        const e = this.evts[ei];

        if (e.alive) {
            const base = ei * STRIDE;
            for (let s = 0; s < e.numChars; s++) {
                this.digitMesh.setMatrixAt(base + s, _hide);
                this.aOpacity[base + s] = 0;
            }
            this.starMesh.setMatrixAt(ei, _hide);
            this.sOpacity[ei] = 0;
        }

        if (isMiss) {
            // "MISS" (M=12, I=13, S=14, S=14)
            e.charIdx[0] = 12;
            e.charIdx[1] = 13;
            e.charIdx[2] = 14;
            e.charIdx[3] = 14;
            totalChars = 4;
            SW = 0.58;
            GAP = 0.28;
        } else {
            let rawVal = event.value ?? 0;
            if (!Number.isFinite(rawVal)) rawVal = 0;
            const val = Math.abs(Math.round(rawVal));

            let text = "";
            if (val >= 1000000) {
                text = Math.round(val / 1000000) + "M";
            } else if (val >= 1000) {
                text = Math.round(val / 1000) + "K";
            } else {
                text = val.toString();
            }

            const chars = ["0","1","2","3","4","5","6","7","8","9","+","-","M","I","S","L","U","C","K","Y","."];

            const hasSign = isHeal || isDebuff;

            let ci = 0;
            if (isHeal) {
                e.charIdx[ci++] = IDX_PLUS;
            } else if (isDebuff) {
                e.charIdx[ci++] = IDX_MINUS;
            }

            for (let i = 0; i < text.length && ci < STRIDE; i++) {
                const char = text[i];
                let idx = chars.indexOf(char);
                if (idx === -1 && char === "k") {
                    idx = chars.indexOf("K");
                }
                if (idx !== -1) {
                    e.charIdx[ci++] = idx;
                }
            }
            totalChars = ci;
        }

        const totalW = totalChars * GAP;

        if      (isMiss)   e.digitColor.copy(C_MISS_DIGIT);
        else if (isHeal)   e.digitColor.copy(C_HEAL_DIGIT);
        else if (isDebuff) e.digitColor.copy(C_DEBUFF_DIGIT);
        else if (isTurret) {
            if (isCrit) {
                e.digitColor.copy(C_TURRET_CRIT_DIGIT);
            } else {
                e.digitColor.copy(C_TURRET_NORMAL_DIGIT);
            }
        }
        else if (isCrit)   e.digitColor.copy(C_CRIT_DIGIT);
        else if (isMagic)  e.digitColor.copy(C_MAGIC_DIGIT);
        else               e.digitColor.copy(C_NORMAL_DIGIT);

        const yOff = 1.6;

        e.alive      = true;
        e.startTime  = this.elapsedTime;
        e.spawnX     = px; e.spawnY = py + yOff; e.spawnZ = pz;
        e.clusterX   = clusterX; e.clusterY = clusterY; e.clusterZ = clusterZ;
        e.depthIdx   = 0;
        e.isCrit     = isCrit;
        e.isMagic    = isMagic;
        e.isHeal     = isHeal;
        e.isDebuff   = isDebuff;
        e.numChars   = totalChars;

        const direction = (this.evtPtr % 2 === 0) ? 1 : -1;

        if (isCrit) {
            e.vx = direction * (2.0 + Math.random() * 2.5) + (Math.random() - 0.5) * 0.8;
            e.vy = 12.0 + Math.random() * 4.0;
            e.grav = 24.0;
            e.duration = 0.85;
        } else if (isMiss) {
            e.vx = direction * (1.2 + Math.random() * 0.8);
            e.vy = 4.0 + Math.random() * 1.0;
            e.grav = 14.0;
            e.duration = 0.90;
        } else if (isHeal) {
            e.vx = (Math.random() - 0.5) * 1.5;
            e.vy = 5.0 + Math.random() * 1.5;
            e.grav = 10.0;
            e.duration = 0.95;
        } else {
            e.vx = direction * (3.2 + Math.random() * 2.2) + (Math.random() - 0.5) * 1.0;
            e.vy = 9.0 + Math.random() * 4.0;
            e.grav = 24.0;
            e.duration = 0.70;
        }

        e._totalW = totalW;
        e._GAP    = GAP;
        e._SW     = SW;
    }

    public update(delta: number) {
        this.elapsedTime += delta;
        this.uTime.value = this.elapsedTime;

        const camQ = camera.quaternion;
        _right.set(1, 0, 0).applyQuaternion(camQ);
        _up.set(0, 1, 0).applyQuaternion(camQ);
        camera.getWorldDirection(_camDir);

        let anyActive = false;

        for (let ei = 0; ei < MAX_EVENTS; ei++) {
            const e    = this.evts[ei];
            const base = ei * STRIDE;

            if (!e.alive) continue;

            const t  = this.elapsedTime - e.startTime;
            const tn = t / e.duration;

            if (tn >= 1.0) {
                e.alive = false;
                for (let s = 0; s < e.numChars; s++) {
                    this.digitMesh.setMatrixAt(base + s, _hide);
                    this.aOpacity[base + s] = 0;
                }
                this.starMesh.setMatrixAt(ei, _hide);
                this.sOpacity[ei] = 0;
                continue;
            }

            anyActive = true;
            const di = e.depthIdx;

            let scaleMultiplier = 1.0;
            if (e.isCrit) {
                if (tn < 0.15) {
                    const ratio = tn / 0.15;
                    const ease = 1.0 - Math.pow(1.0 - ratio, 3);
                    scaleMultiplier = THREE.MathUtils.lerp(1.45, 1.0, ease);
                } else {
                    scaleMultiplier = THREE.MathUtils.lerp(1.0, 0.6, (tn - 0.15) / 0.85);
                }
            } else {
                if (tn < 0.12) {
                    const ratio = tn / 0.12;
                    const ease = 1.0 - Math.pow(1.0 - ratio, 3);
                    scaleMultiplier = THREE.MathUtils.lerp(1.25, 1.0, ease);
                } else {
                    scaleMultiplier = THREE.MathUtils.lerp(1.0, 0.7, (tn - 0.12) / 0.88);
                }
            }

            const baseScale = e.isCrit ? 1.2 : 0.95;
            const totalScale = baseScale * scaleMultiplier;

            const offsetX = e.vx * t;
            const offsetY = e.vy * t - 0.5 * e.grav * t * t;

            const wx = e.spawnX + _camDir.x * di * 0.18;
            const wy = e.spawnY + _camDir.y * di * 0.18;
            const wz = e.spawnZ + _camDir.z * di * 0.18;

            const opacity = tn > 0.65 ? (1.0 - tn) / 0.35 : 1.0;

            if (opacity < 0.02) {
                for (let c = 0; c < e.numChars; c++) this.aOpacity[base + c] = 0;
                this.sOpacity[ei] = 0;
                continue;
            }

            let jx = 0.0, jy = 0.0;
            if (e.isCrit && di === 0 && t < 0.10) {
                const j = (1.0 - t / 0.10) * 0.25;
                jx = (Math.random() - 0.5) * j;
                jy = (Math.random() - 0.5) * j;
            }

            // Animate Star Background
            if (e.isCrit) {
                const starBaseScale = totalScale * 1.85;
                const scaleX = starBaseScale * (1.15 + (e.numChars - 1) * 0.35);
                const scaleY = starBaseScale * 1.05;

                _v3.set(wx + _camDir.x * 0.05, wy + _camDir.y * 0.05, wz + _camDir.z * 0.05)
                   .addScaledVector(_right, offsetX + jx)
                   .addScaledVector(_up,    offsetY + jy);

                _dummy.position.copy(_v3);
                _dummy.quaternion.copy(camQ);
                _dummy.scale.set(scaleX, scaleY, 1.0);
                _dummy.updateMatrix();
                this.starMesh.setMatrixAt(ei, _dummy.matrix);
                this.sOpacity[ei] = opacity;
            } else {
                this.starMesh.setMatrixAt(ei, _hide);
                this.sOpacity[ei] = 0;
            }

            // Digits
            const GAP    = e._GAP    ?? 0.6;
            const SW     = e._SW     ?? 0.75;
            const totalW = e._totalW ?? (e.numChars * GAP);

            let baseR: number, baseG: number, baseB: number;
            if (e.isCrit && di === 0 && t < 0.07 && Math.floor(t * 40) % 2 === 0) {
                baseR = 1.0; baseG = 1.0; baseB = 1.0;
            } else {
                baseR = e.digitColor.r; baseG = e.digitColor.g; baseB = e.digitColor.b;
            }

            for (let c = 0; c < e.numChars; c++) {
                const si = base + c;
                const lx = (c * GAP) - totalW * 0.5 + GAP * 0.5;

                _v3.set(wx, wy, wz)
                   .addScaledVector(_right, lx * totalScale + offsetX + jx)
                   .addScaledVector(_up,    offsetY + jy);

                _dummy.position.copy(_v3);
                _dummy.quaternion.copy(camQ);
                _dummy.scale.setScalar(totalScale * SW);
                _dummy.updateMatrix();
                this.digitMesh.setMatrixAt(si, _dummy.matrix);

                this.aOpacity[si] = opacity;
                this.aCharIdx[si] = e.charIdx[c];
                this.aCrit[si]    = (e.isCrit && di === 0) ? 1.0 : 0.0;
                this.aCol[si*3]   = baseR;
                this.aCol[si*3+1] = baseG;
                this.aCol[si*3+2] = baseB;
            }

            for (let c = e.numChars; c < STRIDE; c++) {
                this.aOpacity[base + c] = 0;
                this.digitMesh.setMatrixAt(base + c, _hide);
            }
        }

        if (anyActive || this.hadActive) {
            this.digitMesh.instanceMatrix.needsUpdate = true;
            (this.digitMesh.geometry.attributes.aCharIdx as THREE.InstancedBufferAttribute).needsUpdate = true;
            (this.digitMesh.geometry.attributes.aOpacity as THREE.InstancedBufferAttribute).needsUpdate = true;
            (this.digitMesh.geometry.attributes.aCrit    as THREE.InstancedBufferAttribute).needsUpdate = true;
            (this.digitMesh.geometry.attributes.aCol     as THREE.InstancedBufferAttribute).needsUpdate = true;

            this.starMesh.instanceMatrix.needsUpdate = true;
            (this.starMesh.geometry.attributes.aOpacity as THREE.InstancedBufferAttribute).needsUpdate = true;
        }
        this.hadActive = anyActive;
    }
}

export const damageHUDBatcher = new DamageHUDBatcher();
