import * as THREE from "three";
import { activeFX, getPooledMaterial, releasePooledMaterial, pooledRing, spawnExplosion } from "./FXCore";

// ponytail: multi-slash + blood burst + afterimage — no new abstractions, all inline
export function spawnBackstabFX(
    scene: THREE.Scene,
    fx: number, fy: number, fz: number,
    tx: number, ty: number, tz: number,
    team?: number
) {
    const slashColor  = team === 1 ? 0x38bdf8 : 0xff2244;
    const glowColor   = team === 1 ? 0x7dd3fc : 0xff6680;
    const bloomColor  = team === 1 ? 0xe0f2fe : 0xffe0e5;

    // ── 3 Slash arcs at offset angles for layered cut look ──
    const ARC_COUNT = 3;
    const arcs: THREE.Line[] = [];
    const arcMats: THREE.LineBasicMaterial[] = [];
    const arcOffsets = [-0.28, 0.0, 0.28]; // radial spread

    for (let a = 0; a < ARC_COUNT; a++) {
        const segments = 20;
        const pts: THREE.Vector3[] = [];
        const sweep = Math.PI * 0.85; // wide dramatic arc
        const r = 1.6 + a * 0.22;

        for (let i = 0; i <= segments; i++) {
            const t = i / segments;
            const theta = (t - 0.5) * sweep + arcOffsets[a];
            // arc lives vertically so it's visible from camera angle
            pts.push(new THREE.Vector3(
                tx + Math.sin(theta) * r,
                ty + 0.6 + Math.cos(theta) * r * 0.45 + a * 0.2,
                tz + Math.cos(theta) * r * 0.4
            ));
        }

        const geo = new THREE.BufferGeometry().setFromPoints(pts);
        const mat = new THREE.LineBasicMaterial({
            color: a === 1 ? bloomColor : a === 0 ? slashColor : glowColor,
            transparent: true,
            opacity: a === 1 ? 0.5 : 0.95,  // middle arc softer for bloom glow layer
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            linewidth: 1
        });
        const line = new THREE.Line(geo, mat);
        line.frustumCulled = false;
        scene.add(line);
        arcs.push(line);
        arcMats.push(mat);
    }

    // ── Bright radial burst at impact point ──
    spawnExplosion(scene, new THREE.Vector3(tx, ty + 0.8, tz), slashColor, 18, 0.22);

    // ── Impact flash ring ──
    const flashRingGeo = pooledRing(0.05, 0.9, 32);
    const flashRingMat = getPooledMaterial({
        color: bloomColor,
        transparent: true,
        opacity: 1.0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide
    });
    const flashRing = new THREE.Mesh(flashRingGeo, flashRingMat);
    // face camera: tilt 45° for dramatic look
    flashRing.rotation.x = -Math.PI * 0.35;
    flashRing.position.set(tx, ty + 0.9, tz);
    flashRing.frustumCulled = false;
    scene.add(flashRing);

    // ── 5 blood/energy splatter sparks flying outward ──
    const SPARK_COUNT = 7;
    const sparkMats: THREE.MeshBasicMaterial[] = [];
    const sparkMeshes: THREE.Mesh[] = [];
    const sparkVels: THREE.Vector3[] = [];
    const sparkGeo = new THREE.OctahedronGeometry(0.07, 0);
    for (let i = 0; i < SPARK_COUNT; i++) {
        const sMat = new THREE.MeshBasicMaterial({
            color: i % 2 === 0 ? slashColor : glowColor,
            transparent: true,
            opacity: 0.9,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });
        const mesh = new THREE.Mesh(sparkGeo, sMat);
        mesh.position.set(tx, ty + 0.8, tz);
        mesh.frustumCulled = false;
        scene.add(mesh);
        sparkMeshes.push(mesh);
        sparkMats.push(sMat);
        const angle = (i / SPARK_COUNT) * Math.PI * 2 + Math.random() * 0.5;
        sparkVels.push(new THREE.Vector3(
            Math.cos(angle) * (3.5 + Math.random() * 2.0),
            1.5 + Math.random() * 2.5,
            Math.sin(angle) * (3.5 + Math.random() * 2.0)
        ));
    }

    let age = 0;
    const duration = 0.55;

    activeFX.push({
        update(delta) {
            age += delta;
            const t = Math.min(1.0, age / duration);
            const fade = 1.0 - t;

            // Slash arcs: draw-in then fade
            const drawT = Math.min(1.0, age / 0.12); // fast draw-in
            for (let a = 0; a < ARC_COUNT; a++) {
                arcs[a].scale.setScalar(drawT);
                arcMats[a].opacity = (a === 1 ? 0.5 : 0.95) * fade;
            }

            // Flash ring expands and fades quickly
            const flashT = Math.min(1.0, age / 0.22);
            flashRing.scale.setScalar(1.0 + flashT * 2.2);
            flashRingMat.opacity = (1.0 - flashT) * 0.9;

            // Sparks fly and fall with gravity
            for (let i = 0; i < SPARK_COUNT; i++) {
                sparkVels[i].y -= 9.0 * delta; // gravity
                sparkMeshes[i].position.addScaledVector(sparkVels[i], delta);
                sparkMeshes[i].rotation.x += delta * 6;
                sparkMats[i].opacity = 0.9 * fade;
            }

            if (t >= 1.0) {
                arcs.forEach((l, i) => { scene.remove(l); (l.geometry as THREE.BufferGeometry).dispose(); arcMats[i].dispose(); });
                scene.remove(flashRing); releasePooledMaterial(flashRingMat);
                sparkMeshes.forEach((m, i) => { scene.remove(m); sparkMats[i].dispose(); });
                sparkGeo.dispose();
                return false;
            }
            return true;
        }
    });
}
