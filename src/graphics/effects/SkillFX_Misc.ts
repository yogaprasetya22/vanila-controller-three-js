/**
 * SkillFX_Misc.ts — Misc effects: Basic Attack, Heal, High Noon, Smoke Bomb, Fan Fire, Shadow Step, Backstab, Poison Blade, Ice Shatter, Holy Sanctuary
 */

import * as THREE from "three";
import { camera } from "../core/scene";
import {
    easeOutCubic,
    easeOutQuad,
    pooledPlane,
    starTex,
    sparkTex,
    smokeTex,
    activeFX,
    canSpawnFX,
    fxQualityScale,
    _tempObj,
    getCamQuad,
    spawnExplosion,
    getPooledMaterial,
    releasePooledMaterial,
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
            projectileMat.opacity = 0.9 * (1 - t);
            return true;
        },
    });
}

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

export function spawnPoisonBladeFX(
    scene: THREE.Scene,
    tx: number,
    ty: number,
    tz: number,
) {
    spawnExplosion(scene, new THREE.Vector3(tx, ty, tz), 0x00dd00, 6, 0.12);
}

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

export function spawnHolySanctuaryFX(
    scene: THREE.Scene,
    centerPos: THREE.Vector3,
    team?: number,
) {
    const isBlue = team === 1;
    const colorRing = isBlue ? 0x00dfff : 0xffff00;
    const colorDome = isBlue ? 0xaae8ff : 0xffffaa;
    const colorSpark = isBlue ? 0x88ddff : 0xffdd66;

    // Glowing runic circle on the ground
    const ringGeo = new THREE.PlaneGeometry(3.5, 3.5);
    const ringMat = new THREE.ShaderMaterial({
        uniforms: {
            uTime: { value: 0 },
            uColor: { value: new THREE.Color(colorRing) },
            uOpacity: { value: 1.0 },
        },
        vertexShader: `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform vec3 uColor;
            uniform float uOpacity;
            uniform float uTime;
            varying vec2 vUv;
            void main() {
                vec2 uv = vUv - vec2(0.5);
                float dist = length(uv);
                if (dist > 0.5) discard;
                float r1 = smoothstep(0.015, 0.0, abs(dist - 0.44));
                float r2 = smoothstep(0.01, 0.0, abs(dist - 0.32));
                float rad = atan(uv.y, uv.x);
                float spokes = step(0.96, sin(rad * 8.0 - uTime * 3.0)) * r1;
                gl_FragColor = vec4(uColor * 2.0, (r1 + r2 + spokes) * uOpacity * (1.0 - dist * 1.8));
            }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(centerPos.x, centerPos.y + 0.02, centerPos.z);
    scene.add(ring);

    // Glowing Hemispherical Sanctuary Dome shell
    const domeGeo = new THREE.SphereGeometry(1.8, 24, 18, 0, Math.PI * 2, 0, Math.PI / 2);
    const domeMat = new THREE.ShaderMaterial({
        uniforms: {
            uTime: { value: 0 },
            uColor: { value: new THREE.Color(colorDome) },
            uOpacity: { value: 1.0 },
        },
        vertexShader: `
            varying vec3 vNormal;
            varying vec3 vViewPos;
            void main() {
                vNormal = normalize(normalMatrix * normal);
                vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                vViewPos = -mvPosition.xyz;
                gl_Position = projectionMatrix * mvPosition;
            }
        `,
        fragmentShader: `
            uniform vec3 uColor;
            uniform float uOpacity;
            uniform float uTime;
            varying vec3 vNormal;
            varying vec3 vViewPos;
            void main() {
                vec3 normal = normalize(vNormal);
                vec3 viewDir = normalize(vViewPos);
                
                // Fresnel glow
                float fresnel = pow(1.0 - max(0.0, dot(normal, viewDir)), 3.0);
                
                // Pulsing vertical stripe grid lines
                float stripes = sin(vViewPos.y * 8.0 - uTime * 4.0) * 0.15 + 0.85;

                gl_FragColor = vec4(uColor * 2.2, fresnel * stripes * uOpacity * 0.45);
            }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
    });
    const dome = new THREE.Mesh(domeGeo, domeMat);
    dome.position.copy(centerPos);
    scene.add(dome);

    // Star particles
    const starCount = 20;
    const starGeo = pooledPlane(0.35, 0.35);
    const starMat = getPooledMaterial({
        map: starTex,
        color: colorSpark,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
    });
    const starMesh = new THREE.InstancedMesh(starGeo, starMat, starCount);
    starMesh.frustumCulled = false;
    scene.add(starMesh);

    const starPositions: THREE.Vector3[] = [];
    const starVels: THREE.Vector3[] = [];
    const starScales: number[] = [];
    for (let i = 0; i < starCount; i++) {
        const angle = Math.random() * Math.PI * 2;
        const dist = Math.random() * 1.5;
        starPositions.push(new THREE.Vector3(
            centerPos.x + Math.cos(angle) * dist,
            centerPos.y + 0.1 + Math.random() * 0.5,
            centerPos.z + Math.sin(angle) * dist
        ));
        starVels.push(new THREE.Vector3(
            (Math.random() - 0.5) * 0.2,
            1.5 + Math.random() * 2.0,
            (Math.random() - 0.5) * 0.2
        ));
        starScales.push(0.6 + Math.random() * 0.6);
    }

    let age = 0;
    const duration = 2.0; // Stay for 2 seconds

    activeFX.push({
        update(delta) {
            age += delta;
            const t = Math.min(1, age / duration);

            if (t >= 1) {
                scene.remove(ring);
                scene.remove(dome);
                scene.remove(starMesh);
                ringGeo.dispose();
                ringMat.dispose();
                domeGeo.dispose();
                domeMat.dispose();
                releasePooledMaterial(starMat);
                starMesh.dispose();
                return false;
            }

            ringMat.uniforms.uTime.value = age;
            ringMat.uniforms.uOpacity.value = 1.0 - t;

            domeMat.uniforms.uTime.value = age;
            domeMat.uniforms.uOpacity.value = 1.0 - t;
            dome.scale.setScalar(1.0 + Math.sin(age * 3.0) * 0.02);

            const cq = camera.quaternion;
            const tempObj = new THREE.Object3D();
            for (let i = 0; i < starCount; i++) {
                const p = starPositions[i];
                p.addScaledVector(starVels[i], delta);

                tempObj.position.copy(p);
                tempObj.quaternion.copy(cq);
                tempObj.scale.setScalar(starScales[i] * Math.sin(t * Math.PI));
                tempObj.updateMatrix();
                starMesh.setMatrixAt(i, tempObj.matrix);
            }
            starMesh.instanceMatrix.needsUpdate = true;
            starMat.opacity = 0.9 * (1.0 - t);

            return true;
        },
    });
}

