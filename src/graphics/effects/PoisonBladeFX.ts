import * as THREE from "three";
import { spawnExplosion } from "./FXCore";

export function spawnPoisonBladeFX(
    scene: THREE.Scene,
    tx: number,
    ty: number,
    tz: number,
) {
    spawnExplosion(scene, new THREE.Vector3(tx, ty, tz), 0x00dd00, 6, 0.12);
}
