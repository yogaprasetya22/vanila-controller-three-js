import * as THREE from "three";
import { camera } from "../core/scene";
import {
    pooledPlane,
    starTex,
    activeFX,
    alignGroundDecal,
    getPooledMaterial,
    releasePooledMaterial,
} from "./FXCore";

export function spawnHolySanctuaryFX(
    scene: THREE.Scene,
    centerPos: THREE.Vector3,
    team?: number,
) {
    const isBlue = team === 1;
    const colorRing = isBlue ? 0x00dfff : 0xffff00;
    const colorDome = isBlue ? 0xaae8ff : 0xffffaa;
    const colorSpark = isBlue ? 0x88ddff : 0xffdd66;

    // Glowing runic circle on the ground
    const ringGeo = new THREE.PlaneGeometry(3.5, 3.5);
    const ringMat = new THREE.ShaderMaterial({
        uniforms: {
            uTime: { value: 0 },
            uColor: { value: new THREE.Color(colorRing) },
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
                float r1 = smoothstep(0.015, 0.0, abs(dist - 0.44));
                float r2 = smoothstep(0.01, 0.0, abs(dist - 0.32));
                float rad = atan(uv.y, uv.x);
                float spokes = step(0.96, sin(rad * 8.0 - uTime * 3.0)) * r1;
                gl_FragColor = vec4(uColor * 2.0, (r1 + r2 + spokes) * uOpacity * (1.0 - dist * 1.8));
            }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    alignGroundDecal(ring, centerPos.x, centerPos.z, 0.04);
    scene.add(ring);

    // Glowing Hemispherical Sanctuary Dome shell
    const domeGeo = new THREE.SphereGeometry(1.8, 24, 18, 0, Math.PI * 2, 0, Math.PI / 2);
    const domeMat = new THREE.ShaderMaterial({
        uniforms: {
            uTime: { value: 0 },
            uColor: { value: new THREE.Color(colorDome) },
            uOpacity: { value: 1.0 },
        },
        vertexShader: `
            varying vec3 vNormal;
            varying vec3 vViewPos;
            void main() {
                vNormal = normalize(normalMatrix * normal);
                vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                vViewPos = -mvPosition.xyz;
                gl_Position = projectionMatrix * mvPosition;
            }
        `,
        fragmentShader: `
            uniform vec3 uColor;
            uniform float uOpacity;
            uniform float uTime;
            varying vec3 vNormal;
            varying vec3 vViewPos;
            void main() {
                vec3 normal = normalize(vNormal);
                vec3 viewDir = normalize(vViewPos);
                
                // Fresnel glow
                float fresnel = pow(1.0 - max(0.0, dot(normal, viewDir)), 3.0);
                
                // Pulsing vertical stripe grid lines
                float stripes = sin(vViewPos.y * 8.0 - uTime * 4.0) * 0.15 + 0.85;

                gl_FragColor = vec4(uColor * 2.2, fresnel * stripes * uOpacity * 0.45);
            }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
    });
    const dome = new THREE.Mesh(domeGeo, domeMat);
    dome.position.copy(centerPos);
    scene.add(dome);

    // Star particles
    const starCount = 20;
    const starGeo = pooledPlane(0.35, 0.35);
    const starMat = getPooledMaterial({
        map: starTex,
        color: colorSpark,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
    });
    const starMesh = new THREE.InstancedMesh(starGeo, starMat, starCount);
    starMesh.frustumCulled = false;
    scene.add(starMesh);

    const starPositions: THREE.Vector3[] = [];
    const starVels: THREE.Vector3[] = [];
    const starScales: number[] = [];
    for (let i = 0; i < starCount; i++) {
        const angle = Math.random() * Math.PI * 2;
        const dist = Math.random() * 1.5;
        starPositions.push(new THREE.Vector3(
            centerPos.x + Math.cos(angle) * dist,
            centerPos.y + 0.1 + Math.random() * 0.5,
            centerPos.z + Math.sin(angle) * dist
        ));
        starVels.push(new THREE.Vector3(
            (Math.random() - 0.5) * 0.2,
            1.5 + Math.random() * 2.0,
            (Math.random() - 0.5) * 0.2
        ));
        starScales.push(0.6 + Math.random() * 0.6);
    }

    let age = 0;
    const duration = 2.0; // Stay for 2 seconds

    activeFX.push({
        update(delta) {
            age += delta;
            const t = Math.min(1, age / duration);

            if (t >= 1) {
                scene.remove(ring);
                scene.remove(dome);
                scene.remove(starMesh);
                ringGeo.dispose();
                ringMat.dispose();
                domeGeo.dispose();
                domeMat.dispose();
                releasePooledMaterial(starMat);
                starMesh.dispose();
                return false;
            }

            ringMat.uniforms.uTime.value = age;
            ringMat.uniforms.uOpacity.value = 1.0 - t;

            domeMat.uniforms.uTime.value = age;
            domeMat.uniforms.uOpacity.value = 1.0 - t;
            dome.scale.setScalar(1.0 + Math.sin(age * 3.0) * 0.02);

            const cq = camera.quaternion;
            const tempObj = new THREE.Object3D();
            for (let i = 0; i < starCount; i++) {
                const p = starPositions[i];
                p.addScaledVector(starVels[i], delta);

                tempObj.position.copy(p);
                tempObj.quaternion.copy(cq);
                tempObj.scale.setScalar(starScales[i] * Math.sin(t * Math.PI));
                tempObj.updateMatrix();
                starMesh.setMatrixAt(i, tempObj.matrix);
            }
            starMesh.instanceMatrix.needsUpdate = true;
            starMat.opacity = 0.9 * (1.0 - t);

            return true;
        },
    });
}
