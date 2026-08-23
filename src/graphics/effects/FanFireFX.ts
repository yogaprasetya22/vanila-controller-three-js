import * as THREE from "three";
import { activeFX, _tempObj } from "./FXCore";

export function spawnFanFireFX(
    scene: THREE.Scene,
    x: number,
    z: number,
    groundY: number,
    radius: number,
    team?: number,
): void {
    const isBlue = team === 1;
    const color = isBlue ? 0x0088ff : 0xff8800;

    const COUNT = 40;
    const projectileGeo = new THREE.SphereGeometry(0.1, 4, 4);
    const projectileMat = new THREE.MeshBasicMaterial({
        color: color,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
    });

    const projectiles = new THREE.InstancedMesh(
        projectileGeo,
        projectileMat,
        COUNT,
    );
    projectiles.frustumCulled = false;
    scene.add(projectiles);

    const data: { angle: number; speed: number; age: number }[] = [];
    for (let k = 0; k < COUNT; k++) {
        const angle = (k / COUNT) * Math.PI * 2;
        data.push({ angle, speed: 3 + Math.random() * 2, age: 0 });
    }

    let age = 0;
    const duration = 1.0;

    activeFX.push({
        update(delta) {
            age += delta;
            const t = Math.min(1, age / duration);

            if (t >= 1) {
                scene.remove(projectiles);
                projectiles.dispose();
                projectileMat.dispose();
                return false;
            }

            for (let k = 0; k < COUNT; k++) {
                const d = data[k];
                const distance = d.speed * age;
                const px = x + Math.cos(d.angle) * distance;
                const py = groundY + 0.5;
                const pz = z + Math.sin(d.angle) * distance;

                _tempObj.position.set(px, py, pz);
                _tempObj.scale.setScalar(1 - t);
                _tempObj.updateMatrix();
                projectiles.setMatrixAt(k, _tempObj.matrix);
            }
            projectiles.instanceMatrix.needsUpdate = true;

            return true;
        },
    });
}
