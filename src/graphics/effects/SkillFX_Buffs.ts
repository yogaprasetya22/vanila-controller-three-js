import * as THREE from "three";
import { camera } from "../core/scene";
import {
    easeOutCubic,
    pooledPlane,
    pooledRing,
    getPooledMaterial,
    releasePooledMaterial,
    star2Tex,
    smokeTex,
    activeFX,
    fxQualityScale,
    _tempObj,
} from "./FXCore";

// ─── Upgrade: Iron Fortitude Aura (Dual Concentric Rotating Runes + Light Pillars) ───
export function spawnIronFortitudeAuraFX(
    scene: THREE.Scene,
    x: number,
    y: number,
    z: number,
    team?: number,
) {
    const isBlue = team === 1;
    const colorRing1 = isBlue ? 0x00dfff : 0xffd700;
    const colorRing2 = isBlue ? 0x3366ff : 0xffaa00;
    const colorSparks = isBlue ? 0x88f0ff : 0xffeebb;

    // Custom shader for rotating concentric runic-like grid circle
    const runeGeo = new THREE.PlaneGeometry(3.0, 3.0);
    const runeMat = new THREE.ShaderMaterial({
        uniforms: {
            uTime: { value: 0 },
            uColor: { value: new THREE.Color(colorRing1) },
            uColor2: { value: new THREE.Color(colorRing2) },
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
            uniform vec3 uColor2;
            uniform float uTime;
            uniform float uOpacity;
            varying vec2 vUv;

            void main() {
                vec2 uv = vUv - vec2(0.5);
                float dist = length(uv);
                if (dist > 0.5) discard;

                // Runic rings pattern
                float ring1 = smoothstep(0.01, 0.0, abs(dist - 0.45));
                float ring2 = smoothstep(0.01, 0.0, abs(dist - 0.35));
                float ring3 = smoothstep(0.01, 0.0, abs(dist - 0.20));

                // Rotating spokes (runic ticks)
                float angle = atan(uv.y, uv.x);
                float spoke1 = step(0.98, sin(angle * 12.0 + uTime * 3.0));
                float spoke2 = step(0.98, sin(angle * 8.0 - uTime * 2.0));

                float pattern = ring1 + ring2 + ring3 + spoke1 * ring1 + spoke2 * ring2;
                vec3 finalCol = mix(uColor, uColor2, dist * 2.0);
                
                gl_FragColor = vec4(finalCol * 2.0, pattern * uOpacity * (1.0 - dist * 2.0));
            }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
    });
    const runeMesh = new THREE.Mesh(runeGeo, runeMat);
    runeMesh.rotation.x = -Math.PI / 2;
    runeMesh.position.set(x, y + 0.02, z);
    scene.add(runeMesh);

    // Glowing rising column mesh
    const pillarGeo = new THREE.CylinderGeometry(0.8, 1.0, 4.0, 24, 1, true);
    const pillarMat = new THREE.ShaderMaterial({
        uniforms: {
            uTime: { value: 0 },
            uColor: { value: new THREE.Color(colorRing2) },
            uOpacity: { value: 1.0 },
        },
        vertexShader: `
            varying vec2 vUv;
            varying float vPosY;
            void main() {
                vUv = uv;
                vPosY = position.y;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform vec3 uColor;
            uniform float uTime;
            uniform float uOpacity;
            varying vec2 vUv;
            varying float vPosY;

            void main() {
                // Rising energy waves
                float wave = sin(vUv.y * 15.0 - uTime * 6.0) * 0.5 + 0.5;
                float edgeGlow = sin(vUv.x * 3.14159);
                float verticalFade = (2.0 - vPosY) / 4.0; // fade out as it goes up

                gl_FragColor = vec4(uColor * 1.5, wave * edgeGlow * verticalFade * uOpacity * 0.4);
            }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
    });
    const pillar = new THREE.Mesh(pillarGeo, pillarMat);
    pillar.position.set(x, y + 2.0, z);
    scene.add(pillar);

    // Instanced rising stars
    const spGeo = pooledPlane(0.25, 0.25);
    const spMat = getPooledMaterial({
        map: star2Tex,
        color: colorSparks,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
    });
    const SPS = Math.round(18 * fxQualityScale());
    const instMesh = new THREE.InstancedMesh(spGeo, spMat, SPS);
    instMesh.frustumCulled = false;
    scene.add(instMesh);

    const spVels: THREE.Vector3[] = [];
    const spOffsets: THREE.Vector3[] = [];
    for (let i = 0; i < SPS; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = 0.1 + Math.random() * 0.8;
        spOffsets.push(new THREE.Vector3(x + Math.cos(a) * r, y + 0.1, z + Math.sin(a) * r));
        spVels.push(new THREE.Vector3((Math.random() - 0.5) * 0.3, 2.0 + Math.random() * 2.5, (Math.random() - 0.5) * 0.3));
    }

    let age = 0;
    const duration = 1.2;
    activeFX.push({
        update(delta) {
            age += delta;
            const t = Math.min(1, age / duration);
            if (t >= 1) {
                scene.remove(runeMesh);
                scene.remove(pillar);
                scene.remove(instMesh);
                runeGeo.dispose();
                runeMat.dispose();
                pillarGeo.dispose();
                pillarMat.dispose();
                releasePooledMaterial(spMat);
                instMesh.dispose();
                return false;
            }
            const et = easeOutCubic(t);

            runeMat.uniforms.uTime.value = age;
            runeMat.uniforms.uOpacity.value = 1.0 - et;
            runeMesh.scale.setScalar(1.0 + et * 0.3);

            pillarMat.uniforms.uTime.value = age;
            pillarMat.uniforms.uOpacity.value = (1.0 - et) * (1.0 - et);
            pillar.scale.set(1.0 + et * 0.5, 1.0, 1.0 + et * 0.5);

            const cq = camera.quaternion;
            for (let i = 0; i < SPS; i++) {
                spOffsets[i].addScaledVector(spVels[i], delta);
                _tempObj.position.copy(spOffsets[i]);
                _tempObj.quaternion.copy(cq);
                _tempObj.scale.setScalar((1.0 - t) * (0.6 + Math.sin(age * 12 + i) * 0.4));
                _tempObj.updateMatrix();
                instMesh.setMatrixAt(i, _tempObj.matrix);
            }
            instMesh.instanceMatrix.needsUpdate = true;
            return true;
        },
    });
}

// ─── Upgrade: Frost Nova (Expanding Cryo Shockwave + Rotating Ice Shards) ───
export function spawnFrostNovaBurstFX(
    scene: THREE.Scene,
    x: number,
    y: number,
    z: number,
    team?: number,
) {
    const isBlue = team === 1;
    const colorRing = isBlue ? 0x00eaff : 0xffaa44;
    const colorSpike = isBlue ? 0x88f5ff : 0xffcda0;

    // Ground icy shockwave expansion using custom shader
    const waveGeo = new THREE.PlaneGeometry(1.0, 1.0);
    const waveMat = new THREE.ShaderMaterial({
        uniforms: {
            uTime: { value: 0 },
            uColor: { value: new THREE.Color(colorRing) },
            uScale: { value: 1.0 },
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
            uniform float uScale;
            varying vec2 vUv;
            void main() {
                vec2 uv = vUv - vec2(0.5);
                float dist = length(uv);
                if (dist > 0.5) discard;
                
                // Double ring shockwave
                float ring1 = smoothstep(0.02, 0.0, abs(dist - 0.45));
                float ring2 = smoothstep(0.04, 0.0, abs(dist - 0.35));
                
                float alpha = (ring1 * 0.8 + ring2 * 0.4) * (1.0 - dist * 2.0);
                gl_FragColor = vec4(uColor * 2.0, alpha);
            }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
    });
    const waveMesh = new THREE.Mesh(waveGeo, waveMat);
    waveMesh.rotation.x = -Math.PI / 2;
    waveMesh.position.set(x, y + 0.04, z);
    scene.add(waveMesh);

    // High-density sharp ice shards (Instanced mesh, Dodecahedrons)
    const shardCount = 32;
    const shardGeo = new THREE.DodecahedronGeometry(0.24, 0);
    const shardMat = new THREE.ShaderMaterial({
        uniforms: {
            uColor: { value: new THREE.Color(colorSpike) },
            uOpacity: { value: 1.0 },
        },
        vertexShader: `
            varying float vNormalDot;
            varying vec3 vViewPos;
            void main() {
                vec3 norm = normalize(normalMatrix * normal);
                vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
                vViewPos = -mvPosition.xyz;
                vNormalDot = abs(dot(norm, normalize(vViewPos)));
                gl_Position = projectionMatrix * mvPosition;
            }
        `,
        fragmentShader: `
            uniform vec3 uColor;
            uniform float uOpacity;
            varying float vNormalDot;
            void main() {
                // Fresnel ice highlight
                float highlight = pow(1.0 - vNormalDot, 3.0);
                gl_FragColor = vec4(mix(uColor, vec3(1.0), highlight * 0.8) * 1.5, uOpacity);
            }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
    });
    const shardMesh = new THREE.InstancedMesh(shardGeo, shardMat, shardCount);
    shardMesh.frustumCulled = false;
    scene.add(shardMesh);

    const shardOffsets: THREE.Vector3[] = [];
    const shardVels: THREE.Vector3[] = [];
    const shardScales: number[] = [];
    const shardRots: THREE.Vector3[] = [];
    const shardRotVels: THREE.Vector3[] = [];

    for (let i = 0; i < shardCount; i++) {
        shardOffsets.push(new THREE.Vector3(x, y + 0.1, z));
        const angle = (i / shardCount) * Math.PI * 2 + Math.random() * 0.2;
        const spd = 6.0 + Math.random() * 8.0;
        shardVels.push(new THREE.Vector3(Math.cos(angle) * spd, 3.0 + Math.random() * 5.0, Math.sin(angle) * spd));
        shardScales.push(0.6 + Math.random() * 0.6);
        shardRots.push(new THREE.Vector3(Math.random(), Math.random(), Math.random()));
        shardRotVels.push(new THREE.Vector3(Math.random() * 10, Math.random() * 10, Math.random() * 10));
    }

    // Instanced icy mist/vapor
    const mistGeo = pooledPlane(1.0, 1.0);
    const mistMat = getPooledMaterial({
        map: smokeTex,
        color: colorRing,
        transparent: true,
        opacity: 0.35,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
    });
    const mistCount = 20;
    const mistMesh = new THREE.InstancedMesh(mistGeo, mistMat, mistCount);
    mistMesh.frustumCulled = false;
    scene.add(mistMesh);

    const mistPositions: THREE.Vector3[] = [];
    const mistVels: THREE.Vector3[] = [];
    const mistScales: number[] = [];
    for (let i = 0; i < mistCount; i++) {
        mistPositions.push(new THREE.Vector3(x, y + 0.1, z));
        const angle = Math.random() * Math.PI * 2;
        const spd = 2.0 + Math.random() * 4.0;
        mistVels.push(new THREE.Vector3(Math.cos(angle) * spd, 0.2 + Math.random() * 0.8, Math.sin(angle) * spd));
        mistScales.push(1.0 + Math.random() * 1.5);
    }

    let age = 0;
    const duration = 0.9;
    activeFX.push({
        update(delta) {
            age += delta;
            const t = Math.min(1, age / duration);
            if (t >= 1) {
                scene.remove(waveMesh);
                scene.remove(shardMesh);
                scene.remove(mistMesh);
                waveGeo.dispose();
                waveMat.dispose();
                shardGeo.dispose();
                shardMat.dispose();
                releasePooledMaterial(mistMat);
                mistMesh.dispose();
                return false;
            }

            const scaleVal = 1.0 + t * 18.0;
            waveMesh.scale.set(scaleVal, scaleVal, 1.0);
            waveMat.uniforms.uScale.value = scaleVal;

            shardMat.uniforms.uOpacity.value = 1.0 - t;

            const cq = camera.quaternion;
            for (let i = 0; i < shardCount; i++) {
                const p = shardOffsets[i];
                shardVels[i].y -= 9.8 * delta; // drop down
                p.addScaledVector(shardVels[i], delta);

                shardRots[i].addScaledVector(shardRotVels[i], delta);

                _tempObj.position.copy(p);
                _tempObj.rotation.set(shardRots[i].x, shardRots[i].y, shardRots[i].z);
                _tempObj.scale.setScalar(shardScales[i] * Math.sin(t * Math.PI));
                _tempObj.updateMatrix();
                shardMesh.setMatrixAt(i, _tempObj.matrix);
            }
            shardMesh.instanceMatrix.needsUpdate = true;

            for (let i = 0; i < mistCount; i++) {
                mistPositions[i].addScaledVector(mistVels[i], delta);
                _tempObj.position.copy(mistPositions[i]);
                _tempObj.quaternion.copy(cq);
                _tempObj.scale.setScalar(mistScales[i] * (1.0 + t * 2.0));
                _tempObj.updateMatrix();
                mistMesh.setMatrixAt(i, _tempObj.matrix);
            }
            mistMesh.instanceMatrix.needsUpdate = true;
            mistMat.opacity = 0.45 * (1.0 - t) * (1.0 - t);

            return true;
        },
    });
}

// ─── Upgrade: Divine Shield (Holographic energy dome with Fresnel edge-glow) ───
export function spawnDivineShieldFX(
    scene: THREE.Scene,
    targetPos: THREE.Vector3,
    team?: number,
) {
    const isBlue = team === 1;
    const colorShield = isBlue ? 0x00f0ff : 0xffc300;
    const colorCore = isBlue ? 0xaae8ff : 0xffeebb;

    // Glowing energy sphere geometry using a custom edge-glow shader
    const shieldGeo = new THREE.SphereGeometry(1.25, 32, 32);
    const shieldMat = new THREE.ShaderMaterial({
        uniforms: {
            uTime: { value: 0 },
            uColor: { value: new THREE.Color(colorShield) },
            uCoreColor: { value: new THREE.Color(colorCore) },
            uOpacity: { value: 1.0 },
        },
        vertexShader: `
            varying vec3 vNormal;
            varying vec3 vViewPosition;
            varying vec2 vUv;
            void main() {
                vUv = uv;
                vNormal = normalize(normalMatrix * normal);
                vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                vViewPosition = -mvPosition.xyz;
                gl_Position = projectionMatrix * mvPosition;
            }
        `,
        fragmentShader: `
            uniform vec3 uColor;
            uniform vec3 uCoreColor;
            uniform float uTime;
            uniform float uOpacity;
            varying vec3 vNormal;
            varying vec3 vViewPosition;
            varying vec2 vUv;

            void main() {
                vec3 normal = normalize(vNormal);
                vec3 viewDir = normalize(vViewPosition);

                // Fresnel Edge-Glow
                float edge = pow(1.0 - max(0.0, dot(normal, viewDir)), 2.5);

                // Scrolling holographic grid grid lines
                float grid = sin(vUv.x * 60.0 + uTime * 2.0) * sin(vUv.y * 60.0 - uTime * 2.0);
                grid = smoothstep(0.7, 0.9, grid) * 0.3;

                // Pulsing energy waves
                float pulse = sin(vUv.y * 12.0 - uTime * 8.0) * 0.15 + 0.85;

                vec3 color = mix(uColor, uCoreColor, edge * 0.5);
                gl_FragColor = vec4(color * 1.8, (edge * 0.9 + grid * pulse) * uOpacity);
            }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
    });
    const shieldMesh = new THREE.Mesh(shieldGeo, shieldMat);
    shieldMesh.position.copy(targetPos);
    shieldMesh.position.y += 0.8; // center around character body
    scene.add(shieldMesh);

    // Dynamic ground runic aura ring
    const groundGeo = new THREE.RingGeometry(0.2, 1.3, 32);
    const groundMat = new THREE.MeshBasicMaterial({
        color: colorShield,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
    });
    const groundRing = new THREE.Mesh(groundGeo, groundMat);
    groundRing.rotation.x = -Math.PI / 2;
    groundRing.position.set(targetPos.x, targetPos.y + 0.04, targetPos.z);
    scene.add(groundRing);

    let age = 0;
    const duration = 2.0; // shield stays for 2 seconds
    activeFX.push({
        update(delta) {
            age += delta;
            const t = Math.min(1, age / duration);
            if (t >= 1) {
                scene.remove(shieldMesh);
                scene.remove(groundRing);
                shieldGeo.dispose();
                shieldMat.dispose();
                groundGeo.dispose();
                groundMat.dispose();
                return false;
            }

            shieldMat.uniforms.uTime.value = age;
            
            // Pulse scale slightly
            const scale = 1.0 + Math.sin(age * 5.0) * 0.03;
            shieldMesh.scale.setScalar(scale);

            // Fade out near end of duration
            const fade = t > 0.8 ? (1.0 - (t - 0.8) / 0.2) : 1.0;
            shieldMat.uniforms.uOpacity.value = fade;
            groundMat.opacity = 0.9 * fade;
            groundRing.rotation.z += 0.02;

            return true;
        },
    });
}
