import * as THREE from "three";
import { camera } from "../core/scene";
import {
    easeOutCubic,
    easeOutQuad,
    pooledPlane,
    lightTex,
    activeFX,
    getPooledMaterial,
    releasePooledMaterial,
    _tempObj,
    spawnExplosion,
} from "./FXCore";

const texLoader = new THREE.TextureLoader();
const blueEmbersTex = texLoader.load('/vfx/cartoon-blue-flamethrower/tex_2.png');
const blueExplosionTex = texLoader.load('/vfx/cartoon-blue-gas-explosion/tex_3.png');

const _flipbookMatCache = new Map<string, THREE.ShaderMaterial>();
function getFlipbookMat(tex: THREE.Texture, uTiles: number, vTiles: number, colorOverride?: THREE.Color): THREE.ShaderMaterial {
    const key = `${tex.uuid}_${uTiles}_${vTiles}_${colorOverride?.getHexString() || 'fff'}`;
    if (!_flipbookMatCache.has(key)) {
        _flipbookMatCache.set(key, makeFlipbookMat(tex, uTiles, vTiles, colorOverride));
    }
    return _flipbookMatCache.get(key)!.clone();
}

function makeFlipbookMat(tex: THREE.Texture, uTiles: number, vTiles: number, colorOverride?: THREE.Color): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
        uniforms: {
            uMap: { value: tex },
            uTiles: { value: new THREE.Vector2(uTiles, vTiles) },
            uColor: { value: colorOverride || new THREE.Color(1, 1, 1) },
        },
        vertexShader: `
            attribute float aFrame;
            attribute float aOpacity;
            varying vec2 vUv;
            varying float vOpacity;
            uniform vec2 uTiles;
            void main() {
                float c = mod(aFrame, uTiles.x);
                float r = floor(aFrame / uTiles.x);
                vUv = vec2((c + uv.x) / uTiles.x, 1.0 - (r + 1.0 - uv.y) / uTiles.y);
                vOpacity = aOpacity;
                gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform sampler2D uMap;
            uniform vec3 uColor;
            varying vec2 vUv;
            varying float vOpacity;
            void main() {
                vec4 tex = texture2D(uMap, vUv);
                if (tex.a < 0.02) discard;
                gl_FragColor = vec4(tex.rgb * uColor, tex.a * vOpacity);
            }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
    });
}

export function spawnDoubleShotFX(
    scene: THREE.Scene,
    fx: number,
    fy: number,
    fz: number,
    tx: number,
    ty: number,
    tz: number,
    isTurret?: boolean,
    team?: number,
    scale = 1,
) {
    const start = new THREE.Vector3(fx, fy, fz);
    const end = new THREE.Vector3(tx, ty, tz);
    const isBlue = team === 1;

    if (isTurret) {
        // Sci-fi laser instant beam
        const flareGeo = pooledPlane(1.8, 1.8);
        const flareMat = new THREE.MeshBasicMaterial({
            map: lightTex,
            color: isBlue ? 0x00dfff : 0xffaa00,
            transparent: true,
            opacity: 1.0,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
        });
        const flareMesh = new THREE.Mesh(flareGeo, flareMat);
        flareMesh.position.copy(start);
        scene.add(flareMesh);

        const dir = new THREE.Vector3().subVectors(end, start);
        const dist = dir.length();
        const mid = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);

        const coreGeo = new THREE.CylinderGeometry(0.04, 0.04, dist, 6);
        const coreMat = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 1.0,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });
        const coreMesh = new THREE.Mesh(coreGeo, coreMat);

        const glowGeo = new THREE.CylinderGeometry(0.18, 0.18, dist, 6);
        const glowMat = new THREE.MeshBasicMaterial({
            color: isBlue ? 0x0044ff : 0xff3300,
            transparent: true,
            opacity: 0.8,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });
        const glowMesh = new THREE.Mesh(glowGeo, glowMat);

        const laserGroup = new THREE.Group();
        laserGroup.add(coreMesh);
        laserGroup.add(glowMesh);

        const up = new THREE.Vector3(0, 1, 0);
        const quat = new THREE.Quaternion().setFromUnitVectors(up, dir.clone().normalize());

        laserGroup.position.copy(mid);
        laserGroup.quaternion.copy(quat);
        scene.add(laserGroup);

        spawnExplosion(scene, end, isBlue ? 0x0088ff : 0xff7700, 36, 0.5);

        let age = 0;
        const duration = 0.16;
        activeFX.push({
            update(delta) {
                age += delta;
                const t = Math.min(1, age / duration);
                if (t >= 1) {
                    scene.remove(flareMesh);
                    scene.remove(laserGroup);
                    flareMat.dispose();
                    coreGeo.dispose();
                    coreMat.dispose();
                    glowGeo.dispose();
                    glowMat.dispose();
                    return false;
                }
                flareMesh.scale.setScalar(0.4 + t * 2.2);
                flareMesh.quaternion.copy(camera.quaternion);
                flareMat.opacity = 1.0 - easeOutCubic(t);

                coreMat.opacity = 1.0 - t;
                glowMat.opacity = 0.8 * (1.0 - t);
                return true;
            },
        });
    } else {
        // Regular Archer double shot (two moving projectiles)
        const shootArrow = (delay: number, isOffsetLeft: boolean) => {
            let age = -delay;
            const flight = 0.42;

            const projectileGeo = new THREE.SphereGeometry(0.2 * scale, 8, 8);
            const projectileMat = new THREE.MeshBasicMaterial({
                color: 0xffffff,
                transparent: true,
                opacity: 0.95,
                blending: THREE.AdditiveBlending,
            });
            const proj = new THREE.Mesh(projectileGeo, projectileMat);

            // Orbiting particle trail mesh (blueEmbersTex)
            const trailGeo = pooledPlane(0.35 * scale, 0.35 * scale);
            const trailMat = getPooledMaterial({
                map: blueEmbersTex,
                color: isBlue ? 0x00dfff : 0xffdd44,
                transparent: true,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                side: THREE.DoubleSide,
            });
            const TRAIL_LEN = 14;
            const trailMesh = new THREE.InstancedMesh(trailGeo, trailMat, TRAIL_LEN);
            trailMesh.frustumCulled = false;

            const hideM = new THREE.Matrix4().makeScale(0, 0, 0);
            for (let i = 0; i < TRAIL_LEN; i++) {
                trailMesh.setMatrixAt(i, hideM);
            }
            trailMesh.instanceMatrix.needsUpdate = true;

            const trailPosList: THREE.Vector3[] = Array.from({ length: TRAIL_LEN }, () => start.clone());

            // Cartoon impact flipbook
            const expGeo = new THREE.PlaneGeometry(1.8 * scale, 1.8 * scale);
            const expMat = getFlipbookMat(blueExplosionTex, 3, 3, isBlue ? new THREE.Color(1.0, 1.2, 1.5) : new THREE.Color(1.8, 1.3, 0.8));
            const expMesh = new THREE.InstancedMesh(expGeo, expMat, 1);
            const aFrame = new Float32Array(1);
            const aOpacity = new Float32Array(1);
            expMesh.geometry.setAttribute('aFrame', new THREE.InstancedBufferAttribute(aFrame, 1));
            expMesh.geometry.setAttribute('aOpacity', new THREE.InstancedBufferAttribute(aOpacity, 1));
            expMesh.setMatrixAt(0, hideM);
            aOpacity[0] = 0.0;

            let impactAge = -1;
            let addedToScene = false;

            activeFX.push({
                update(delta) {
                    age += delta;
                    if (age < 0) return true;

                    if (!addedToScene) {
                        addedToScene = true;
                        scene.add(proj);
                        scene.add(trailMesh);
                        scene.add(expMesh);
                        expMesh.instanceMatrix.needsUpdate = true;
                        (expMesh.geometry.getAttribute('aOpacity') as THREE.InstancedBufferAttribute).needsUpdate = true;
                        (expMesh.geometry.getAttribute('aFrame') as THREE.InstancedBufferAttribute).needsUpdate = true;
                    }

                    if (impactAge === -1) {
                        const t = Math.min(1, age / flight);
                        const linearPos = new THREE.Vector3().lerpVectors(start, end, easeOutQuad(t));

                        // Spiral calculations
                        const orbitSpd = 32.0;
                        // ponytail: tight spiral for visual accuracy — 0.15 not 0.4, looks like direct hit not miss
                        const radius = 0.15 * scale * (1.0 - t);
                        const angle = age * orbitSpd + (isOffsetLeft ? Math.PI : 0);
                        const spiralOffset = new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);

                        const dir = new THREE.Vector3().subVectors(end, start).normalize();
                        const up = new THREE.Vector3(0, 1, 0);
                        const quat = new THREE.Quaternion().setFromUnitVectors(up, dir);
                        spiralOffset.applyQuaternion(quat);

                        const finalPos = new THREE.Vector3().copy(linearPos).add(spiralOffset);
                        proj.position.copy(finalPos);

                        trailPosList.pop();
                        trailPosList.unshift(finalPos.clone());

                        const cq = camera.quaternion;
                        for (let i = 0; i < TRAIL_LEN; i++) {
                            _tempObj.position.copy(trailPosList[i]);
                            _tempObj.quaternion.copy(cq);
                            _tempObj.scale.setScalar((1.0 - (i / TRAIL_LEN)) * (1.0 - t) * 0.8);
                            _tempObj.updateMatrix();
                            trailMesh.setMatrixAt(i, _tempObj.matrix);
                        }
                        trailMesh.instanceMatrix.needsUpdate = true;

                        if (t >= 1) {
                            impactAge = age;
                            if (addedToScene) {
                                scene.remove(proj);
                                scene.remove(trailMesh);
                            }
                            projectileGeo.dispose();
                            projectileMat.dispose();
                            releasePooledMaterial(trailMat);
                            trailMesh.dispose();
                        }
                    } else {
                        // Impact cartoon explosion
                        const elapsed = age - impactAge;
                        const maxLife = 0.35;
                        const pct = Math.min(1, elapsed / maxLife);

                        if (pct < 1.0) {
                            _tempObj.position.copy(end);
                            _tempObj.quaternion.copy(camera.quaternion);
                            _tempObj.scale.setScalar((0.5 + pct * 1.5) * scale);
                            _tempObj.updateMatrix();
                            expMesh.setMatrixAt(0, _tempObj.matrix);

                            aFrame[0] = Math.min(8, Math.floor(pct * 9.0));
                            aOpacity[0] = 1.0 - pct;

                            expMesh.instanceMatrix.needsUpdate = true;
                            (expMesh.geometry.getAttribute('aFrame') as THREE.InstancedBufferAttribute).needsUpdate = true;
                            (expMesh.geometry.getAttribute('aOpacity') as THREE.InstancedBufferAttribute).needsUpdate = true;
                        } else {
                            if (addedToScene) {
                                scene.remove(expMesh);
                            }
                            expGeo.dispose();
                            expMat.dispose();
                            expMesh.dispose();
                            return false;
                        }
                    }
                    return true;
                },
            });
        };

        shootArrow(0, false);
        shootArrow(0.08, true);
    }
}
