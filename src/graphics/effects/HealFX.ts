import * as THREE from "three";
import { activeFX } from "./FXCore";

export function spawnHealFX(
    scene: THREE.Scene,
    start: THREE.Vector3,
    end: THREE.Vector3,
    isRejuvenation: boolean = false,
) {
    const color = isRejuvenation ? 0x00ff88 : 0x33ff66;

    const distance = start.distanceTo(end);
    const geo = new THREE.CylinderGeometry(0.06, 0.06, distance, 6);
    const mat = new THREE.MeshBasicMaterial({
        color: color,
        transparent: true,
        opacity: 0.75,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
    });

    const beam = new THREE.Mesh(geo, mat);
    beam.position.copy(start).add(end).multiplyScalar(0.5);
    beam.lookAt(end);
    beam.rotateX(Math.PI / 2);
    scene.add(beam);

    const sparkleCount = isRejuvenation ? 18 : 10;
    const sparkles: THREE.Mesh[] = [];

    const sGeo = new THREE.DodecahedronGeometry(0.08);
    const sMat = new THREE.MeshBasicMaterial({
        color: color,
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
    });

    for (let i = 0; i < sparkleCount; i++) {
        const sp = new THREE.Mesh(sGeo, sMat);
        sp.position.copy(end);
        scene.add(sp);
        sparkles.push(sp);
    }

    let age = 0;
    const duration = isRejuvenation ? 0.75 : 0.45;

    activeFX.push({
        update(delta) {
            age += delta;
            const t = Math.min(1.0, age / duration);

            mat.opacity = 0.75 * (1.0 - t);
            beam.scale.set(1.0 - t, 1.0, 1.0 - t);

            for (let i = 0; i < sparkles.length; i++) {
                const offsetTime = age + i * (duration / sparkleCount);
                const theta = offsetTime * 14.0;
                const radius = 0.5 * (1.0 - t * 0.7);
                const height = (offsetTime * 2.5) % 2.0;

                sparkles[i].position.set(
                    end.x + radius * Math.cos(theta),
                    end.y - 0.2 + height,
                    end.z + radius * Math.sin(theta),
                );
                sparkles[i].scale.setScalar((1.0 - t) * 0.9);
            }

            if (t >= 1.0) {
                scene.remove(beam);
                geo.dispose();
                mat.dispose();

                for (const sp of sparkles) {
                    scene.remove(sp);
                }
                sGeo.dispose();
                sMat.dispose();
                return false;
            }
            return true;
        },
    });
}
