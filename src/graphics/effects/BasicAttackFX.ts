import * as THREE from "three";
import { camera } from "../core/scene";
import {
    easeOutQuad,
    activeFX,
    canSpawnFX,
    getCamQuad,
    spawnExplosion,
} from "./FXCore";
import { soundFX } from "../core/SoundFX";

export function spawnBasicAttackFX(
    scene: THREE.Scene,
    uType: number,
    fx: number,
    fy: number,
    fz: number,
    tx: number,
    ty: number,
    tz: number,
    team?: number,
) {
    if (!canSpawnFX()) return;
    const start = new THREE.Vector3(fx, fy, fz);
    const end = new THREE.Vector3(tx, ty, tz);
    const isBlue = team === 1;

    if (uType === 0) {
        soundFX.playSlash(end.x, end.y, end.z, camera.position);
        spawnExplosion(scene, end, isBlue ? 0x00dfff : 0xffdd66, 6, 0.1);
    } else if (uType === 1) {
        soundFX.playBow(start.x, start.y, start.z, camera.position);
        let age = 0;
        const flight = 0.24;
        let mesh: THREE.Mesh | null = null;
        let mat: THREE.MeshBasicMaterial | null = null;

        activeFX.push({
            update(delta) {
                age += delta;
                if (!mesh) {
                    const geo = new THREE.CylinderGeometry(0.06, 0.06, 0.7, 5);
                    mat = new THREE.MeshBasicMaterial({
                        color: isBlue ? 0x88ccff : 0xffeaad,
                        transparent: true,
                        opacity: 0.8,
                        blending: THREE.AdditiveBlending,
                        depthWrite: false,
                    });
                    mesh = new THREE.Mesh(geo, mat);
                    mesh.frustumCulled = false;
                    mesh.position.copy(start);
                    mesh.lookAt(end);
                    mesh.rotateX(Math.PI / 2);
                    scene.add(mesh);
                }
                const t = Math.min(1, age / flight);
                if (t >= 1) {
                    scene.remove(mesh!);
                    mesh!.geometry.dispose();
                    mat!.dispose();
                    spawnExplosion(scene, end, isBlue ? 0x00aaff : 0xffbb44, 4, 0.1);
                    return false;
                }
                mesh!.position.lerpVectors(start, end, easeOutQuad(t));
                return true;
            },
        });
    } else if (uType === 2) {
        soundFX.playMagicCast(start.x, start.y, start.z, camera.position);
        let age = 0;
        const flight = 0.35;
        let mesh: THREE.Mesh | null = null;
        let mat: THREE.MeshBasicMaterial | null = null;

        activeFX.push({
            update(delta) {
                age += delta;
                if (!mesh) {
                    const geo = new THREE.SphereGeometry(0.15, 6, 6);
                    mat = new THREE.MeshBasicMaterial({
                        color: isBlue ? 0x00dfff : 0x88e0ff,
                        transparent: true,
                        opacity: 0.9,
                        blending: THREE.AdditiveBlending,
                        depthWrite: false,
                    });
                    mesh = new THREE.Mesh(geo, mat);
                    mesh.frustumCulled = false;
                    mesh.position.copy(start);
                    scene.add(mesh);
                }
                const t = Math.min(1, age / flight);
                if (t >= 1) {
                    scene.remove(mesh!);
                    mesh!.geometry.dispose();
                    mat!.dispose();
                    spawnExplosion(scene, end, isBlue ? 0x0088ff : 0x44ccff, 6, 0.1);
                    return false;
                }
                mesh!.position.lerpVectors(start, end, easeOutQuad(t));
                return true;
            },
        });
    } else if (uType === 4) {
        soundFX.playBow(start.x, start.y, start.z, camera.position);
        let age = 0;
        const flight = 0.15;
        let trail: THREE.Mesh | null = null;
        let trailMat: THREE.MeshBasicMaterial | null = null;

        activeFX.push({
            update(delta) {
                age += delta;
                if (!trail) {
                    const trailGeo = new THREE.CylinderGeometry(
                        0.04,
                        0.04,
                        1.0,
                        4,
                    );
                    trailMat = new THREE.MeshBasicMaterial({
                        color: isBlue ? 0x00dfff : 0xffcc44,
                        transparent: true,
                        opacity: 0.95,
                        blending: THREE.AdditiveBlending,
                        depthWrite: false,
                    });
                    trail = new THREE.Mesh(trailGeo, trailMat);
                    trail.frustumCulled = false;
                    trail.position.copy(start);
                    trail.lookAt(end);
                    trail.rotateX(Math.PI / 2);
                    scene.add(trail);
                }
                const t = Math.min(1, age / flight);
                if (t >= 1) {
                    scene.remove(trail!);
                    trail!.geometry.dispose();
                    trailMat!.dispose();
                    spawnExplosion(scene, end, isBlue ? 0x0088ff : 0xffaa22, 10, 0.12);
                    return false;
                }
                trail!.position.lerpVectors(start, end, easeOutQuad(t));
                return true;
            },
        });
    } else if (uType === 5) {
        soundFX.playSlash(end.x, end.y, end.z, camera.position);
        let age = 0;
        const slashLife = 0.15;
        const mid = new THREE.Vector3().lerpVectors(start, end, 0.5);
        mid.y += 0.3;

        activeFX.push({
            update(delta) {
                age += delta;
                const t = age / slashLife;
                if (t < 0.03) {
                    const arcGeo = new THREE.PlaneGeometry(1.4, 0.3);
                    const arcMat = new THREE.MeshBasicMaterial({
                        color: isBlue ? 0x00aaff : 0xff5533,
                        transparent: true,
                        opacity: 0.75,
                        blending: THREE.AdditiveBlending,
                        depthWrite: false,
                        side: THREE.DoubleSide,
                    });
                    const arcMesh = new THREE.Mesh(arcGeo, arcMat);
                    arcMesh.position.copy(mid);
                    arcMesh.quaternion.copy(getCamQuad());
                    arcMesh.frustumCulled = false;
                    scene.add(arcMesh);

                    let arcAge = 0;
                    activeFX.push({
                        update(d2) {
                            arcAge += d2;
                            const at = arcAge / 0.16;
                            if (at >= 1) {
                                scene.remove(arcMesh);
                                arcMesh.geometry.dispose();
                                arcMat.dispose();
                                return false;
                            }
                            arcMat.opacity = 0.75 * (1 - at);
                            arcMesh.scale.set(1 + at * 0.4, 1, 1);
                            return true;
                        },
                    });
                }
                if (t >= 1) {
                    spawnExplosion(scene, end, isBlue ? 0x0066ff : 0xff4422, 5, 0.08);
                    return false;
                }
                return true;
            },
        });
    }
}
