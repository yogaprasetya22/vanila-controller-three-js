import * as THREE from "three";
import { pooledPlane, activeFX } from "./FXCore";

export function spawnShadowStepFX(
    scene: THREE.Scene,
    fx: number,
    fy: number,
    fz: number,
    tx: number,
    ty: number,
    tz: number,
    team?: number,
) {
    const startPos = new THREE.Vector3(fx, fy, fz);
    const endPos = new THREE.Vector3(tx, ty, tz);

    const dashGeo = pooledPlane(0.6, 2.0);
    const dashMat = new THREE.MeshBasicMaterial({
        color: 0x330066,
        transparent: true,
        opacity: 0.8,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
    });

    const midPos = new THREE.Vector3()
        .copy(startPos)
        .add(endPos)
        .multiplyScalar(0.5);
    const dash = new THREE.Mesh(dashGeo, dashMat);
    dash.position.copy(midPos);
    dash.lookAt(endPos);
    dash.rotateX(Math.PI / 2);
    scene.add(dash);

    let age = 0;
    const duration = 0.4;

    activeFX.push({
        update(delta) {
            age += delta;
            const t = Math.min(1, age / duration);

            if (t >= 1) {
                scene.remove(dash);
                dashMat.dispose();
                return false;
            }

            dashMat.opacity = 0.8 * (1 - t);
            dash.scale.setScalar(1 + t * 0.5);
            return true;
        },
    });
}
