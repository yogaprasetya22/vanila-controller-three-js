import * as THREE from "three";
import { activeFX, getPooledMaterial, releasePooledMaterial, pooledRing, alignGroundDecal } from "./FXCore";

// ponytail: inline state — ceiling: could pool the shard geometries
export function spawnShadowStepFX(
    scene: THREE.Scene,
    fx: number, fy: number, fz: number,
    tx: number, ty: number, tz: number,
    team?: number
) {
    const trailColor = team === 1 ? 0x38bdf8 : 0x6d28d9;  // blue or deep violet
    const sparkColor = team === 1 ? 0x7dd3fc : 0xa78bfa;  // pale blue or pale purple
    const bloomColor = team === 1 ? 0xe0f2fe : 0xede9fe;  // glow bloom

    const start = new THREE.Vector3(fx, fy, fz);
    const end   = new THREE.Vector3(tx, ty, tz);
    const dir   = new THREE.Vector3().copy(end).sub(start).normalize();
    const dist  = start.distanceTo(end);

    // ── 3-Layer Ghost trail ribbons (3 widths, staggered opacity) ──
    const TRAIL_COUNT = 3;
    const trails: THREE.Mesh[] = [];
    const trailMats: THREE.MeshBasicMaterial[] = [];
    const trailWidths = [0.55, 1.1, 2.0];
    const trailOpacities = [0.9, 0.45, 0.18];
    const trailColors = [trailColor, sparkColor, bloomColor];

    for (let i = 0; i < TRAIL_COUNT; i++) {
        const geo = new THREE.PlaneGeometry(trailWidths[i], dist);
        const mat = new THREE.MeshBasicMaterial({
            color: trailColors[i],
            transparent: true,
            opacity: trailOpacities[i],
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide
        });
        const mesh = new THREE.Mesh(geo, mat);
        const mid = new THREE.Vector3().copy(start).add(end).multiplyScalar(0.5);
        mesh.position.copy(mid);
        mesh.lookAt(end);
        mesh.rotateX(Math.PI / 2);
        mesh.frustumCulled = false;
        scene.add(mesh);
        trails.push(mesh);
        trailMats.push(mat);
    }

    // ── Afterimage ghost ring at origin (disappear point) ──
    const srcRingGeo = pooledRing(0.2, 0.9, 24);
    const srcRingMat = getPooledMaterial({ color: trailColor, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const srcRing = new THREE.Mesh(srcRingGeo, srcRingMat);
    alignGroundDecal(srcRing, fx, fz, 0.04);
    srcRing.frustumCulled = false;
    scene.add(srcRing);

    // ── Arrival ring at destination ──
    const arrRingGeo = pooledRing(0.15, 1.2, 32);
    const arrRingMat = getPooledMaterial({ color: bloomColor, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const arrRing = new THREE.Mesh(arrRingGeo, arrRingMat);
    alignGroundDecal(arrRing, tx, tz, 0.04);
    arrRing.frustumCulled = false;
    scene.add(arrRing);

    // ── 18 shadow shard sparks along the path ──
    const SHARD_COUNT = 18;
    const shardGeo = new THREE.OctahedronGeometry(0.07, 0);
    const shardMat = new THREE.MeshBasicMaterial({ color: sparkColor, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
    const shards: THREE.Mesh[] = [];
    const shardPos: THREE.Vector3[] = [];
    const shardVel: THREE.Vector3[] = [];

    for (let i = 0; i < SHARD_COUNT; i++) {
        const m = new THREE.Mesh(shardGeo, shardMat);
        const t = Math.random();
        const lerpPt = new THREE.Vector3().copy(start).lerp(end, t);
        m.position.copy(lerpPt);
        m.frustumCulled = false;
        scene.add(m);
        shards.push(m);
        shardPos.push(m.position.clone());
        shardVel.push(new THREE.Vector3(
            dir.x * (6 + Math.random() * 4) + (Math.random() - 0.5) * 3,
            1.0 + Math.random() * 2.5,
            dir.z * (6 + Math.random() * 4) + (Math.random() - 0.5) * 3
        ));
    }

    // ── 3 speed-line segments along path axis ──
    const speedLines: THREE.Line[] = [];
    const speedLineMats: THREE.LineBasicMaterial[] = [];
    for (let i = 0; i < 3; i++) {
        const off = (i - 1) * 0.3; // lateral offset
        const perpX = dir.z * off;
        const perpZ = -dir.x * off;
        const pts = [
            new THREE.Vector3(fx + perpX, fy + 0.6, fz + perpZ),
            new THREE.Vector3(tx + perpX, ty + 0.6, tz + perpZ)
        ];
        const geo = new THREE.BufferGeometry().setFromPoints(pts);
        const mat = new THREE.LineBasicMaterial({ color: bloomColor, transparent: true, opacity: 0.6 - i * 0.15, blending: THREE.AdditiveBlending, depthWrite: false });
        const line = new THREE.Line(geo, mat);
        line.frustumCulled = false;
        scene.add(line);
        speedLines.push(line);
        speedLineMats.push(mat);
    }

    let age = 0;
    const duration = 0.45;

    activeFX.push({
        update(delta) {
            age += delta;
            const t = Math.min(1.0, age / duration);
            const fade = 1.0 - t;

            // Trails: core shrinks; blooms linger longer
            for (let i = 0; i < TRAIL_COUNT; i++) {
                trailMats[i].opacity = trailOpacities[i] * Math.pow(fade, 1.0 + i * 0.5);
                trails[i].scale.x = 1.0 - t * (0.4 + i * 0.2);
            }

            // Departure ring expands and fades
            srcRing.scale.setScalar(1.0 + t * 2.5);
            srcRingMat.opacity = 0.85 * fade * fade;

            // Arrival ring bursts in then fades
            const arrT = Math.min(1.0, age / 0.2);
            arrRing.scale.setScalar(1.0 + arrT * 2.8);
            arrRingMat.opacity = arrT * (1.0 - arrT) * 2.5;

            // Speed lines fade fast
            speedLineMats.forEach((m, i) => m.opacity = (0.6 - i * 0.15) * fade * fade);

            // Shards fly and fall
            shardMat.opacity = 0.95 * fade;
            for (let i = 0; i < SHARD_COUNT; i++) {
                shardVel[i].y -= 8.0 * delta;
                shardPos[i].addScaledVector(shardVel[i], delta);
                shards[i].position.copy(shardPos[i]);
                shards[i].rotation.x += delta * 5;
                shards[i].rotation.z += delta * 4;
            }

            if (t >= 1.0) {
                trails.forEach((m, i) => { scene.remove(m); (m.geometry as THREE.PlaneGeometry).dispose(); trailMats[i].dispose(); });
                scene.remove(srcRing); releasePooledMaterial(srcRingMat);
                scene.remove(arrRing); releasePooledMaterial(arrRingMat);
                shards.forEach(s => scene.remove(s)); shardGeo.dispose(); shardMat.dispose();
                speedLines.forEach((l, i) => { scene.remove(l); (l.geometry as THREE.BufferGeometry).dispose(); speedLineMats[i].dispose(); });
                return false;
            }
            return true;
        }
    });
}
