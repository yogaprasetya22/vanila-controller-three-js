import * as THREE from "three";
import { camera } from "../core/scene";
import { activeFX } from "./FXCore";
import { soundFX } from "../core/SoundFX";

export function spawnIceShatterFX(
    scene: THREE.Scene,
    x: number,
    y: number,
    z: number,
    team?: number,
) {
    soundFX.playIceShatter(x, y, z, camera.position);
    const isBlue = team === 1;
    const shardGeo = new THREE.ConeGeometry(0.12, 0.35, 4);
    const shardMat = new THREE.MeshStandardMaterial({
        color: isBlue ? 0xaae5ff : 0xffaa77,
        transparent: true,
        opacity: 0.85,
        roughness: 0.15,
        metalness: 0.1,
    });

    const SHARDS = 12;
    const meshes: THREE.Mesh[] = [];
    const vels: THREE.Vector3[] = [];
    const rotVels: THREE.Vector3[] = [];

    for (let i = 0; i < SHARDS; i++) {
        const mesh = new THREE.Mesh(shardGeo, shardMat);
        mesh.frustumCulled = false;
        mesh.position.set(
            x + (Math.random() - 0.5) * 0.4,
            y + (Math.random() - 0.5) * 0.4,
            z + (Math.random() - 0.5) * 0.4,
        );
        mesh.rotation.set(
            Math.random() * Math.PI,
            Math.random() * Math.PI,
            Math.random() * Math.PI,
        );
        const scale = 0.5 + Math.random() * 0.8;
        mesh.scale.set(scale, scale, scale);
        scene.add(mesh);
        meshes.push(mesh);

        const angle = Math.random() * Math.PI * 2;
        const speed = 1.0 + Math.random() * 2.0;
        vels.push(
            new THREE.Vector3(
                Math.cos(angle) * speed,
                2.0 + Math.random() * 2.5,
                Math.sin(angle) * speed,
            ),
        );
        rotVels.push(
            new THREE.Vector3(
                (Math.random() - 0.5) * 6,
                (Math.random() - 0.5) * 6,
                (Math.random() - 0.5) * 6,
            ),
        );
    }

    let age = 0;
    const duration = 0.6;

    activeFX.push({
        update(delta) {
            age += delta;
            const t = Math.min(1, age / duration);
            if (t >= 1) {
                meshes.forEach((mesh) => {
                    scene.remove(mesh);
                });
                shardGeo.dispose();
                shardMat.dispose();
                return false;
            }

            for (let i = 0; i < SHARDS; i++) {
                const mesh = meshes[i];
                const vel = vels[i];
                vel.y -= 9.8 * delta;
                mesh.position.addScaledVector(vel, delta);
                mesh.rotation.x += rotVels[i].x * delta;
                mesh.rotation.y += rotVels[i].y * delta;
                mesh.rotation.z += rotVels[i].z * delta;
                (mesh.material as THREE.MeshStandardMaterial).opacity =
                    0.85 * (1 - t);
            }
            return true;
        },
    });
}
