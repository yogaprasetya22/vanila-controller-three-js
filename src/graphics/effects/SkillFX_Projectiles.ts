import * as THREE from "three";
import { camera } from "../core/scene";
import {
    easeOutCubic,
    easeOutQuad,
    pooledPlane,
    starTex,
    circleTex,
    sparkTex,
    fireTex,
    flameTex,
    lightTex,
    blueFlameSmokeTex,
    activeFX,
    fxQualityScale,
    getPooledMaterial,
    releasePooledMaterial,
    _tempObj,
    spawnExplosion,
} from "./FXCore";

// ─── Load Premium Assets ─────────────────────────────────────────────────────
const texLoader = new THREE.TextureLoader();
const blueEmbersTex = texLoader.load('/vfx/cartoon-blue-flamethrower/tex_2.png');
const blueFlameTex = texLoader.load('/vfx/cartoon-blue-flamethrower/tex_3.png');
const blueExplosionTex = texLoader.load('/vfx/cartoon-blue-gas-explosion/tex_3.png');
const subSmokeTex = texLoader.load('/vfx/subemitter2/tex_0.png');
const subEmbersTex = texLoader.load('/vfx/subemitter2/tex_1.png');

// Helper to create instanced flipbook shader material
function makeFlipbookMat(tex: THREE.Texture, uTiles: number, vTiles: number, colorOverride?: THREE.Color): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
        uniforms: {
            uMap: { value: tex },
            uTiles: { value: new THREE.Vector2(uTiles, vTiles) },
            uColor: { value: colorOverride || new THREE.Color(1, 1, 1) },
        },
        vertexShader: `
            attribute float aFrame;
            attribute float aOpacity;
            varying vec2 vUv;
            varying float vOpacity;
            uniform vec2 uTiles;
            void main() {
                float c = mod(aFrame, uTiles.x);
                float r = floor(aFrame / uTiles.x);
                vUv = vec2((c + uv.x) / uTiles.x, 1.0 - (r + 1.0 - uv.y) / uTiles.y);
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
                if (tex.a < 0.02) discard;
                gl_FragColor = vec4(tex.rgb * uColor, tex.a * vOpacity);
            }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
    });
}

// ─── Upgrade: Arrow Volley (Runic circle, falling arrows with ribbon tracers & ground crystal spark/smoke puffs) ───
export function spawnArrowVolleyFX(
    scene: THREE.Scene,
    centerX: number,
    centerZ: number,
    groundY: number,
    radius: number = 4.0,
    team?: number,
): void {
    const isBlue = team === 1;
    const colorCircle = isBlue ? 0x00dfff : 0xff3300;
    const colorRune = isBlue ? 0xaae8ff : 0xffdd44;
    const colorStar = isBlue ? 0xffffff : 0xffeedd;

    // Glowing runic targeting circle on the ground
    const ringGeo = new THREE.PlaneGeometry(radius * 2.5, radius * 2.5);
    const ringMat = new THREE.ShaderMaterial({
        uniforms: {
            uTime: { value: 0 },
            uColor: { value: new THREE.Color(colorCircle) },
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
            uniform float uTime;
            varying vec2 vUv;
            void main() {
                vec2 uv = vUv - vec2(0.5);
                float dist = length(uv);
                if (dist > 0.5) discard;

                float ring = smoothstep(0.015, 0.0, abs(dist - 0.44));
                float ringInner = smoothstep(0.01, 0.0, abs(dist - 0.32));
                float rad = atan(uv.y, uv.x);
                float spokes = step(0.96, sin(rad * 12.0 + uTime * 3.0)) * ring;

                gl_FragColor = vec4(uColor * 2.2, (ring + ringInner * 0.4 + spokes) * uOpacity * (1.0 - dist * 1.5));
            }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(centerX, groundY + 0.03, centerZ);
    scene.add(ring);

    const COUNT = 60;
    const arrowGeo = new THREE.CylinderGeometry(0.01, 0.035, 1.2, 4);
    const arrowMat = new THREE.MeshBasicMaterial({
        color: colorStar,
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
    });
    const arrows = new THREE.InstancedMesh(arrowGeo, arrowMat, COUNT);
    arrows.frustumCulled = false;
    scene.add(arrows);

    // Glowing ribbon trails using an instanced mesh of cylinders
    const tracerGeo = new THREE.CylinderGeometry(0.02, 0.02, 3.0, 4);
    const tracerMat = new THREE.MeshBasicMaterial({
        color: colorRune,
        transparent: true,
        opacity: 0.45,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
    });
    const tracers = new THREE.InstancedMesh(tracerGeo, tracerMat, COUNT);
    tracers.frustumCulled = false;
    scene.add(tracers);

    // Instanced crystal shards geometry
    const SHARDS_PER_ARROW = 3;
    const shardCount = COUNT * SHARDS_PER_ARROW;
    const shardGeo = new THREE.DodecahedronGeometry(0.12, 0);
    const shardMat = new THREE.ShaderMaterial({
        uniforms: {
            uColor: { value: new THREE.Color(isBlue ? 0x00dfff : 0xffaa00) },
            uOpacity: { value: 1.0 },
        },
        vertexShader: `
            varying float vNormalDot;
            void main() {
                vec3 norm = normalize(normalMatrix * normal);
                vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
                vNormalDot = abs(dot(norm, normalize(-mvPosition.xyz)));
                gl_Position = projectionMatrix * mvPosition;
            }
        `,
        fragmentShader: `
            uniform vec3 uColor;
            uniform float uOpacity;
            varying float vNormalDot;
            void main() {
                float highlight = pow(1.0 - vNormalDot, 3.0);
                gl_FragColor = vec4(mix(uColor, vec3(1.0), highlight * 0.7) * 2.2, uOpacity);
            }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
    });
    const shardMesh = new THREE.InstancedMesh(shardGeo, shardMat, shardCount);
    shardMesh.frustumCulled = false;
    scene.add(shardMesh);

    // Ground impact smoke flipbook particles (2x2 layout from subemitter2/tex_0.png)
    const impactGeo = new THREE.PlaneGeometry(1.6, 1.6);
    const impactMat = makeFlipbookMat(subSmokeTex, 2, 2, isBlue ? new THREE.Color(0.3, 0.8, 1.0) : new THREE.Color(1.0, 0.5, 0.2));
    const impacts = new THREE.InstancedMesh(impactGeo, impactMat, COUNT);
    impacts.frustumCulled = false;
    const aFrame = new Float32Array(COUNT);
    const aOpacity = new Float32Array(COUNT);
    impacts.geometry.setAttribute('aFrame', new THREE.InstancedBufferAttribute(aFrame, 1));
    impacts.geometry.setAttribute('aOpacity', new THREE.InstancedBufferAttribute(aOpacity, 1));
    scene.add(impacts);

    const positions: THREE.Vector3[] = [];
    const vels: THREE.Vector3[] = [];
    const delays: number[] = [];
    const impactAges: number[] = [];

    const shardPositions: THREE.Vector3[] = [];
    const shardVels: THREE.Vector3[] = [];
    const shardScales: number[] = [];
    const shardRots: THREE.Vector3[] = [];
    const shardRotVels: THREE.Vector3[] = [];

    const tempObj = new THREE.Object3D();
    const tempTracerObj = new THREE.Object3D();
    const tempImpactObj = new THREE.Object3D();

    const hideM = new THREE.Matrix4().makeScale(0, 0, 0);

    for (let i = 0; i < COUNT; i++) {
        const angle = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * radius;
        const targetX = centerX + Math.cos(angle) * r;
        const targetZ = centerZ + Math.sin(angle) * r;

        const startHeight = 22.0 + Math.random() * 8.0;
        positions.push(new THREE.Vector3(targetX + (Math.random() - 0.5) * 1.5, groundY + startHeight, targetZ + (Math.random() - 0.5) * 1.5));
        vels.push(new THREE.Vector3(0, -38.0 - Math.random() * 12.0, 0));
        delays.push(Math.random() * 0.95);
        impactAges.push(-1);

        arrows.setMatrixAt(i, hideM);
        tracers.setMatrixAt(i, hideM);
        impacts.setMatrixAt(i, hideM);
        aOpacity[i] = 0.0;
    }

    for (let i = 0; i < shardCount; i++) {
        shardPositions.push(new THREE.Vector3());
        shardVels.push(new THREE.Vector3());
        shardScales.push(0.4 + Math.random() * 0.6);
        shardRots.push(new THREE.Vector3(Math.random(), Math.random(), Math.random()));
        shardRotVels.push(new THREE.Vector3((Math.random() - 0.5) * 8.0, (Math.random() - 0.5) * 8.0, (Math.random() - 0.5) * 8.0));
        shardMesh.setMatrixAt(i, hideM);
    }

    arrows.instanceMatrix.needsUpdate = true;
    tracers.instanceMatrix.needsUpdate = true;
    impacts.instanceMatrix.needsUpdate = true;
    shardMesh.instanceMatrix.needsUpdate = true;
    (impacts.geometry.getAttribute('aOpacity') as THREE.InstancedBufferAttribute).needsUpdate = true;
    (impacts.geometry.getAttribute('aFrame') as THREE.InstancedBufferAttribute).needsUpdate = true;

    let age = 0;
    const duration = 2.0;
    activeFX.push({
        update(delta) {
            age += delta;
            const t = Math.min(1, age / duration);
            if (t >= 1) {
                scene.remove(ring);
                scene.remove(arrows);
                scene.remove(tracers);
                scene.remove(impacts);
                scene.remove(shardMesh);

                ringGeo.dispose();
                ringMat.dispose();
                arrowGeo.dispose();
                arrowMat.dispose();
                tracerGeo.dispose();
                tracerMat.dispose();
                impactGeo.dispose();
                impactMat.dispose();
                shardGeo.dispose();
                shardMat.dispose();

                arrows.dispose();
                tracers.dispose();
                impacts.dispose();
                shardMesh.dispose();
                return false;
            }

            ringMat.uniforms.uTime.value = age;
            ringMat.uniforms.uOpacity.value = 1.0 - t;

            const cq = camera.quaternion;
            let arrowsUpdated = false;
            let impactsUpdated = false;
            let shardsUpdated = false;

            for (let i = 0; i < COUNT; i++) {
                const elapsed = age - delays[i];
                if (elapsed < 0) continue;

                const yPos = positions[i].y + vels[i].y * elapsed;
                if (yPos > groundY) {
                    tempObj.position.set(positions[i].x, yPos, positions[i].z);
                    tempObj.scale.set(1.0, 1.0, 1.0);
                    tempObj.updateMatrix();
                    arrows.setMatrixAt(i, tempObj.matrix);

                    tempTracerObj.position.set(positions[i].x, yPos + 1.5, positions[i].z);
                    tempTracerObj.scale.set(1.0, 1.0, 1.0);
                    tempTracerObj.updateMatrix();
                    tracers.setMatrixAt(i, tempTracerObj.matrix);

                    arrowsUpdated = true;
                } else {
                    arrows.setMatrixAt(i, hideM);
                    tracers.setMatrixAt(i, hideM);
                    arrowsUpdated = true;

                    const justHit = (impactAges[i] === -1);
                    if (justHit) {
                        impactAges[i] = age;
                        const baseIdx = i * SHARDS_PER_ARROW;
                        for (let k = 0; k < SHARDS_PER_ARROW; k++) {
                            const idx = baseIdx + k;
                            shardPositions[idx].set(positions[i].x, groundY + 0.1, positions[i].z);
                            const theta = Math.random() * Math.PI * 2;
                            const speed = 2.0 + Math.random() * 4.0;
                            shardVels[idx].set(
                                Math.cos(theta) * speed,
                                3.0 + Math.random() * 4.0,
                                Math.sin(theta) * speed
                            );
                        }
                    }

                    const impactTime = age - impactAges[i];
                    const maxImpactLife = 0.4;
                    const ip = Math.min(1, impactTime / maxImpactLife);

                    if (ip < 1.0) {
                        tempImpactObj.position.set(positions[i].x, groundY + 0.05, positions[i].z);
                        tempImpactObj.quaternion.copy(cq);
                        tempImpactObj.scale.setScalar(0.4 + ip * 2.0);
                        tempImpactObj.updateMatrix();
                        impacts.setMatrixAt(i, tempImpactObj.matrix);

                        aFrame[i] = Math.min(3, Math.floor(ip * 4.0));
                        aOpacity[i] = 1.0 - ip;
                    } else {
                        impacts.setMatrixAt(i, hideM);
                        aOpacity[i] = 0;
                    }
                    impactsUpdated = true;

                    // Update crystal shards
                    const baseIdx = i * SHARDS_PER_ARROW;
                    for (let k = 0; k < SHARDS_PER_ARROW; k++) {
                        const idx = baseIdx + k;
                        const p = shardPositions[idx];
                        if (impactTime < 0.35) {
                            shardVels[idx].y -= 9.8 * delta;
                            p.addScaledVector(shardVels[idx], delta);
                            shardRots[idx].addScaledVector(shardRotVels[idx], delta);

                            _tempObj.position.copy(p);
                            _tempObj.rotation.set(shardRots[idx].x, shardRots[idx].y, shardRots[idx].z);
                            _tempObj.scale.setScalar(shardScales[idx] * Math.sin((impactTime / 0.35) * Math.PI));
                            _tempObj.updateMatrix();
                            shardMesh.setMatrixAt(idx, _tempObj.matrix);
                        } else {
                            shardMesh.setMatrixAt(idx, hideM);
                        }
                    }
                    shardsUpdated = true;
                }
            }

            if (arrowsUpdated) {
                arrows.instanceMatrix.needsUpdate = true;
                tracers.instanceMatrix.needsUpdate = true;
            }
            if (impactsUpdated) {
                impacts.instanceMatrix.needsUpdate = true;
                (impacts.geometry.getAttribute('aFrame') as THREE.InstancedBufferAttribute).needsUpdate = true;
                (impacts.geometry.getAttribute('aOpacity') as THREE.InstancedBufferAttribute).needsUpdate = true;
            }
            if (shardsUpdated) {
                shardMesh.instanceMatrix.needsUpdate = true;
            }

            arrowMat.opacity = 0.95 * (1.0 - t);
            tracerMat.opacity = 0.45 * (1.0 - t);
            shardMat.uniforms.uOpacity.value = 1.0 - t;

            return true;
        },
    });
}

