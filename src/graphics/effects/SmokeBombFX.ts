import * as THREE from "three";
import { camera } from "../core/scene";
import {
    pooledPlane,
    smokeTex,
    activeFX,
    fxQualityScale,
    getCamQuad,
} from "./FXCore";

export function spawnSmokeBombFX(
    scene: THREE.Scene,
    x: number,
    y: number,
    z: number,
    team?: number,
) {
    const smokeGeo = pooledPlane(0.8, 0.8);
    const smokeMat = new THREE.MeshBasicMaterial({
        map: smokeTex,
        color: 0x555555,
        transparent: true,
        opacity: 0.6,
        depthWrite: false,
    });

    const SMOKE_COUNT = Math.round(16 * fxQualityScale());
    const positions: THREE.Vector3[] = [];
    const velocities: THREE.Vector3[] = [];

    for (let i = 0; i < SMOKE_COUNT; i++) {
        positions.push(new THREE.Vector3(x, y, z));
        const a = Math.random() * Math.PI * 2;
        const s = 1.5 + Math.random() * 2;
        velocities.push(
            new THREE.Vector3(
                Math.cos(a) * s,
                0.5 + Math.random() * 1.5,
                Math.sin(a) * s,
            ),
        );
    }

    const meshes: THREE.Mesh[] = [];
    for (let i = 0; i < SMOKE_COUNT; i++) {
        const m = new THREE.Mesh(smokeGeo, smokeMat);
        m.position.copy(positions[i]);
        m.quaternion.copy(getCamQuad());
        m.scale.setScalar(0.5);
        scene.add(m);
        meshes.push(m);
    }

    let age = 0;
    const duration = 1.2;

    activeFX.push({
        update(delta) {
            age += delta;
            const t = Math.min(1, age / duration);

            if (t >= 1) {
                meshes.forEach((m) => {
                    scene.remove(m);
                    (m.material as THREE.MeshBasicMaterial).dispose();
                });
                smokeMat.dispose();
                return false;
            }

            for (let i = 0; i < SMOKE_COUNT; i++) {
                positions[i].addScaledVector(velocities[i], delta);
                velocities[i].y -= 1.5 * delta;

                meshes[i].position.copy(positions[i]);
                meshes[i].quaternion.copy(camera.quaternion);
                meshes[i].scale.addScalar(delta * 1.5);
                (meshes[i].material as THREE.MeshBasicMaterial).opacity =
                    0.6 * (1 - t);
            }

            return true;
        },
    });
}
