import * as THREE from "three";
import { activeFX, getPooledMaterial, releasePooledMaterial, pooledRing } from "./FXCore";

// ponytail: all inline — ceiling: smoke puff geo could be pooled
export function spawnSmokeBombFX(
    scene: THREE.Scene,
    x: number,
    y: number,
    z: number,
    team?: number
) {
    const isBlue   = team === 1;
    // Dark deep noir smoke: near-black purple or deep navy
    const smokeA   = isBlue ? 0x1e3a8a : 0x1a0533; // deepest shadow
    const smokeB   = isBlue ? 0x312e81 : 0x2e1065; // mid shadow
    const rimColor = isBlue ? 0x818cf8 : 0x7c3aed; // bright rim light

    // ── 5 concentric ground rings deploying at staggered times ──
    const RING_COUNT = 5;
    const groundRings: THREE.Mesh[] = [];
    const groundRingMats: THREE.MeshBasicMaterial[] = [];
    const ringMaxR = [1.2, 2.0, 3.0, 4.2, 5.5];
    const ringDelayStart = [0.0, 0.08, 0.16, 0.24, 0.32];

    for (let i = 0; i < RING_COUNT; i++) {
        const r = ringMaxR[i];
        const rGeo = pooledRing(r * 0.88, r, 36);
        const rMat = getPooledMaterial({
            color: i % 2 === 0 ? rimColor : smokeB,
            transparent: true,
            opacity: 0.0,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide
        });
        const ring = new THREE.Mesh(rGeo, rMat);
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(x, y + 0.02 + i * 0.01, z);
        ring.frustumCulled = false;
        scene.add(ring);
        groundRings.push(ring);
        groundRingMats.push(rMat);
    }

    // ── 20 volumetric smoke puff domes rising ──
    const PUFF_COUNT = 20;
    const puffGeo = new THREE.SphereGeometry(0.6, 6, 5);
    const puffMatDark = new THREE.MeshBasicMaterial({ color: smokeA, transparent: true, opacity: 0.0, blending: THREE.NormalBlending, depthWrite: false });
    const puffMatMid  = new THREE.MeshBasicMaterial({ color: smokeB, transparent: true, opacity: 0.0, blending: THREE.NormalBlending, depthWrite: false });
    const puffMatRim  = new THREE.MeshBasicMaterial({ color: rimColor, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false });

    const puffs: THREE.Mesh[] = [];
    const puffVels: THREE.Vector3[] = [];
    const puffMats: THREE.MeshBasicMaterial[] = [];
    const puffSpin: number[] = [];

    for (let i = 0; i < PUFF_COUNT; i++) {
        const mat = i < 10 ? puffMatDark : i < 17 ? puffMatMid : puffMatRim;
        const mesh = new THREE.Mesh(puffGeo, mat);
        const angle = Math.random() * Math.PI * 2;
        const radius = Math.random() * 2.8;
        mesh.position.set(
            x + Math.cos(angle) * radius,
            y + 0.2 + Math.random() * 0.5,
            z + Math.sin(angle) * radius
        );
        const startScale = 0.6 + Math.random() * 0.6;
        mesh.scale.setScalar(startScale);
        mesh.frustumCulled = false;
        scene.add(mesh);
        puffs.push(mesh);
        puffMats.push(mat);
        puffSpin.push((Math.random() - 0.5) * 1.2);
        puffVels.push(new THREE.Vector3(
            (Math.random() - 0.5) * 1.2,
            0.8 + Math.random() * 2.0,
            (Math.random() - 0.5) * 1.2
        ));
    }

    // ── Bright inner flash core ──
    const coreGeo = new THREE.SphereGeometry(0.45, 8, 8);
    const coreMat = new THREE.MeshBasicMaterial({ color: rimColor, transparent: true, opacity: 1.0, blending: THREE.AdditiveBlending, depthWrite: false });
    const core = new THREE.Mesh(coreGeo, coreMat);
    core.position.set(x, y + 0.5, z);
    core.frustumCulled = false;
    scene.add(core);

    let age = 0;
    const duration = 2.0;

    activeFX.push({
        update(delta) {
            age += delta;
            const t = Math.min(1.0, age / duration);
            const fade = 1.0 - t;
            const eased = 1.0 - (1.0 - t) * (1.0 - t); // ease-in

            // Inner flash burst then vanish
            const flashT = Math.min(1.0, age / 0.15);
            coreMat.opacity = (1.0 - flashT) * 0.95;
            core.scale.setScalar(1.0 + flashT * 5.0);

            // Ground rings: expand and pulse
            for (let i = 0; i < RING_COUNT; i++) {
                const rt = Math.max(0, age - ringDelayStart[i]) / (duration - ringDelayStart[i]);
                const ringFade = 1.0 - Math.min(1.0, rt);
                const activePeak = Math.min(1.0, (age - ringDelayStart[i]) / 0.25); // quick ramp-up
                groundRingMats[i].opacity = activePeak * ringFade * (i % 2 === 0 ? 0.75 : 0.5);
                groundRings[i].scale.setScalar(1.0 + Math.min(1.0, rt) * 0.4 * (1.0 + i * 0.1));
            }

            // Smoke puffs rise, expand, fade
            const puffPeak = Math.min(1.0, age / 0.3);  // fade in
            const puffFade = fade * fade;
            puffMatDark.opacity = puffPeak * puffFade * 0.72;
            puffMatMid.opacity  = puffPeak * puffFade * 0.55;
            puffMatRim.opacity  = puffPeak * puffFade * 0.35;

            for (let i = 0; i < PUFF_COUNT; i++) {
                puffs[i].position.addScaledVector(puffVels[i], delta);
                puffs[i].rotation.y += puffSpin[i] * delta;
                puffs[i].scale.addScalar(delta * 1.8);
            }

            if (t >= 1.0) {
                scene.remove(core); coreGeo.dispose(); coreMat.dispose();

                groundRings.forEach((r, i) => { scene.remove(r); releasePooledMaterial(groundRingMats[i]); });

                puffs.forEach(p => scene.remove(p));
                puffGeo.dispose();
                puffMatDark.dispose();
                puffMatMid.dispose();
                puffMatRim.dispose();
                return false;
            }
            return true;
        }
    });
}
