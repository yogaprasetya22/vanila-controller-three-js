import * as THREE from "three";
import { activeFX, pooledRing, getPooledMaterial, releasePooledMaterial } from "./FXCore";
import { spawnLightningFX } from "./LightningFX";

export function spawnThunderClapFX(
    scene: THREE.Scene,
    x: number,
    y: number,
    z: number,
    team?: number
) {
    const isBlue = team === 1;
    const shockColor = isBlue ? 0x44ddff : 0xffee00;
    const coreColor  = isBlue ? 0xffffff : 0xffffa0;

    // ── Bright central flash sphere ──
    const flashGeo = new THREE.SphereGeometry(0.35, 8, 8);
    const flashMat = new THREE.MeshBasicMaterial({
        color: coreColor,
        transparent: true,
        opacity: 1.0,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });
    const flash = new THREE.Mesh(flashGeo, flashMat);
    flash.position.set(x, y + 1.0, z);
    flash.frustumCulled = false;
    scene.add(flash);

    // ── Concentric shockwave rings (4 total) ──
    const RING_COUNT = 4;
    const rings: THREE.Mesh[] = [];
    const ringMats: THREE.MeshBasicMaterial[] = [];

    for (let i = 0; i < RING_COUNT; i++) {
        const inner = 0.1;
        const outer = 0.3 + i * 0.15;
        const rGeo = pooledRing(inner, outer, 48);
        const rMat = getPooledMaterial({
            color: shockColor,
            transparent: true,
            opacity: 0.9,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide
        });
        const ring = new THREE.Mesh(rGeo, rMat);
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(x, y + 0.05 + i * 0.02, z);
        ring.frustumCulled = false;
        scene.add(ring);
        rings.push(ring);
        ringMats.push(rMat);
    }

    // ── 8 lightning bolts radiate outward ──
    const BOLT_COUNT = 8;
    for (let i = 0; i < BOLT_COUNT; i++) {
        const angle = (i / BOLT_COUNT) * Math.PI * 2;
        const r = 2.5 + Math.random() * 2.5;
        const from = new THREE.Vector3(x, y + 1.0, z);
        const to   = new THREE.Vector3(x + Math.cos(angle) * r, y + 0.3 + Math.random(), z + Math.sin(angle) * r);
        spawnLightningFX(scene, [from, to], team);
    }

    // ── Ground pulse: tight bright disk ──
    const diskGeo = new THREE.CircleGeometry(0.7, 24);
    const diskMat = getPooledMaterial({
        color: shockColor,
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide
    });
    const disk = new THREE.Mesh(diskGeo, diskMat);
    disk.rotation.x = -Math.PI / 2;
    disk.position.set(x, y + 0.02, z);
    disk.frustumCulled = false;
    scene.add(disk);

    let age = 0;
    const duration = 0.7;

    activeFX.push({
        update(delta) {
            age += delta;
            const t = Math.min(1.0, age / duration);
            const fade = 1.0 - t;

            // Central flash burst then collapse
            const flashT = Math.min(1.0, age / 0.12);
            flash.scale.setScalar(1.0 + flashT * 4.0);
            flashMat.opacity = (1.0 - flashT) * 1.0;

            // Rings expand rapidly outward
            for (let i = 0; i < RING_COUNT; i++) {
                const delay = i * 0.04;
                const rt = Math.max(0, Math.min(1, (age - delay) / (duration - delay)));
                rings[i].scale.setScalar(1.0 + rt * 5.5);
                ringMats[i].opacity = 0.9 * (1.0 - rt * 0.95);
            }

            // Ground disk fades and expands
            disk.scale.setScalar(1.0 + t * 2.5);
            diskMat.opacity = 0.85 * fade * fade;

            if (t >= 1.0) {
                scene.remove(flash);
                flashGeo.dispose();
                flashMat.dispose();
                rings.forEach((r, i) => { scene.remove(r); releasePooledMaterial(ringMats[i]); });
                scene.remove(disk);
                diskGeo.dispose();
                releasePooledMaterial(diskMat);
                return false;
            }
            return true;
        }
    });
}
