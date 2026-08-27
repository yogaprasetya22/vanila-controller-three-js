import * as THREE from "three";
import { activeFX, getPooledMaterial, releasePooledMaterial, pooledRing } from "./FXCore";
import { spawnLightningFX } from "./LightningFX";

// ponytail: inline all, no class — ceiling: impact particles could be pooled
export function spawnHighNoonFX(
    scene: THREE.Scene,
    fx: number, fy: number, fz: number,
    tx: number, ty: number, tz: number,
    team?: number
) {
    const bulletColor = team === 1 ? 0x22d3ee : 0xfbbf24; // cyan or amber gold
    const coreColor   = team === 1 ? 0xe0f7ff : 0xfef3c7; // near-white glow
    const trailColor  = team === 1 ? 0x67e8f9 : 0xfde68a;

    const start = new THREE.Vector3(fx, fy, fz);
    const end   = new THREE.Vector3(tx, ty, tz);
    const mid   = new THREE.Vector3().copy(start).add(end).multiplyScalar(0.5);
    const dist  = start.distanceTo(end);

    // ── Triple-layer laser beam (tight core + glow jacket + haze) ──
    const BEAM_LAYERS = [
        { r: 0.025, color: coreColor,   opacity: 1.0 },
        { r: 0.08,  color: bulletColor, opacity: 0.55 },
        { r: 0.22,  color: trailColor,  opacity: 0.20 },
    ];
    const beams: THREE.Mesh[] = [];
    const beamMats: THREE.MeshBasicMaterial[] = [];
    for (const cfg of BEAM_LAYERS) {
        const geo = new THREE.CylinderGeometry(cfg.r, cfg.r, dist, 6, 1);
        const mat = new THREE.MeshBasicMaterial({ color: cfg.color, transparent: true, opacity: cfg.opacity, blending: THREE.AdditiveBlending, depthWrite: false });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.copy(mid);
        mesh.lookAt(end); mesh.rotateX(Math.PI / 2);
        mesh.frustumCulled = false;
        scene.add(mesh);
        beams.push(mesh);
        beamMats.push(mat);
    }

    // ── Muzzle flash at source ──
    const muzzleGeo = pooledRing(0.0, 0.7, 20);
    const muzzleMat = getPooledMaterial({ color: coreColor, transparent: true, opacity: 1.0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const muzzle = new THREE.Mesh(muzzleGeo, muzzleMat);
    const dir = new THREE.Vector3().copy(end).sub(start).normalize();
    muzzle.position.copy(start).addScaledVector(dir, 0.1);
    muzzle.lookAt(end);
    muzzle.frustumCulled = false;
    scene.add(muzzle);

    // ── 3 concentric expanding impact rings at target ──
    const RING_COUNT = 3;
    const impactRings: THREE.Mesh[] = [];
    const impactRingMats: THREE.MeshBasicMaterial[] = [];
    const ringRadiiBase = [0.4, 0.8, 1.4];

    for (let i = 0; i < RING_COUNT; i++) {
        const rGeo = pooledRing(ringRadiiBase[i] * 0.85, ringRadiiBase[i], 24);
        const rMat = getPooledMaterial({ color: i === 0 ? coreColor : bulletColor, transparent: true, opacity: 1.0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
        const ring = new THREE.Mesh(rGeo, rMat);
        ring.position.copy(end).addScaledVector(dir, -0.05);
        ring.lookAt(start);
        ring.frustumCulled = false;
        scene.add(ring);
        impactRings.push(ring);
        impactRingMats.push(rMat);
    }

    // ── Lightning arc: gun → target ──
    spawnLightningFX(scene, [start.clone(), end.clone()], team);

    // ── 10 ricochet sparks at impact point ──
    const SPARK_COUNT = 10;
    const sparkGeo = new THREE.OctahedronGeometry(0.06, 0);
    const sparkMat = new THREE.MeshBasicMaterial({ color: coreColor, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    const sparks: THREE.Mesh[] = [];
    const sparkVels: THREE.Vector3[] = [];
    for (let i = 0; i < SPARK_COUNT; i++) {
        const m = new THREE.Mesh(sparkGeo, sparkMat);
        m.position.copy(end);
        m.frustumCulled = false;
        scene.add(m);
        sparks.push(m);
        const angle = (i / SPARK_COUNT) * Math.PI * 2;
        sparkVels.push(new THREE.Vector3(
            Math.cos(angle) * (2.5 + Math.random() * 3),
            1.5 + Math.random() * 3.0,
            Math.sin(angle) * (2.5 + Math.random() * 3)
        ));
    }

    let age = 0;
    const BEAM_DURATION = 0.1;  // beams disappear very fast (gun shot)
    const IMPACT_DURATION = 0.45;

    activeFX.push({
        update(delta) {
            age += delta;
            const t = Math.min(1.0, age / IMPACT_DURATION);
            const fade = 1.0 - t;

            // Beams flash then vanish
            const beamFade = Math.max(0, 1.0 - age / BEAM_DURATION);
            beams.forEach((b, i) => {
                beamMats[i].opacity = BEAM_LAYERS[i].opacity * beamFade;
                b.scale.set(beamFade, 1.0, beamFade);
            });

            // Muzzle flash quick burst
            const muzzleT = Math.min(1.0, age / 0.08);
            muzzle.scale.setScalar(1.0 + muzzleT * 3.0);
            muzzleMat.opacity = (1.0 - muzzleT) * 0.95;

            // Impact rings expand with stagger
            for (let i = 0; i < RING_COUNT; i++) {
                const delay = i * 0.04;
                const rt = Math.min(1.0, Math.max(0, (age - delay) / 0.35));
                impactRings[i].scale.setScalar(1.0 + rt * 2.2);
                impactRingMats[i].opacity = rt * (1.0 - rt * 0.95) * 1.8;
            }

            // Sparks gravity-fall
            sparkMat.opacity = 0.9 * fade * fade;
            for (let i = 0; i < SPARK_COUNT; i++) {
                sparkVels[i].y -= 12.0 * delta;
                sparks[i].position.addScaledVector(sparkVels[i], delta);
                sparks[i].rotation.x += delta * 8;
            }

            if (t >= 1.0) {
                beams.forEach((b, i) => { scene.remove(b); (b.geometry as THREE.CylinderGeometry).dispose(); beamMats[i].dispose(); });
                scene.remove(muzzle); releasePooledMaterial(muzzleMat);
                impactRings.forEach((r, i) => { scene.remove(r); releasePooledMaterial(impactRingMats[i]); });
                sparks.forEach(s => scene.remove(s)); sparkGeo.dispose(); sparkMat.dispose();
                return false;
            }
            return true;
        }
    });
}
