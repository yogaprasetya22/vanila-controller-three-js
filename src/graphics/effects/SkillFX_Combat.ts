import * as THREE from "three";
import { camera } from "../core/scene";
import {
    easeOutCubic,
    easeOutBack,
    pooledPlane,
    pooledRing,
    getPooledMaterial,
    releasePooledMaterial,
    sparkTex,
    smokeTex,
    activeFX,
    fxQualityScale,
    _tempObj,
    spawnExplosion,
} from "./FXCore";

let _tauntTex: THREE.CanvasTexture | null = null;
function getTauntTex(): THREE.CanvasTexture {
    if (_tauntTex) return _tauntTex;
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ff0000";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "bold 96px Inter, sans-serif";
    ctx.fillText("💢", 64, 64);
    _tauntTex = new THREE.CanvasTexture(canvas);
    _tauntTex.minFilter = THREE.LinearFilter;
    _tauntTex.magFilter = THREE.LinearFilter;
    return _tauntTex;
}

// ─── Upgrade: Taunt FX (Rotating runic ground waves, emoji halo, sparks) ───
export function spawnTauntFX(
    scene: THREE.Scene,
    x: number,
    y: number,
    z: number,
    tx: number,
    ty: number,
    tz: number,
    team?: number,
) {
    const isBlue = team === 1;
    const colorPrimary = isBlue ? 0x2288ff : 0xff2244;
    const colorSecondary = isBlue ? 0x00dfff : 0xff0033;
    const colorSparks = isBlue ? 0x33ccff : 0xff4444;

    // Custom shader for expanding ground ring wave
    const waveGeo = new THREE.PlaneGeometry(1.0, 1.0);
    const waveMat = new THREE.ShaderMaterial({
        uniforms: {
            uColor: { value: new THREE.Color(colorPrimary) },
            uOpacity: { value: 1.0 },
        },
        vertexShader: `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform vec3 uColor;
            uniform float uOpacity;
            varying vec2 vUv;
            void main() {
                vec2 uv = vUv - vec2(0.5);
                float dist = length(uv);
                if (dist > 0.5) discard;
                
                // Expanding ripple
                float r = smoothstep(0.03, 0.0, abs(dist - 0.43));
                gl_FragColor = vec4(uColor * 2.0, r * uOpacity * (1.0 - dist * 2.0));
            }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
    });
    const wave = new THREE.Mesh(waveGeo, waveMat);
    wave.rotation.x = -Math.PI / 2;
    wave.position.set(x, y + 0.05, z);
    scene.add(wave);

    const ringGeo = pooledRing(0.5, 0.7, 16);
    const ringMat = getPooledMaterial({
        color: colorSecondary,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, y + 0.06, z);
    scene.add(ring);

    // Taunt target symbol
    const tTex = getTauntTex();
    const iconGeo = pooledPlane(1.0, 1.0);
    const iconMat = getPooledMaterial({
        map: tTex,
        transparent: true,
        depthTest: false,
    });
    const icon = new THREE.Mesh(iconGeo, iconMat);
    icon.position.set(tx, ty + 2.2, tz);
    icon.renderOrder = 10;
    scene.add(icon);

    // Spark particles
    const pGeo = pooledPlane(0.25, 0.25);
    const pMat = getPooledMaterial({
        map: sparkTex,
        color: colorSparks,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
    });
    const PCOUNT = Math.round(16 * fxQualityScale());
    const instMesh = new THREE.InstancedMesh(pGeo, pMat, PCOUNT);
    instMesh.frustumCulled = false;
    scene.add(instMesh);

    const pVels: THREE.Vector3[] = [];
    const pOffsets: THREE.Vector3[] = [];
    for (let i = 0; i < PCOUNT; i++) {
        pOffsets.push(new THREE.Vector3(x, y + 0.4, z));
        const a = Math.random() * Math.PI * 2;
        const speed = 1.5 + Math.random() * 3.0;
        pVels.push(new THREE.Vector3(Math.cos(a) * speed, 2.0 + Math.random() * 4.0, Math.sin(a) * speed));
    }

    let age = 0;
    const duration = 0.95;
    activeFX.push({
        update(delta) {
            age += delta;
            const t = Math.min(1, age / duration);
            if (t >= 1) {
                scene.remove(wave);
                scene.remove(ring);
                scene.remove(icon);
                scene.remove(instMesh);
                waveGeo.dispose();
                waveMat.dispose();
                releasePooledMaterial(ringMat);
                releasePooledMaterial(iconMat);
                releasePooledMaterial(pMat);
                instMesh.dispose();
                return false;
            }
            const et = easeOutBack(t);

            const scale = 1.0 + t * 6.0;
            wave.scale.set(scale, scale, 1.0);
            waveMat.uniforms.uOpacity.value = 1.0 - t;

            ring.scale.setScalar(1.0 + et * 4.0);
            ring.rotation.z += 0.05;
            ringMat.opacity = (1.0 - t) * (0.35 + 0.65 * Math.sin(t * 15.0));

            // Floating pulsing emoji
            icon.position.y = ty + 2.2 + Math.sin(age * 10.0) * 0.15;
            icon.scale.setScalar(1.2 + Math.sin(age * 8.0) * 0.2);
            icon.quaternion.copy(camera.quaternion);
            iconMat.opacity = Math.max(0, 1.0 - t * 1.1);

            const cq = camera.quaternion;
            for (let i = 0; i < PCOUNT; i++) {
                pOffsets[i].addScaledVector(pVels[i], delta);
                pVels[i].y -= 9.8 * delta;

                _tempObj.position.copy(pOffsets[i]);
                _tempObj.quaternion.copy(cq);
                _tempObj.scale.setScalar(1.0 - et * 0.5);
                _tempObj.updateMatrix();
                instMesh.setMatrixAt(i, _tempObj.matrix);
            }
            instMesh.instanceMatrix.needsUpdate = true;
            pMat.opacity = 1.0 - t;

            return true;
        },
    });
}

// ─── Upgrade: Shield Bash (Fast expanding shockwave dome + directional energy cone) ───
export function spawnShieldBashFX(
    scene: THREE.Scene,
    x: number,
    y: number,
    z: number,
    tx: number,
    ty: number,
    tz: number,
    team?: number,
) {
    const isBlue = team === 1;
    const colorArc = isBlue ? 0x00aaff : 0xffaa00;
    const colorShock = isBlue ? 0x00dfff : 0xffdd44;
    const colorSparks = isBlue ? 0x88f0ff : 0xffdd88;

    const start = new THREE.Vector3(x, y + 0.8, z);
    const end = new THREE.Vector3(tx, ty + 0.8, tz);

    // Glowing holographic shield plane projecting forward
    const shieldGeo = new THREE.PlaneGeometry(2.0, 2.2);
    const shieldMat = new THREE.ShaderMaterial({
        uniforms: {
            uTime: { value: 0 },
            uColor: { value: new THREE.Color(colorArc) },
            uOpacity: { value: 1.0 },
        },
        vertexShader: `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform vec3 uColor;
            uniform float uOpacity;
            varying vec2 vUv;
            void main() {
                // Shield border glow
                float borderX = smoothstep(0.46, 0.5, abs(vUv.x - 0.5));
                float borderY = smoothstep(0.46, 0.5, abs(vUv.y - 0.5));
                float border = max(borderX, borderY);
                
                // Holographic grid scan lines
                float grid = sin(vUv.x * 25.0) * sin(vUv.y * 25.0);
                grid = smoothstep(0.65, 0.9, grid) * 0.35;
                
                gl_FragColor = vec4(uColor * 2.5, max(border, grid) * uOpacity);
            }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
    });
    const shield = new THREE.Mesh(shieldGeo, shieldMat);
    shield.position.copy(start);
    shield.lookAt(end);
    scene.add(shield);

    // Flat ground shockwave expanding on impact point
    const shockGeo = new THREE.PlaneGeometry(1.0, 1.0);
    const shockMat = new THREE.ShaderMaterial({
        uniforms: {
            uColor: { value: new THREE.Color(colorShock) },
            uOpacity: { value: 1.0 },
        },
        vertexShader: `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform vec3 uColor;
            uniform float uOpacity;
            varying vec2 vUv;
            void main() {
                vec2 uv = vUv - vec2(0.5);
                float dist = length(uv);
                if (dist > 0.5) discard;
                float r = smoothstep(0.02, 0.0, abs(dist - 0.45));
                gl_FragColor = vec4(uColor * 2.2, r * uOpacity * (1.0 - dist * 1.5));
            }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
    });
    const shock = new THREE.Mesh(shockGeo, shockMat);
    shock.rotation.x = -Math.PI / 2;
    shock.position.set(tx, y + 0.05, tz);
    scene.add(shock);

    const sparkGeo = pooledPlane(0.35, 0.35);
    const sparkMat = getPooledMaterial({
        map: sparkTex,
        color: colorSparks,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
    });
    const SK = Math.round(18 * fxQualityScale());
    const instMesh = new THREE.InstancedMesh(sparkGeo, sparkMat, SK);
    instMesh.frustumCulled = false;
    scene.add(instMesh);

    const sparkVels: THREE.Vector3[] = [];
    const sparkOffsets: THREE.Vector3[] = [];
    const hideM = new THREE.Matrix4().makeScale(0, 0, 0);

    for (let i = 0; i < SK; i++) {
        sparkOffsets.push(end.clone());
        const a = Math.random() * Math.PI * 2;
        const speed = 4.0 + Math.random() * 6.0;
        sparkVels.push(new THREE.Vector3(Math.cos(a) * speed, 1.0 + Math.random() * 5.0, Math.sin(a) * speed));
        instMesh.setMatrixAt(i, hideM);
    }
    instMesh.instanceMatrix.needsUpdate = true;

    let age = 0;
    const duration = 0.45;
    activeFX.push({
        update(delta) {
            age += delta;
            const t = Math.min(1, age / duration);
            if (t >= 1) {
                scene.remove(shield);
                scene.remove(shock);
                scene.remove(instMesh);

                shieldGeo.dispose();
                shieldMat.dispose();
                shockGeo.dispose();
                shockMat.dispose();
                releasePooledMaterial(sparkMat);
                instMesh.dispose();
                return false;
            }

            // Slide shield plane rapidly towards target
            const currentPos = new THREE.Vector3().lerpVectors(start, end, Math.min(1.0, t * 2.0));
            shield.position.copy(currentPos);
            shieldMat.uniforms.uOpacity.value = 1.0 - t;

            // Expand ground shockwave ring
            const ds = 0.5 + t * 5.0;
            shock.scale.set(ds, ds, 1.0);
            shockMat.uniforms.uOpacity.value = 1.0 - t;

            // Instanced sparks
            const cq = camera.quaternion;
            for (let i = 0; i < SK; i++) {
                if (t > 0.3) {
                    const elapsed = t - 0.3;
                    sparkOffsets[i].addScaledVector(sparkVels[i], delta);
                    sparkVels[i].y -= 9.8 * delta; // gravity

                    _tempObj.position.copy(sparkOffsets[i]);
                    _tempObj.quaternion.copy(cq);
                    _tempObj.scale.setScalar((1.0 - elapsed / 0.7) * 0.9);
                    _tempObj.updateMatrix();
                    instMesh.setMatrixAt(i, _tempObj.matrix);
                }
            }
            instMesh.instanceMatrix.needsUpdate = true;
            sparkMat.opacity = 1.0 - t;

            return true;
        },
    });
}

// ─── Upgrade: Evasive Leap (High jumping arc + landing heavy dust wave) ───
export function spawnEvasiveLeapFX(
    scene: THREE.Scene,
    fx: number,
    fy: number,
    fz: number,
    tx: number,
    ty: number,
    tz: number,
) {
    // We spawn a smoke particle trail along the jump trajectory
    const start = new THREE.Vector3(fx, fy, fz);
    const end = new THREE.Vector3(tx, ty, tz);

    const trailGeo = pooledPlane(0.5, 0.5);
    const trailMat = getPooledMaterial({
        map: smokeTex,
        color: 0x88ccff,
        transparent: true,
        opacity: 0.5,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
    });
    const trailCount = 20;
    const trailMesh = new THREE.InstancedMesh(trailGeo, trailMat, trailCount);
    trailMesh.frustumCulled = false;
    scene.add(trailMesh);

    const trailOffsets: THREE.Vector3[] = [];
    for (let i = 0; i < trailCount; i++) {
        trailOffsets.push(new THREE.Vector3());
    }

    let age = 0;
    const duration = 0.65;
    activeFX.push({
        update(delta) {
            age += delta;
            const t = Math.min(1, age / duration);
            if (t >= 1) {
                scene.remove(trailMesh);
                releasePooledMaterial(trailMat);
                trailMesh.dispose();
                // Spawn impact explosion on ground landing
                spawnExplosion(scene, end, 0x00dfff, 15, 0.2);
                return false;
            }

            const cq = camera.quaternion;
            // Draw parabolic trail
            for (let i = 0; i < trailCount; i++) {
                const subT = Math.min(1, (i / trailCount) * t);
                const pos = new THREE.Vector3().lerpVectors(start, end, subT);
                
                // Add jump height peak
                const h = 4.0;
                pos.y += Math.sin(subT * Math.PI) * h;

                _tempObj.position.copy(pos);
                _tempObj.quaternion.copy(cq);
                _tempObj.scale.setScalar((1.0 - t) * (0.8 + i * 0.05));
                _tempObj.updateMatrix();
                trailMesh.setMatrixAt(i, _tempObj.matrix);
            }
            trailMesh.instanceMatrix.needsUpdate = true;
            trailMat.opacity = 0.6 * (1.0 - t);

            return true;
        },
    });
}
