import * as THREE from "three";
import { camera } from "../core/scene";
import {
    easeOutQuad,
    pooledPlane,
    activeFX,
    getPooledMaterial,
    releasePooledMaterial,
    _tempObj,
} from "./FXCore";

const texLoader = new THREE.TextureLoader();
const blueFlameTex = texLoader.load('/vfx/cartoon-blue-flamethrower/tex_3.png');
const blueExplosionTex = texLoader.load('/vfx/cartoon-blue-gas-explosion/tex_3.png');

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

export function spawnFireballFX(
    scene: THREE.Scene,
    fx: number,
    fy: number,
    fz: number,
    tx: number,
    ty: number,
    tz: number,
    team?: number,
) {
    const dir = new THREE.Vector3(tx - fx, 0, tz - fz).normalize();
    if (dir.lengthSq() < 0.001) dir.set(1, 0, 1).normalize();
    const start = new THREE.Vector3(tx - dir.x * 4, fy + 9, tz - dir.z * 4);
    const end = new THREE.Vector3(tx, ty, tz);
    const isBlue = team === 1;

    // Glowing core sphere with custom noise wave
    const coreGeo = new THREE.SphereGeometry(0.55, 16, 16);
    const coreMat = new THREE.ShaderMaterial({
        uniforms: {
            uTime: { value: 0 },
            uColor: { value: new THREE.Color(isBlue ? 0x00f0ff : 0xffaa00) },
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
            uniform float uTime;
            varying vec2 vUv;
            void main() {
                float ripple = sin(vUv.x * 25.0 + uTime * 12.0) * cos(vUv.y * 25.0 - uTime * 12.0) * 0.2 + 0.8;
                gl_FragColor = vec4(uColor * 2.5 * ripple, 1.0);
            }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
    });
    const coreMesh = new THREE.Mesh(coreGeo, coreMat);
    scene.add(coreMesh);

    // Instanced blue flames & embers trailing behind
    const trailGeo = pooledPlane(0.7, 0.7);
    const trailMat = getPooledMaterial({
        map: blueFlameTex,
        color: isBlue ? 0x00dfff : 0xff7700,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
    });
    const trailCount = 35;
    const trailMesh = new THREE.InstancedMesh(trailGeo, trailMat, trailCount);
    trailMesh.frustumCulled = false;
    scene.add(trailMesh);

    const trailPositions: THREE.Vector3[] = [];
    const trailVels: THREE.Vector3[] = [];
    const trailAges: number[] = [];
    const hideM = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < trailCount; i++) {
        trailPositions.push(new THREE.Vector3().copy(start));
        trailVels.push(new THREE.Vector3((Math.random() - 0.5) * 2.0, (Math.random() - 0.5) * 2.0, (Math.random() - 0.5) * 2.0));
        trailAges.push(-1);
        trailMesh.setMatrixAt(i, hideM);
    }
    trailMesh.instanceMatrix.needsUpdate = true;

    // 3x3 flipbook explosion on impact (cartoon-blue-gas-explosion/tex_3.png)
    const expGeo = new THREE.PlaneGeometry(3.5, 3.5);
    const expMat = makeFlipbookMat(blueExplosionTex, 3, 3, isBlue ? new THREE.Color(1.5, 1.5, 2.0) : new THREE.Color(2.5, 1.8, 1.0));
    const expMesh = new THREE.InstancedMesh(expGeo, expMat, 1);
    const aFrame = new Float32Array(1);
    const aOpacity = new Float32Array(1);
    expMesh.geometry.setAttribute('aFrame', new THREE.InstancedBufferAttribute(aFrame, 1));
    expMesh.geometry.setAttribute('aOpacity', new THREE.InstancedBufferAttribute(aOpacity, 1));
    expMesh.setMatrixAt(0, hideM);
    aOpacity[0] = 0.0;
    scene.add(expMesh);
    expMesh.instanceMatrix.needsUpdate = true;
    (expMesh.geometry.getAttribute('aOpacity') as THREE.InstancedBufferAttribute).needsUpdate = true;
    (expMesh.geometry.getAttribute('aFrame') as THREE.InstancedBufferAttribute).needsUpdate = true;

    let age = 0;
    const flightDuration = 0.55;
    let impactAge = -1;

    activeFX.push({
        update(delta) {
            age += delta;
            coreMat.uniforms.uTime.value = age;

            if (impactAge === -1) {
                const t = Math.min(1, age / flightDuration);
                const currentPos = new THREE.Vector3().lerpVectors(start, end, easeOutQuad(t));
                coreMesh.position.copy(currentPos);

                // Update trails along flight path
                const cq = camera.quaternion;
                const step = Math.floor(t * trailCount);
                for (let i = 0; i < trailCount; i++) {
                    if (i <= step && trailAges[i] === -1) {
                        trailPositions[i].copy(currentPos);
                        trailAges[i] = age;
                    }
                    if (trailAges[i] !== -1) {
                        const elapsed = age - trailAges[i];
                        trailPositions[i].addScaledVector(trailVels[i], delta);
                        _tempObj.position.copy(trailPositions[i]);
                        _tempObj.quaternion.copy(cq);
                        _tempObj.scale.setScalar(Math.max(0.01, (1.0 - elapsed * 2.0) * 1.3));
                        _tempObj.updateMatrix();
                        trailMesh.setMatrixAt(i, _tempObj.matrix);
                    }
                }
                trailMesh.instanceMatrix.needsUpdate = true;

                if (t >= 1) {
                    impactAge = age;
                    scene.remove(coreMesh);
                    scene.remove(trailMesh);
                    coreGeo.dispose();
                    coreMat.dispose();
                    releasePooledMaterial(trailMat);
                    trailMesh.dispose();
                }
            } else {
                // Animate cartoon flipbook explosion on impact point
                const elapsed = age - impactAge;
                const maxLife = 0.45;
                const pct = Math.min(1, elapsed / maxLife);

                if (pct < 1.0) {
                    _tempObj.position.copy(end);
                    _tempObj.quaternion.copy(camera.quaternion);
                    _tempObj.scale.setScalar(1.0 + pct * 2.0);
                    _tempObj.updateMatrix();
                    expMesh.setMatrixAt(0, _tempObj.matrix);

                    aFrame[0] = Math.min(8, Math.floor(pct * 9.0));
                    aOpacity[0] = 1.0 - pct;

                    expMesh.instanceMatrix.needsUpdate = true;
                    (expMesh.geometry.getAttribute('aFrame') as THREE.InstancedBufferAttribute).needsUpdate = true;
                    (expMesh.geometry.getAttribute('aOpacity') as THREE.InstancedBufferAttribute).needsUpdate = true;
                } else {
                    scene.remove(expMesh);
                    expGeo.dispose();
                    expMat.dispose();
                    expMesh.dispose();
                    return false;
                }
            }

            return true;
        },
    });
}
