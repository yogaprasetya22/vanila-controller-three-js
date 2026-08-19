/**
 * SkillFX_Lightning.ts — Chain Lightning with random noise offsets & branching neon sub-sparks
 */

import * as THREE from "three";
import { camera } from "../core/scene";
import { easeOutCubic, activeFX, spawnExplosion } from "./FXCore";

export function spawnLightningFX(
    scene: THREE.Scene,
    points: THREE.Vector3[],
    team?: number,
): void {
    if (points.length < 2) return;

    const SEGMENTS = 12; // Higher detail segments
    const isBlue = team === 1;
    const colorLightning = isBlue ? 0xaae8ff : 0xffccaa;
    const colorSpark = isBlue ? 0x00dfff : 0xff5500;

    const meshes: THREE.Mesh[] = [];
    const cylinderGeoPool: THREE.CylinderGeometry[] = [];
    const jointPositions: THREE.Vector3[] = [];

    // Glowing Neon line material
    const mat = new THREE.ShaderMaterial({
        uniforms: {
            uColor: { value: new THREE.Color(colorLightning) },
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
                // Neon glow profile (intense center core fading out)
                float glow = sin(vUv.x * 3.14159);
                gl_FragColor = vec4(uColor * 2.0, glow * uOpacity);
            }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
    });

    for (let pi = 0; pi < points.length - 1; pi++) {
        const from = points[pi].clone();
        from.y += 1.0;
        const to = points[pi + 1].clone();
        to.y += 1.0;

        let lastPt = from.clone();
        jointPositions.push(from.clone());

        for (let s = 1; s <= SEGMENTS; s++) {
            const t = s / SEGMENTS;
            const lx = from.x + (to.x - from.x) * t;
            const ly = from.y + (to.y - from.y) * t;
            const lz = from.z + (to.z - from.z) * t;

            // Fractal jagged noise offset
            const noiseFactor = 0.65 * (1.0 - Math.sin(t * Math.PI) * 0.35);
            const jx = s === SEGMENTS ? 0 : (Math.random() - 0.5) * noiseFactor;
            const jy = s === SEGMENTS ? 0 : (Math.random() - 0.5) * noiseFactor;
            const jz = s === SEGMENTS ? 0 : (Math.random() - 0.5) * noiseFactor;
            const nextPt = new THREE.Vector3(lx + jx, ly + jy, lz + jz);

            if (s < SEGMENTS) {
                jointPositions.push(nextPt.clone());
            }

            const dist = lastPt.distanceTo(nextPt);
            // Thick glowing lightning bolt geometry
            const geo = new THREE.CylinderGeometry(0.06, 0.06, dist, 4);
            cylinderGeoPool.push(geo);

            const mesh = new THREE.Mesh(geo, mat);
            mesh.frustumCulled = false;
            const mid = new THREE.Vector3().copy(lastPt).add(nextPt).multiplyScalar(0.5);
            mesh.position.copy(mid);
            mesh.lookAt(nextPt);
            mesh.rotateX(Math.PI / 2);
            scene.add(mesh);
            meshes.push(mesh);

            // Occasional electrical branches (sub-sparks)
            if (s > 1 && s < SEGMENTS && Math.random() > 0.72) {
                const branchLength = dist * (0.8 + Math.random() * 0.8);
                const branchDir = new THREE.Vector3(
                    (Math.random() - 0.5) * 2,
                    (Math.random() - 0.5) * 2,
                    (Math.random() - 0.5) * 2
                ).normalize();
                const branchEnd = new THREE.Vector3().copy(nextPt).addScaledVector(branchDir, branchLength);

                const bGeo = new THREE.CylinderGeometry(0.02, 0.02, branchLength, 4);
                cylinderGeoPool.push(bGeo);
                const bMesh = new THREE.Mesh(bGeo, mat);
                bMesh.frustumCulled = false;
                const bMid = new THREE.Vector3().copy(nextPt).add(branchEnd).multiplyScalar(0.5);
                bMesh.position.copy(bMid);
                bMesh.lookAt(branchEnd);
                bMesh.rotateX(Math.PI / 2);
                scene.add(bMesh);
                meshes.push(bMesh);
            }

            lastPt.copy(nextPt);
        }
        jointPositions.push(to.clone());
        spawnExplosion(scene, to, colorSpark, 12, 0.15);
    }

    // Instanced glowing neon spark nodes at joints
    const glowCount = jointPositions.length;
    const glowGeo = new THREE.PlaneGeometry(0.85, 0.85);
    const glowMat = new THREE.ShaderMaterial({
        uniforms: {
            uColor: { value: new THREE.Color(colorLightning) },
            uOpacity: { value: 1.0 },
        },
        vertexShader: `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform vec3 uColor;
            uniform float uOpacity;
            varying vec2 vUv;
            void main() {
                float dist = length(vUv - vec2(0.5));
                if (dist > 0.5) discard;
                float glow = smoothstep(0.5, 0.0, dist);
                gl_FragColor = vec4(uColor * 2.5, glow * uOpacity);
            }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
    });
    const glowMesh = new THREE.InstancedMesh(glowGeo, glowMat, glowCount);
    glowMesh.frustumCulled = false;
    scene.add(glowMesh);

    const tempObj = new THREE.Object3D();
    for (let i = 0; i < glowCount; i++) {
        tempObj.position.copy(jointPositions[i]);
        tempObj.scale.setScalar(0.6 + Math.random() * 0.5);
        tempObj.updateMatrix();
        glowMesh.setMatrixAt(i, tempObj.matrix);
    }
    glowMesh.instanceMatrix.needsUpdate = true;

    let age = 0;
    const duration = 0.28;

    activeFX.push({
        update(delta) {
            age += delta;
            const t = Math.min(1, age / duration);
            if (t >= 1) {
                meshes.forEach((m) => scene.remove(m));
                scene.remove(glowMesh);
                cylinderGeoPool.forEach((g) => g.dispose());
                glowGeo.dispose();
                glowMat.dispose();
                mat.dispose();
                return false;
            }

            // Rapid lightning flickering dynamics
            const flicker = Math.random() > 0.25 ? 1.0 : 0.15;
            const alpha = (1.0 - t) * flicker;
            mat.uniforms.uOpacity.value = alpha;
            glowMat.uniforms.uOpacity.value = alpha * 0.95;

            // Animate scale/thickness of bolts
            const scale = (1.0 - t * 0.4) * flicker;
            meshes.forEach((m) => {
                m.scale.set(scale, 1.0, scale);
            });

            // Billboards updates for joint sparks
            const cq = camera.quaternion;
            for (let i = 0; i < glowCount; i++) {
                tempObj.position.copy(jointPositions[i]);
                tempObj.quaternion.copy(cq);
                tempObj.scale.setScalar((1.0 + Math.sin(age * 60 + i) * 0.25) * (1.0 - t));
                tempObj.updateMatrix();
                glowMesh.setMatrixAt(i, tempObj.matrix);
            }
            glowMesh.instanceMatrix.needsUpdate = true;

            return true;
        },
    });
}
