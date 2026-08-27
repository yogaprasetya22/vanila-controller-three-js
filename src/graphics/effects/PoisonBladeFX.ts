import * as THREE from "three";
import { activeFX, getPooledMaterial, releasePooledMaterial, pooledPlane, pooledRing } from "./FXCore";

// ponytail: inline all state, no helper classes — ceiling: shared geo pool per particle would save more GC
export function spawnPoisonBladeFX(
    scene: THREE.Scene,
    tx: number,
    ty: number,
    tz: number
) {
    // Premium poison: 3 distinct layers — rising wispy tendrils, orb pulse, ground acid ring

    // ── Layer 1: 16 rising poison vapor puffs ──
    const PUFF_COUNT = 16;
    const puffGeo = pooledPlane(0.55, 0.55);
    const puffMatA = getPooledMaterial({ color: 0x4ade80, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const puffMatB = getPooledMaterial({ color: 0x86efac, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });

    const puffs: THREE.Mesh[] = [];
    const puffVels: THREE.Vector3[] = [];
    const puffAngles: number[] = [];
    const puffRadii: number[] = [];
    const puffUsesA: boolean[] = [];

    for (let i = 0; i < PUFF_COUNT; i++) {
        const useA = i % 2 === 0;
        const mesh = new THREE.Mesh(puffGeo, useA ? puffMatA : puffMatB);
        const angle = (i / PUFF_COUNT) * Math.PI * 2 + Math.random() * 0.4;
        const r = 0.3 + Math.random() * 0.8;
        mesh.position.set(
            tx + Math.cos(angle) * r,
            ty + Math.random() * 0.4,
            tz + Math.sin(angle) * r
        );
        mesh.rotation.z = Math.random() * Math.PI * 2;
        mesh.frustumCulled = false;
        scene.add(mesh);
        puffs.push(mesh);
        puffUsesA.push(useA);
        puffAngles.push(angle);
        puffRadii.push(r);
        puffVels.push(new THREE.Vector3(
            (Math.random() - 0.5) * 0.8,
            0.6 + Math.random() * 1.5,
            (Math.random() - 0.5) * 0.8
        ));
    }

    // ── Layer 2: 3 orbiting poison orbs (drip globs) ──
    const ORB_COUNT = 3;
    const orbGeo = new THREE.SphereGeometry(0.1, 6, 6);
    const orbMat = new THREE.MeshBasicMaterial({
        color: 0x16a34a, transparent: true, opacity: 0.0,
        blending: THREE.AdditiveBlending, depthWrite: false
    });
    const orbs: THREE.Mesh[] = [];
    const orbAngles: number[] = [];
    for (let i = 0; i < ORB_COUNT; i++) {
        const o = new THREE.Mesh(orbGeo, orbMat);
        o.frustumCulled = false;
        scene.add(o);
        orbs.push(o);
        orbAngles.push((i / ORB_COUNT) * Math.PI * 2);
    }

    // ── Layer 3: Acid ground splat ring ──
    const ringGeo = pooledRing(0.5, 0.75, 28);
    const ringMat = getPooledMaterial({
        color: 0x22c55e,
        transparent: true, opacity: 0.0,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(tx, ty + 0.02, tz);
    ring.frustumCulled = false;
    scene.add(ring);

    // ── Layer 4: Toxic core flash sphere ──
    const coreGeo = new THREE.SphereGeometry(0.22, 8, 8);
    const coreMat = new THREE.MeshBasicMaterial({
        color: 0xbbf7d0, transparent: true, opacity: 0.0,
        blending: THREE.AdditiveBlending, depthWrite: false
    });
    const core = new THREE.Mesh(coreGeo, coreMat);
    core.position.set(tx, ty + 0.5, tz);
    core.frustumCulled = false;
    scene.add(core);

    let age = 0;
    const duration = 1.6;

    activeFX.push({
        update(delta) {
            age += delta;
            const t = Math.min(1.0, age / duration);
            const fade = 1.0 - t;

            // Intro burst
            const introT = Math.min(1.0, age / 0.18);
            const introFade = 1.0 - Math.min(1.0, age / 0.35);

            coreMat.opacity = introFade * 0.9;
            core.scale.setScalar(1.0 + introT * 3.0);

            // Puffs rise, spin, expand, fade
            const puffOpacity = Math.min(1.0, age / 0.2) * fade * 0.8;
            puffMatA.opacity = puffOpacity;
            puffMatB.opacity = puffOpacity * 0.65;
            for (let i = 0; i < PUFF_COUNT; i++) {
                puffs[i].position.addScaledVector(puffVels[i], delta);
                puffs[i].rotation.z += delta * (1.2 + i * 0.05);
                puffs[i].scale.setScalar(1.0 + t * 2.2);
            }

            // Acid ring expand + pulse
            ring.scale.setScalar(1.0 + t * 2.5);
            ringMat.opacity = Math.min(1.0, age / 0.15) * fade * 0.8 * (0.8 + Math.sin(age * 5.0) * 0.2);

            // Orbiting poison orbs spiral up
            const orbOpacity = Math.min(1.0, age / 0.25) * fade;
            orbMat.opacity = orbOpacity;
            for (let i = 0; i < ORB_COUNT; i++) {
                orbAngles[i] += 3.5 * delta;
                const r = 0.7 + Math.sin(age * 2.0 + i) * 0.2;
                orbs[i].position.set(
                    tx + Math.cos(orbAngles[i]) * r,
                    ty + 0.5 + age * 0.6 + i * 0.2,
                    tz + Math.sin(orbAngles[i]) * r
                );
                orbs[i].scale.setScalar(1.0 + Math.sin(age * 4.0 + i) * 0.3);
            }

            if (t >= 1.0) {
                puffs.forEach(p => scene.remove(p));
                releasePooledMaterial(puffMatA);
                releasePooledMaterial(puffMatB);

                orbs.forEach(o => scene.remove(o));
                orbGeo.dispose();
                orbMat.dispose();

                scene.remove(ring);
                releasePooledMaterial(ringMat);

                scene.remove(core);
                coreGeo.dispose();
                coreMat.dispose();
                return false;
            }
            return true;
        }
    });
}
