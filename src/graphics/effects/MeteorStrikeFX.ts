import * as THREE from "three";
import { activeFX, pooledRing, spawnExplosion, getPooledMaterial, releasePooledMaterial } from "./FXCore";
import { spawnLightningFX } from "./LightningFX";

export function spawnMeteorStrikeFX(
    scene: THREE.Scene,
    x: number,
    y: number,
    z: number,
    team?: number
) {
    const isBlue = team === 1;
    const meteorColor = isBlue ? 0x0088ff : 0xff5500;
    const craterColor = isBlue ? 0x00ccff : 0xff3300;

    // ── Falling meteor rock: sphere + glowing trail ──
    const meteorGeo = new THREE.SphereGeometry(0.55, 8, 8);
    const meteorMat = new THREE.MeshBasicMaterial({
        color: meteorColor,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });
    const meteor = new THREE.Mesh(meteorGeo, meteorMat);

    // Drop from high above, offset XZ slightly for drama
    const dropX = x + (Math.random() - 0.5) * 1.5;
    const dropZ = z + (Math.random() - 0.5) * 1.5;
    meteor.position.set(dropX, y + 18, dropZ);
    meteor.frustumCulled = false;
    scene.add(meteor);

    // ── Three-ring crater shockwave rings ──
    const rings: THREE.Mesh[] = [];
    const ringMats: THREE.MeshBasicMaterial[] = [];
    const ringScales = [0.8, 1.8, 3.5]; // staggered ring radii
    const ringDelays = [0.35, 0.38, 0.42]; // all detonate close together

    for (let i = 0; i < 3; i++) {
        const rGeo = pooledRing(ringScales[i] * 0.85, ringScales[i], 40);
        const rMat = getPooledMaterial({
            color: craterColor,
            transparent: true,
            opacity: 0.0,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide
        });
        const ring = new THREE.Mesh(rGeo, rMat);
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(x, y + 0.03, z);
        ring.frustumCulled = false;
        scene.add(ring);
        rings.push(ring);
        ringMats.push(rMat);
    }

    // ── Char scar ground decal ──
    const scarGeo = new THREE.CircleGeometry(2.5, 20);
    const scarMat = new THREE.MeshBasicMaterial({
        color: 0x111111,
        transparent: true,
        opacity: 0.0,
        depthWrite: false,
        side: THREE.DoubleSide
    });
    const scar = new THREE.Mesh(scarGeo, scarMat);
    scar.rotation.x = -Math.PI / 2;
    scar.position.set(x, y + 0.01, z);
    scene.add(scar);

    let age = 0;
    const impactAt = 0.35;
    const totalDuration = 2.0;
    let impactFired = false;

    activeFX.push({
        update(delta) {
            age += delta;

            if (age < impactAt) {
                // Falling phase - accelerate downward
                const fallT = age / impactAt;
                meteor.position.y = (y + 18) - fallT * fallT * 18;
                meteor.position.x = dropX;
                meteor.position.z = dropZ;
                // Glow intensifies as it falls
                meteorMat.opacity = 0.6 + fallT * 0.4;
                return true;
            }

            // Impact moment
            if (!impactFired) {
                impactFired = true;
                scene.remove(meteor);
                meteorGeo.dispose();
                meteorMat.dispose();

                spawnExplosion(scene, new THREE.Vector3(x, y + 0.5, z), craterColor, 25, 0.6);
                scarMat.opacity = 0.7;

                // Spawn lightning arcs radiating from impact
                const arcs = 5;
                for (let i = 0; i < arcs; i++) {
                    const angle = (i / arcs) * Math.PI * 2;
                    const r = 1.5 + Math.random() * 2.0;
                    const ep = new THREE.Vector3(x + Math.cos(angle) * r, y + 0.1, z + Math.sin(angle) * r);
                    const sp = new THREE.Vector3(x, y + 0.5, z);
                    spawnLightningFX(scene, [sp, ep], team);
                }
            }

            const postT = (age - impactAt) / (totalDuration - impactAt);
            const fade = 1.0 - Math.min(1, postT);

            // Animate rings expanding outward
            for (let i = 0; i < 3; i++) {
                const delay = ringDelays[i] - impactAt;
                const ringT = Math.min(1, Math.max(0, (age - ringDelays[i]) / 0.6));
                rings[i].scale.setScalar(1.0 + ringT * 2.0);
                ringMats[i].opacity = 0.9 * ringT * (1.0 - ringT * 0.8);
            }

            scarMat.opacity = 0.7 * fade;

            if (postT >= 1.0) {
                rings.forEach((r, i) => {
                    scene.remove(r);
                    releasePooledMaterial(ringMats[i]);
                });
                scene.remove(scar);
                scarGeo.dispose();
                scarMat.dispose();
                return false;
            }
            return true;
        }
    });
}
