import * as THREE from "three";
import { camera } from "../core/scene";
import {
    pooledPlane,
    getPooledMaterial,
    releasePooledMaterial,
    smokeTex,
    activeFX,
    _tempObj,
    spawnExplosion,
} from "./FXCore";

export function spawnEvasiveLeapFX(
    scene: THREE.Scene,
    fx: number,
    fy: number,
    fz: number,
    tx: number,
    ty: number,
    tz: number,
) {
    // We spawn a smoke particle trail along the jump trajectory
    const start = new THREE.Vector3(fx, fy, fz);
    const end = new THREE.Vector3(tx, ty, tz);

    const trailGeo = pooledPlane(0.5, 0.5);
    const trailMat = getPooledMaterial({
        map: smokeTex,
        color: 0x88ccff,
        transparent: true,
        opacity: 0.5,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
    });
    const trailCount = 20;
    const trailMesh = new THREE.InstancedMesh(trailGeo, trailMat, trailCount);
    trailMesh.frustumCulled = false;
    scene.add(trailMesh);

    const trailOffsets: THREE.Vector3[] = [];
    for (let i = 0; i < trailCount; i++) {
        trailOffsets.push(new THREE.Vector3());
    }

    let age = 0;
    const duration = 0.65;
    activeFX.push({
        update(delta) {
            age += delta;
            const t = Math.min(1, age / duration);
            if (t >= 1) {
                scene.remove(trailMesh);
                releasePooledMaterial(trailMat);
                trailMesh.dispose();
                // Spawn impact explosion on ground landing
                spawnExplosion(scene, end, 0x00dfff, 15, 0.2);
                return false;
            }

            const cq = camera.quaternion;
            // Draw parabolic trail
            for (let i = 0; i < trailCount; i++) {
                const subT = Math.min(1, (i / trailCount) * t);
                const pos = new THREE.Vector3().lerpVectors(start, end, subT);
                
                // Add jump height peak
                const h = 4.0;
                pos.y += Math.sin(subT * Math.PI) * h;

                _tempObj.position.copy(pos);
                _tempObj.quaternion.copy(cq);
                _tempObj.scale.setScalar((1.0 - t) * (0.8 + i * 0.05));
                _tempObj.updateMatrix();
                trailMesh.setMatrixAt(i, _tempObj.matrix);
            }
            trailMesh.instanceMatrix.needsUpdate = true;
            trailMat.opacity = 0.6 * (1.0 - t);

            return true;
        },
    });
}
