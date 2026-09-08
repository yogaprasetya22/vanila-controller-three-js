import * as THREE from "three";
import { activeFX, pooledRing, getPooledMaterial, releasePooledMaterial, alignGroundDecal } from "./FXCore";

export function spawnDarkVoidAuraFX(
    scene: THREE.Scene,
    x: number,
    y: number,
    z: number,
    radius: number = 4.0,
    duration: number = 3.5
) {
    const segments = 32;
    const ringGeo = pooledRing(radius - 0.2, radius, segments);
    const ringMat = getPooledMaterial({
        color: 0x9333ea, // Deep violet purple
        transparent: true,
        opacity: 0.8,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide
    });

    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
    alignGroundDecal(ringMesh, x, z, 0.05);
    scene.add(ringMesh);

    // Swirling inner particles represent soul drain fields
    const particleCount = 20;
    const pGeo = new THREE.DodecahedronGeometry(0.15);
    const pMat = new THREE.MeshBasicMaterial({
        color: 0xc084fc, // Bright magenta purple
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });

    const particles: THREE.Mesh[] = [];
    const pAngles: number[] = [];
    const pSpeeds: number[] = [];
    const pHeights: number[] = [];

    for (let i = 0; i < particleCount; i++) {
        const mesh = new THREE.Mesh(pGeo, pMat);
        const angle = Math.random() * Math.PI * 2;
        const dist = Math.random() * radius;
        mesh.position.set(
            x + Math.cos(angle) * dist,
            y + 0.1 + Math.random() * 1.5,
            z + Math.sin(angle) * dist
        );
        scene.add(mesh);
        particles.push(mesh);
        pAngles.push(angle);
        pSpeeds.push(1.0 + Math.random() * 2.0);
        pHeights.push(mesh.position.y);
    }

    let age = 0;

    activeFX.push({
        update(delta) {
            age += delta;
            const progress = age / duration;

            if (progress >= 1.0) {
                scene.remove(ringMesh);
                releasePooledMaterial(ringMat);

                particles.forEach(p => scene.remove(p));
                pGeo.dispose();
                pMat.dispose();
                return false;
            }

            // Spin ground ring decal
            ringMesh.rotation.z += 1.5 * delta;

            // Fade out over time
            const fade = 1.0 - progress;
            ringMat.opacity = 0.8 * fade;

            // Update swirling soul drain particles
            for (let i = 0; i < particleCount; i++) {
                pAngles[i] += pSpeeds[i] * delta;
                const dist = (i / particleCount) * radius * (1.0 - progress * 0.3);
                
                particles[i].position.set(
                    x + Math.cos(pAngles[i]) * dist,
                    pHeights[i] + Math.sin(age * 3 + i) * 0.2,
                    z + Math.sin(pAngles[i]) * dist
                );
                
                particles[i].scale.setScalar(fade * (0.8 + Math.sin(age * 5 + i) * 0.2));
            }

            return true;
        }
    });
}
