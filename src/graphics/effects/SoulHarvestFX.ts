import * as THREE from "three";
import { activeFX, getPooledMaterial, releasePooledMaterial, pooledRing, easeOutQuad } from "./FXCore";

export function spawnSoulHarvestFX(
    scene: THREE.Scene,
    x: number,
    y: number,
    z: number,
    team?: number
) {
    // Deep necromancer/dark purple soul drain tendrils
    const tendrils: THREE.Line[] = [];
    const tendrilMats: THREE.LineBasicMaterial[] = [];
    const TENDRIL_COUNT = 12;
    const DURATION = 2.5;

    // Pre-compute each tendril path as sinuous "tentacle" rising from ground
    const tendrilPaths: THREE.Vector3[][] = [];
    for (let i = 0; i < TENDRIL_COUNT; i++) {
        const angle = (i / TENDRIL_COUNT) * Math.PI * 2 + Math.random() * 0.3;
        const baseRadius = 1.5 + Math.random() * 1.5;
        const pts: THREE.Vector3[] = [];
        const segments = 10;
        for (let s = 0; s <= segments; s++) {
            const progress = s / segments;
            const waveX = Math.sin(progress * Math.PI * 2 + angle) * 0.25 * progress;
            const waveZ = Math.cos(progress * Math.PI * 2.5 + angle) * 0.2 * progress;
            pts.push(new THREE.Vector3(
                x + Math.cos(angle) * baseRadius * (1.0 - progress * 0.6) + waveX,
                y + progress * 4.5,
                z + Math.sin(angle) * baseRadius * (1.0 - progress * 0.6) + waveZ
            ));
        }
        tendrilPaths.push(pts);
    }

    for (let i = 0; i < TENDRIL_COUNT; i++) {
        const mat = new THREE.LineBasicMaterial({
            color: i % 3 === 0 ? 0xc084fc : i % 3 === 1 ? 0x7c3aed : 0x9333ea,
            transparent: true,
            opacity: 0.0,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });
        const geo = new THREE.BufferGeometry().setFromPoints(tendrilPaths[i]);
        const line = new THREE.Line(geo, mat);
        line.frustumCulled = false;
        scene.add(line);
        tendrils.push(line);
        tendrilMats.push(mat);
    }

    // ── Converging soul collection point at top ──
    const soulGeo = new THREE.SphereGeometry(0.25, 8, 8);
    const soulMat = new THREE.MeshBasicMaterial({
        color: 0xf0abfc, // bright fuchsia soul core
        transparent: true,
        opacity: 0.0,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });
    const soul = new THREE.Mesh(soulGeo, soulMat);
    soul.position.set(x, y + 5.0, z);
    soul.frustumCulled = false;
    scene.add(soul);

    // ── Swirling ground rune ring ──
    const runeGeo = pooledRing(1.8, 2.1, 32);
    const runeMat = getPooledMaterial({
        color: 0x6d28d9,
        transparent: true,
        opacity: 0.0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide
    });
    const runeRing = new THREE.Mesh(runeGeo, runeMat);
    runeRing.rotation.x = -Math.PI / 2;
    runeRing.position.set(x, y + 0.03, z);
    scene.add(runeRing);

    let age = 0;
    const risePhase = 0.3;   // tendril grow-in phase
    const holdPhase = 1.5;   // active drain phase
    const fadePhase = 2.5;

    activeFX.push({
        update(delta) {
            age += delta;
            const t = Math.min(1.0, age / DURATION);

            // Phase 1: rise in
            const riseT = Math.min(1.0, age / risePhase);
            // Phase 2: hold active
            const holdT = Math.max(0, Math.min(1, (age - risePhase) / (holdPhase - risePhase)));
            // Phase 3: fade out
            const fadeT = Math.max(0, Math.min(1, (age - holdPhase) / (fadePhase - holdPhase)));
            const activeFade = riseT * (1.0 - fadeT);

            // Tendrils flicker and pulse
            for (let i = 0; i < TENDRIL_COUNT; i++) {
                const phaseOffset = i * 0.08;
                const flicker = 0.7 + Math.sin(age * 8.0 + i * 1.5) * 0.3;
                tendrilMats[i].opacity = activeFade * flicker * 0.85;
            }

            // Rune ring spins and pulses
            runeRing.rotation.z -= delta * 2.0;
            runeMat.opacity = activeFade * 0.75;
            runeRing.scale.setScalar(1.0 + Math.sin(age * 3.0) * 0.08);

            // Soul orb pulses at top
            soulMat.opacity = activeFade * (0.8 + Math.sin(age * 6.0) * 0.2);
            soul.scale.setScalar(1.0 + Math.sin(age * 5.0) * 0.3);

            if (t >= 1.0) {
                tendrils.forEach((line, i) => {
                    scene.remove(line);
                    (line.geometry as THREE.BufferGeometry).dispose();
                    tendrilMats[i].dispose();
                });
                scene.remove(soul);
                soulGeo.dispose();
                soulMat.dispose();
                scene.remove(runeRing);
                releasePooledMaterial(runeMat);
                return false;
            }
            return true;
        }
    });
}
