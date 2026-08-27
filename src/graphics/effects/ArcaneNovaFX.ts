import * as THREE from "three";
import { activeFX, getPooledMaterial, releasePooledMaterial, pooledRing, easeOutQuad } from "./FXCore";

export function spawnArcaneNovaFX(
    scene: THREE.Scene,
    x: number,
    y: number,
    z: number,
    team?: number
) {
    const isBlue = team === 1;
    const primaryColor = isBlue ? 0x8b5cf6 : 0xf59e0b;  // Arcane violet or arcane amber
    const secondaryColor = isBlue ? 0xc4b5fd : 0xfde68a; // Light lavender or pale gold

    // ── Core expanding orb ──
    const orbGeo = new THREE.SphereGeometry(0.4, 12, 12);
    const orbMat = new THREE.MeshBasicMaterial({
        color: secondaryColor,
        transparent: true,
        opacity: 1.0,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });
    const orb = new THREE.Mesh(orbGeo, orbMat);
    orb.position.set(x, y + 1.2, z);
    orb.frustumCulled = false;
    scene.add(orb);

    // ── 3 floating arcane crystal shards orbiting the core ──
    const SHARD_COUNT = 6;
    const shards: THREE.Mesh[] = [];
    const shardAngles: number[] = [];
    const shardHeights: number[] = [];
    const shardOrbitSpeeds: number[] = [];
    const shardOrbitRadii: number[] = [];
    const shardMats: THREE.MeshBasicMaterial[] = [];

    for (let i = 0; i < SHARD_COUNT; i++) {
        const angle = (i / SHARD_COUNT) * Math.PI * 2;
        const radius = 0.8 + (i % 3) * 0.4;
        const sGeo = new THREE.OctahedronGeometry(0.12 + Math.random() * 0.1, 0);
        const sMat = new THREE.MeshBasicMaterial({
            color: i % 2 === 0 ? primaryColor : secondaryColor,
            transparent: true,
            opacity: 0.9,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });
        const shard = new THREE.Mesh(sGeo, sMat);
        shard.position.set(x + Math.cos(angle) * radius, y + 1.2 + (Math.random() - 0.5) * 0.5, z + Math.sin(angle) * radius);
        shard.frustumCulled = false;
        scene.add(shard);
        shards.push(shard);
        shardAngles.push(angle);
        shardHeights.push(shard.position.y);
        shardOrbitSpeeds.push(3.0 + Math.random() * 2.0);
        shardOrbitRadii.push(radius);
        shardMats.push(sMat);
    }

    // ── Two-layer emission rings ──
    const outerRingGeo = pooledRing(2.0, 2.3, 48);
    const outerRingMat = getPooledMaterial({
        color: primaryColor,
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide
    });
    const outerRing = new THREE.Mesh(outerRingGeo, outerRingMat);
    outerRing.rotation.x = -Math.PI / 2;
    outerRing.position.set(x, y + 0.03, z);
    outerRing.frustumCulled = false;
    scene.add(outerRing);

    const innerRingGeo = pooledRing(0.8, 1.0, 32);
    const innerRingMat = getPooledMaterial({
        color: secondaryColor,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide
    });
    const innerRing = new THREE.Mesh(innerRingGeo, innerRingMat);
    innerRing.rotation.x = -Math.PI / 2;
    innerRing.position.set(x, y + 0.05, z);
    innerRing.frustumCulled = false;
    scene.add(innerRing);

    let age = 0;
    const duration = 1.8;

    activeFX.push({
        update(delta) {
            age += delta;
            const t = Math.min(1.0, age / duration);
            const fade = 1.0 - t;
            const eased = easeOutQuad(t);

            // Orb: expand and fade
            orb.scale.setScalar(1.0 + eased * 3.5);
            orbMat.opacity = (1.0 - eased) * 0.9;

            // Rings: spin and scale outward
            outerRing.rotation.z += delta * 0.8;
            outerRing.scale.setScalar(1.0 + eased * 1.4);
            outerRingMat.opacity = 0.85 * fade * fade;

            innerRing.rotation.z -= delta * 1.5;
            innerRing.scale.setScalar(1.0 + eased * 2.0);
            innerRingMat.opacity = 0.9 * fade;

            // Shards orbit and rise upward
            for (let i = 0; i < SHARD_COUNT; i++) {
                shardAngles[i] += shardOrbitSpeeds[i] * delta;
                const r = shardOrbitRadii[i] * (1.0 + eased * 0.8);
                shards[i].position.set(
                    x + Math.cos(shardAngles[i]) * r,
                    shardHeights[i] + age * 1.2,
                    z + Math.sin(shardAngles[i]) * r
                );
                shards[i].rotation.x += delta * 2.5;
                shards[i].rotation.y += delta * 3.0;
                shardMats[i].opacity = 0.9 * fade;
            }

            if (t >= 1.0) {
                scene.remove(orb);
                orbGeo.dispose();
                orbMat.dispose();

                shards.forEach((s, i) => { scene.remove(s); (s.geometry as THREE.OctahedronGeometry).dispose(); shardMats[i].dispose(); });

                scene.remove(outerRing);
                releasePooledMaterial(outerRingMat);
                scene.remove(innerRing);
                releasePooledMaterial(innerRingMat);
                return false;
            }
            return true;
        }
    });
}
