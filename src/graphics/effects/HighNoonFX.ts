import * as THREE from "three";
import { spawnExplosion } from "./FXCore";

export function spawnHighNoonFX(
    scene: THREE.Scene,
    fx: number,
    fy: number,
    fz: number,
    tx: number,
    ty: number,
    tz: number,
    team?: number,
) {
    const isBlue = team === 1;
    const color = isBlue ? 0x00ffff : 0xffff00;
    spawnExplosion(scene, new THREE.Vector3(tx, ty, tz), color, 15, 0.15);
}