// ─── Upgrade: Fireball (Glowing core sphere + trailing embers & 3x3 cartoon gas explosion impact) ───
export function spawnFireballFX(
    scene: THREE.Scene,
    fx: number,
    fy: number,
    fz: number,
    tx: number,
    ty: number,
    tz: number,
    team?: number,
) {
    const dir = new THREE.Vector3(tx - fx, 0, tz - fz).normalize();
    if (dir.lengthSq() < 0.001) dir.set(1, 0, 1).normalize();
    const start = new THREE.Vector3(tx - dir.x * 4, fy + 9, tz - dir.z * 4);
    const end = new THREE.Vector3(tx, ty, tz);
    const isBlue = team === 1;

    // Glowing core sphere with custom noise wave
    const coreGeo = new THREE.SphereGeometry(0.55, 16, 16);
    const coreMat = new THREE.ShaderMaterial({
        uniforms: {
            uTime: { value: 0 },
            uColor: { value: new THREE.Color(isBlue ? 0x00f0ff : 0xffaa00) },
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
            uniform float uTime;
            varying vec2 vUv;
            void main() {
                float ripple = sin(vUv.x * 25.0 + uTime * 12.0) * cos(vUv.y * 25.0 - uTime * 12.0) * 0.2 + 0.8;
                gl_FragColor = vec4(uColor * 2.5 * ripple, 1.0);
            }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
    });
    const coreMesh = new THREE.Mesh(coreGeo, coreMat);
    scene.add(coreMesh);

    // Instanced blue flames & embers trailing behind
    const trailGeo = pooledPlane(0.7, 0.7);
    const trailMat = getPooledMaterial({
        map: blueFlameTex,
        color: isBlue ? 0x00dfff : 0xff7700,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
    });
    const trailCount = 35;
    const trailMesh = new THREE.InstancedMesh(trailGeo, trailMat, trailCount);
    trailMesh.frustumCulled = false;
    scene.add(trailMesh);

    const trailPositions: THREE.Vector3[] = [];
    const trailVels: THREE.Vector3[] = [];
    const trailAges: number[] = [];
    const hideM = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < trailCount; i++) {
        trailPositions.push(new THREE.Vector3().copy(start));
        trailVels.push(new THREE.Vector3((Math.random() - 0.5) * 2.0, (Math.random() - 0.5) * 2.0, (Math.random() - 0.5) * 2.0));
        trailAges.push(-1);
        trailMesh.setMatrixAt(i, hideM);
    }
    trailMesh.instanceMatrix.needsUpdate = true;

    // 3x3 flipbook explosion on impact (cartoon-blue-gas-explosion/tex_3.png)
    const expGeo = new THREE.PlaneGeometry(3.5, 3.5);
    const expMat = makeFlipbookMat(blueExplosionTex, 3, 3, isBlue ? new THREE.Color(1.5, 1.5, 2.0) : new THREE.Color(2.5, 1.8, 1.0));
    const expMesh = new THREE.InstancedMesh(expGeo, expMat, 1);
    const aFrame = new Float32Array(1);
    const aOpacity = new Float32Array(1);
    expMesh.geometry.setAttribute('aFrame', new THREE.InstancedBufferAttribute(aFrame, 1));
    expMesh.geometry.setAttribute('aOpacity', new THREE.InstancedBufferAttribute(aOpacity, 1));
    expMesh.setMatrixAt(0, hideM);
    aOpacity[0] = 0.0;
    scene.add(expMesh);
    expMesh.instanceMatrix.needsUpdate = true;
    (expMesh.geometry.getAttribute('aOpacity') as THREE.InstancedBufferAttribute).needsUpdate = true;
    (expMesh.geometry.getAttribute('aFrame') as THREE.InstancedBufferAttribute).needsUpdate = true;

    let age = 0;
    const flightDuration = 0.55;
    let impactAge = -1;

    activeFX.push({
        update(delta) {
            age += delta;
            coreMat.uniforms.uTime.value = age;

            if (impactAge === -1) {
                const t = Math.min(1, age / flightDuration);
                const currentPos = new THREE.Vector3().lerpVectors(start, end, easeOutQuad(t));
                coreMesh.position.copy(currentPos);

                // Update trails along flight path
                const cq = camera.quaternion;
                const step = Math.floor(t * trailCount);
                for (let i = 0; i < trailCount; i++) {
                    if (i <= step && trailAges[i] === -1) {
                        trailPositions[i].copy(currentPos);
                        trailAges[i] = age;
                    }
                    if (trailAges[i] !== -1) {
                        const elapsed = age - trailAges[i];
                        trailPositions[i].addScaledVector(trailVels[i], delta);
                        _tempObj.position.copy(trailPositions[i]);
                        _tempObj.quaternion.copy(cq);
                        _tempObj.scale.setScalar(Math.max(0.01, (1.0 - elapsed * 2.0) * 1.3));
                        _tempObj.updateMatrix();
                        trailMesh.setMatrixAt(i, _tempObj.matrix);
                    }
                }
                trailMesh.instanceMatrix.needsUpdate = true;

                if (t >= 1) {
                    impactAge = age;
                    scene.remove(coreMesh);
                    scene.remove(trailMesh);
                    coreGeo.dispose();
                    coreMat.dispose();
                    releasePooledMaterial(trailMat);
                    trailMesh.dispose();
                }
            } else {
                // Animate cartoon flipbook explosion on impact point
                const elapsed = age - impactAge;
                const maxLife = 0.45;
                const pct = Math.min(1, elapsed / maxLife);

                if (pct < 1.0) {
                    _tempObj.position.copy(end);
                    _tempObj.quaternion.copy(camera.quaternion);
                    _tempObj.scale.setScalar(1.0 + pct * 2.0);
                    _tempObj.updateMatrix();
                    expMesh.setMatrixAt(0, _tempObj.matrix);

                    aFrame[0] = Math.min(8, Math.floor(pct * 9.0));
                    aOpacity[0] = 1.0 - pct;

                    expMesh.instanceMatrix.needsUpdate = true;
                    (expMesh.geometry.getAttribute('aFrame') as THREE.InstancedBufferAttribute).needsUpdate = true;
                    (expMesh.geometry.getAttribute('aOpacity') as THREE.InstancedBufferAttribute).needsUpdate = true;
                } else {
                    scene.remove(expMesh);
                    expGeo.dispose();
                    expMat.dispose();
                    expMesh.dispose();
                    return false;
                }
            }

            return true;
        },
    });
}