// ── Comic Pop Death Explosion (Procedural Flipbook Animation) ──

interface ActiveExplosion {
    sprite: THREE.Sprite;
    age: number;
    active: boolean;
}

const EXPLOSION_POOL_SIZE = 24;
const activeExplosions: ActiveExplosion[] = [];
let explosionTexture: THREE.CanvasTexture | null = null;

function createExplosionSpriteSheet(): THREE.CanvasTexture {
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 1024;
    const ctx = canvas.getContext("2d")!;

    const cols = 4;
    const rows = 4;
    const cellSize = 256;

    for (let frame = 0; frame < 16; frame++) {
        const col = frame % cols;
        const row = Math.floor(frame / cols);
        const x = col * cellSize + cellSize / 2;
        const y = row * cellSize + cellSize / 2;

        const progress = frame / 15; // 0 to 1

        ctx.save();
        ctx.translate(x, y);

        // Draw puff cloud (overlapping circles)
        if (progress > 0.0 && progress < 0.95) {
            const maxRadius = 80;
            const size = progress < 0.4 
                ? (progress / 0.4) * maxRadius 
                : (1.0 - (progress - 0.4) / 0.6) * maxRadius;

            ctx.fillStyle = "#ffffff";
            ctx.strokeStyle = "#1a1a1a";
            ctx.lineWidth = 10;

            ctx.beginPath();
            const numCircles = 6;
            for (let c = 0; c < numCircles; c++) {
                const angle = (c / numCircles) * Math.PI * 2;
                const dist = size * 0.45;
                const cx = Math.cos(angle) * dist;
                const cy = Math.sin(angle) * dist;
                const cr = size * 0.55;
                ctx.arc(cx, cy, cr, 0, Math.PI * 2);
            }
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            // Inner shading (light blue-ish)
            ctx.fillStyle = "#e6f7ff";
            ctx.beginPath();
            for (let c = 0; c < numCircles; c++) {
                const angle = (c / numCircles) * Math.PI * 2;
                const dist = size * 0.4;
                const cx = Math.cos(angle) * dist;
                const cy = Math.sin(angle) * dist;
                const cr = size * 0.45;
                ctx.arc(cx, cy, cr, 0, Math.PI * 2);
            }
            ctx.closePath();
            ctx.fill();
        }

        // Draw stars flying out
        if (progress > 0.1 && progress < 0.9) {
            const starProgress = (progress - 0.1) / 0.8;
            const dist = starProgress * 110;
            const starSize = starProgress < 0.5 ? 24 * (starProgress / 0.5) : 24 * (1.0 - (starProgress - 0.5) / 0.5);

            ctx.fillStyle = "#ffd700";
            ctx.strokeStyle = "#1a1a1a";
            ctx.lineWidth = 4;

            const numStars = 6;
            for (let s = 0; s < numStars; s++) {
                const angle = (s / numStars) * Math.PI * 2 + starProgress * 2.0;
                const sx = Math.cos(angle) * dist;
                const sy = Math.sin(angle) * dist;

                ctx.save();
                ctx.translate(sx, sy);
                ctx.rotate(angle);
                
                ctx.beginPath();
                for (let i = 0; i < 5; i++) {
                    ctx.lineTo(
                        Math.cos(((18 + i * 72) * Math.PI) / 180) * starSize,
                        Math.sin(((18 + i * 72) * Math.PI) / 180) * starSize
                    );
                    ctx.lineTo(
                        Math.cos(((54 + i * 72) * Math.PI) / 180) * (starSize * 0.4),
                        Math.sin(((54 + i * 72) * Math.PI) / 180) * (starSize * 0.4)
                    );
                }
                ctx.closePath();
                ctx.fill();
                ctx.stroke();
                ctx.restore();
            }
        }

        // Draw bold comic text "BANG!" in the center
        if (progress > 0.35 && progress < 0.75) {
            const textProgress = (progress - 0.35) / 0.4;
            const scaleText = textProgress < 0.2 
                ? (textProgress / 0.2) * 1.3 
                : 1.3 - (textProgress - 0.2) * 0.3;

            ctx.save();
            ctx.scale(scaleText, scaleText);

            ctx.font = "bold 42px 'Impact', sans-serif";
            const text = "BANG!";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";

            ctx.fillStyle = "#1a1a1a";
            ctx.fillText(text, 2, 6);

            ctx.strokeStyle = "#1a1a1a";
            ctx.lineWidth = 12;
            ctx.strokeText(text, 0, 0);

            ctx.fillStyle = "#ffff00";
            ctx.fillText(text, 0, 0);

            ctx.restore();
        }

        ctx.restore();
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.repeat.set(1 / cols, 1 / rows);
    return texture;
}

function initExplosionPool(scene: THREE.Scene) {
    if (explosionTexture) return;
    explosionTexture = createExplosionSpriteSheet();

    for (let i = 0; i < EXPLOSION_POOL_SIZE; i++) {
        const tex = explosionTexture.clone();
        tex.needsUpdate = true;

        const mat = new THREE.SpriteMaterial({
            map: tex,
            transparent: true,
            depthWrite: false,
        });

        const sprite = new THREE.Sprite(mat);
        sprite.scale.set(7.0, 7.0, 1.0);
        sprite.visible = false;
        sprite.renderOrder = 1000;
        scene.add(sprite);

        activeExplosions.push({
            sprite,
            age: 0,
            active: false,
        });
    }
}

export function spawnComicExplosion(scene: THREE.Scene, x: number, y: number, z: number) {
    initExplosionPool(scene);

    const exp = activeExplosions.find((e) => !e.active);
    if (!exp) return;

    exp.sprite.position.set(x, y, z);
    exp.sprite.visible = true;
    exp.age = 0;
    exp.active = true;

    const map = exp.sprite.material.map!;
    map.offset.set(0, 0.75);

    activeFX.push({
        update(delta) {
            exp.age += delta;
            const frameDelay = 0.028; // ~28ms per frame
            const frameIdx = Math.floor(exp.age / frameDelay);

            if (frameIdx >= 16) {
                exp.sprite.visible = false;
                exp.active = false;
                return false;
            }

            const col = frameIdx % 4;
            const row = Math.floor(frameIdx / 4);
            map.offset.x = col / 4;
            map.offset.y = 1.0 - (row + 1) / 4;
            return true;
        }
    });
}
