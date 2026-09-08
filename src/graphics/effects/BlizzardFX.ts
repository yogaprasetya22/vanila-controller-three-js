import * as THREE from "three";
import { activeFX, getPooledMaterial, releasePooledMaterial, pooledRing, easeOutQuad, alignGroundDecal } from "./FXCore";

export function spawnBlizzardFX(
    scene: THREE.Scene,
    x: number,
    y: number,
    z: number,
    team?: number
) {
    // Blizzard: rotating snowflake ring + hundreds of falling ice particle crystals

    const ICE_COUNT = 50;  // light-weight count
    const RADIUS = 4.0;
    const DURATION = 2.8;

    // ── Ice shard crystals falling in a spiral column ──
    const iceGeo = new THREE.OctahedronGeometry(0.09, 0);
    const iceMat = new THREE.MeshBasicMaterial({
        color: 0x93c5fd, // ice blue
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });

    const crystals: THREE.Mesh[] = [];
    const cPositions: THREE.Vector3[] = [];
    const cVelocities: THREE.Vector3[] = [];
    const cAngles: number[] = [];

    for (let i = 0; i < ICE_COUNT; i++) {
        const mesh = new THREE.Mesh(iceGeo, iceMat);
        const angle = Math.random() * Math.PI * 2;
        const r = Math.random() * RADIUS;
        const startY = y + 1.0 + Math.random() * 6.0; // varying heights for stagger
        const pos = new THREE.Vector3(
            x + Math.cos(angle) * r,
            startY,
            z + Math.sin(angle) * r
        );
        mesh.position.copy(pos);
        mesh.frustumCulled = false;
        scene.add(mesh);
        crystals.push(mesh);
        cPositions.push(pos);
        cAngles.push(angle);

        // Spiral inward while falling + slow angular drift
        cVelocities.push(new THREE.Vector3(
            (Math.random() - 0.5) * 1.5,
            -(1.5 + Math.random() * 1.5), // fall
            (Math.random() - 0.5) * 1.5
        ));
    }

    // ── Two rotating ice rings at different heights ──
    const lowerRingGeo = pooledRing(RADIUS - 0.2, RADIUS, 36);
    const lowerRingMat = getPooledMaterial({
        color: 0xbae6fd, // pale ice
        transparent: true,
        opacity: 0.75,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide
    });
    const lowerRing = new THREE.Mesh(lowerRingGeo, lowerRingMat);
    alignGroundDecal(lowerRing, x, z, 0.08);
    lowerRing.frustumCulled = false;
    scene.add(lowerRing);

    const upperRingGeo = pooledRing(RADIUS * 0.5 - 0.15, RADIUS * 0.5, 28);
    const upperRingMat = getPooledMaterial({
        color: 0xe0f2fe,
        transparent: true,
        opacity: 0.65,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide
    });
    const upperRing = new THREE.Mesh(upperRingGeo, upperRingMat);
    upperRing.rotation.x = -Math.PI / 2;
    upperRing.position.set(x, y + 3.5, z);
    upperRing.frustumCulled = false;
    scene.add(upperRing);

    // ── Central cryo column (vertical cylinder) ──
    const columnGeo = new THREE.CylinderGeometry(0.15, 0.6, 6.0, 10, 1, true);
    const columnMat = new THREE.MeshBasicMaterial({
        color: 0xdbeafe,
        transparent: true,
        opacity: 0.25,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide
    });
    const column = new THREE.Mesh(columnGeo, columnMat);
    column.position.set(x, y + 3.0, z);
    column.frustumCulled = false;
    scene.add(column);

    let age = 0;

    activeFX.push({
        update(delta) {
            age += delta;
            const t = Math.min(1.0, age / DURATION);
            const fade = 1.0 - t * t;

            // Rotate rings
            lowerRing.rotation.z -= delta * 1.2;
            upperRing.rotation.z += delta * 2.0;
            lowerRingMat.opacity = 0.75 * fade;
            upperRingMat.opacity = 0.65 * fade;

            // Column pulse
            columnMat.opacity = 0.25 * fade * (0.8 + Math.sin(age * 4.0) * 0.2);
            column.rotation.y += delta * 0.5;

            // Ice crystals fall and spin
            for (let i = 0; i < ICE_COUNT; i++) {
                cVelocities[i].y -= 2.0 * delta; // gravity
                // Slow inward spiral
                cAngles[i] += 0.8 * delta;
                const r = RADIUS * (1.0 - t * 0.4) * (0.2 + 0.8 * (i / ICE_COUNT));
                cPositions[i].x = x + Math.cos(cAngles[i] + i) * r + cVelocities[i].x * delta;
                cPositions[i].z = z + Math.sin(cAngles[i] + i) * r + cVelocities[i].z * delta;
                cPositions[i].y += cVelocities[i].y * delta;
                crystals[i].position.copy(cPositions[i]);
                crystals[i].rotation.x += delta * 3.0;
                crystals[i].rotation.z += delta * 2.5;

                // Re-loop crystals that hit the ground
                if (cPositions[i].y < y - 0.2) {
                    cPositions[i].set(
                        x + (Math.random() - 0.5) * RADIUS * 2,
                        y + 5.0 + Math.random() * 2.0,
                        z + (Math.random() - 0.5) * RADIUS * 2
                    );
                    cVelocities[i].y = -(1.5 + Math.random() * 1.5);
                }
            }
            iceMat.opacity = 0.85 * fade;

            if (t >= 1.0) {
                crystals.forEach(c => scene.remove(c));
                iceGeo.dispose();
                iceMat.dispose();

                scene.remove(lowerRing);
                releasePooledMaterial(lowerRingMat);
                scene.remove(upperRing);
                releasePooledMaterial(upperRingMat);

                scene.remove(column);
                columnGeo.dispose();
                columnMat.dispose();
                return false;
            }
            return true;
        }
    });
}