// ─── Upgrade: Double Shot (Spiraling blue embers trails & mini flipbook impacts) ───
export function spawnDoubleShotFX(
    scene: THREE.Scene,
    fx: number,
    fy: number,
    fz: number,
    tx: number,
    ty: number,
    tz: number,
    isTurret?: boolean,
    team?: number,
) {
    const start = new THREE.Vector3(fx, fy, fz);
    const end = new THREE.Vector3(tx, ty, tz);
    const isBlue = team === 1;

    if (isTurret) {
        // Sci-fi laser instant beam
        const flareGeo = pooledPlane(1.8, 1.8);
        const flareMat = new THREE.MeshBasicMaterial({
            map: lightTex,
            color: isBlue ? 0x00dfff : 0xffaa00,
            transparent: true,
            opacity: 1.0,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
        });
        const flareMesh = new THREE.Mesh(flareGeo, flareMat);
        flareMesh.position.copy(start);
        scene.add(flareMesh);

        const dir = new THREE.Vector3().subVectors(end, start);
        const dist = dir.length();
        const mid = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);

        const coreGeo = new THREE.CylinderGeometry(0.04, 0.04, dist, 6);
        const coreMat = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 1.0,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });
        const coreMesh = new THREE.Mesh(coreGeo, coreMat);

        const glowGeo = new THREE.CylinderGeometry(0.18, 0.18, dist, 6);
        const glowMat = new THREE.MeshBasicMaterial({
            color: isBlue ? 0x0044ff : 0xff3300,
            transparent: true,
            opacity: 0.8,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });
        const glowMesh = new THREE.Mesh(glowGeo, glowMat);

        const laserGroup = new THREE.Group();
        laserGroup.add(coreMesh);
        laserGroup.add(glowMesh);

        const up = new THREE.Vector3(0, 1, 0);
        const quat = new THREE.Quaternion().setFromUnitVectors(up, dir.clone().normalize());

        laserGroup.position.copy(mid);
        laserGroup.quaternion.copy(quat);
        scene.add(laserGroup);

        spawnExplosion(scene, end, isBlue ? 0x0088ff : 0xff7700, 36, 0.5);

        let age = 0;
        const duration = 0.16;
        activeFX.push({
            update(delta) {
                age += delta;
                const t = Math.min(1, age / duration);
                if (t >= 1) {
                    scene.remove(flareMesh);
                    scene.remove(laserGroup);
                    flareMat.dispose();
                    coreGeo.dispose();
                    coreMat.dispose();
                    glowGeo.dispose();
                    glowMat.dispose();
                    return false;
                }
                flareMesh.scale.setScalar(0.4 + t * 2.2);
                flareMesh.quaternion.copy(camera.quaternion);
                flareMat.opacity = 1.0 - easeOutCubic(t);

                coreMat.opacity = 1.0 - t;
                glowMat.opacity = 0.8 * (1.0 - t);
                return true;
            },
        });
    } else {
        // Regular Archer double shot (two moving projectiles)
        const shootArrow = (delay: number, isOffsetLeft: boolean) => {
            let age = -delay;
            const flight = 0.42;

            const projectileGeo = new THREE.SphereGeometry(0.2, 8, 8);
            const projectileMat = new THREE.MeshBasicMaterial({
                color: 0xffffff,
                transparent: true,
                opacity: 0.95,
                blending: THREE.AdditiveBlending,
            });
            const proj = new THREE.Mesh(projectileGeo, projectileMat);

            // Orbiting particle trail mesh (blueEmbersTex)
            const trailGeo = pooledPlane(0.35, 0.35);
            const trailMat = getPooledMaterial({
                map: blueEmbersTex,
                color: isBlue ? 0x00dfff : 0xffdd44,
                transparent: true,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                side: THREE.DoubleSide,
            });
            const TRAIL_LEN = 14;
            const trailMesh = new THREE.InstancedMesh(trailGeo, trailMat, TRAIL_LEN);
            trailMesh.frustumCulled = false;

            const hideM = new THREE.Matrix4().makeScale(0, 0, 0);
            for (let i = 0; i < TRAIL_LEN; i++) {
                trailMesh.setMatrixAt(i, hideM);
            }
            trailMesh.instanceMatrix.needsUpdate = true;

            const trailPosList: THREE.Vector3[] = Array.from({ length: TRAIL_LEN }, () => start.clone());

            // Cartoon impact flipbook
            const expGeo = new THREE.PlaneGeometry(1.8, 1.8);
            const expMat = makeFlipbookMat(blueExplosionTex, 3, 3, isBlue ? new THREE.Color(1.0, 1.2, 1.5) : new THREE.Color(1.8, 1.3, 0.8));
            const expMesh = new THREE.InstancedMesh(expGeo, expMat, 1);
            const aFrame = new Float32Array(1);
            const aOpacity = new Float32Array(1);
            expMesh.geometry.setAttribute('aFrame', new THREE.InstancedBufferAttribute(aFrame, 1));
            expMesh.geometry.setAttribute('aOpacity', new THREE.InstancedBufferAttribute(aOpacity, 1));
            expMesh.setMatrixAt(0, hideM);
            aOpacity[0] = 0.0;

            let impactAge = -1;
            let addedToScene = false;

            activeFX.push({
                update(delta) {
                    age += delta;
                    if (age < 0) return true;

                    if (!addedToScene) {
                        addedToScene = true;
                        scene.add(proj);
                        scene.add(trailMesh);
                        scene.add(expMesh);
                        expMesh.instanceMatrix.needsUpdate = true;
                        (expMesh.geometry.getAttribute('aOpacity') as THREE.InstancedBufferAttribute).needsUpdate = true;
                        (expMesh.geometry.getAttribute('aFrame') as THREE.InstancedBufferAttribute).needsUpdate = true;
                    }

                    if (impactAge === -1) {
                        const t = Math.min(1, age / flight);
                        const linearPos = new THREE.Vector3().lerpVectors(start, end, easeOutQuad(t));

                        // Spiral calculations
                        const orbitSpd = 32.0;
                        const radius = 0.4 * (1.0 - t);
                        const angle = age * orbitSpd + (isOffsetLeft ? Math.PI : 0);
                        const spiralOffset = new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);

                        const dir = new THREE.Vector3().subVectors(end, start).normalize();
                        const up = new THREE.Vector3(0, 1, 0);
                        const quat = new THREE.Quaternion().setFromUnitVectors(up, dir);
                        spiralOffset.applyQuaternion(quat);

                        const finalPos = new THREE.Vector3().copy(linearPos).add(spiralOffset);
                        proj.position.copy(finalPos);

                        trailPosList.pop();
                        trailPosList.unshift(finalPos.clone());

                        const cq = camera.quaternion;
                        for (let i = 0; i < TRAIL_LEN; i++) {
                            _tempObj.position.copy(trailPosList[i]);
                            _tempObj.quaternion.copy(cq);
                            _tempObj.scale.setScalar((1.0 - (i / TRAIL_LEN)) * (1.0 - t) * 0.8);
                            _tempObj.updateMatrix();
                            trailMesh.setMatrixAt(i, _tempObj.matrix);
                        }
                        trailMesh.instanceMatrix.needsUpdate = true;

                        if (t >= 1) {
                            impactAge = age;
                            if (addedToScene) {
                                scene.remove(proj);
                                scene.remove(trailMesh);
                            }
                            projectileGeo.dispose();
                            projectileMat.dispose();
                            releasePooledMaterial(trailMat);
                            trailMesh.dispose();
                        }
                    } else {
                        // Impact cartoon explosion
                        const elapsed = age - impactAge;
                        const maxLife = 0.35;
                        const pct = Math.min(1, elapsed / maxLife);

                        if (pct < 1.0) {
                            _tempObj.position.copy(end);
                            _tempObj.quaternion.copy(camera.quaternion);
                            _tempObj.scale.setScalar(0.5 + pct * 1.5);
                            _tempObj.updateMatrix();
                            expMesh.setMatrixAt(0, _tempObj.matrix);

                            aFrame[0] = Math.min(8, Math.floor(pct * 9.0));
                            aOpacity[0] = 1.0 - pct;

                            expMesh.instanceMatrix.needsUpdate = true;
                            (expMesh.geometry.getAttribute('aFrame') as THREE.InstancedBufferAttribute).needsUpdate = true;
                            (expMesh.geometry.getAttribute('aOpacity') as THREE.InstancedBufferAttribute).needsUpdate = true;
                        } else {
                            if (addedToScene) {
                                scene.remove(expMesh);
                            }
                            expGeo.dispose();
                            expMat.dispose();
                            expMesh.dispose();
                            return false;
                        }
                    }
                    return true;
                },
            });
        };

        shootArrow(0, false);
        shootArrow(0.08, true);
    }
}
