import * as THREE from "three";
import { camera } from "../core/scene";
import {
    pooledPlane,
    getPooledMaterial,
    releasePooledMaterial,
    smokeTex,
    activeFX,
    alignGroundDecal,
    _tempObj,
} from "./FXCore";

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
    alignGroundDecal(waveMesh, x, z, 0.04);
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
