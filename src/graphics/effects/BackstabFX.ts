import * as THREE from "three";
import { spawnExplosion } from "./FXCore";

export function spawnBackstabFX(
    scene: THREE.Scene,
    fx: number,
    fy: number,
    fz: number,
    tx: number,
    ty: number,
    tz: number,
    team?: number,
) {
    spawnExplosion(scene, new THREE.Vector3(tx, ty, tz), 0xff3333, 8, 0.1);
}
