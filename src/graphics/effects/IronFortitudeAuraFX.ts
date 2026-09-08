import * as THREE from "three";
import { camera } from "../core/scene";
import {
    easeOutCubic,
    pooledPlane,
    getPooledMaterial,
    releasePooledMaterial,
    star2Tex,
    activeFX,
    alignGroundDecal,
    fxQualityScale,
    _tempObj,
} from "./FXCore";

export function spawnIronFortitudeAuraFX(
    scene: THREE.Scene,
    x: number,
    y: number,
    z: number,
    team?: number,
) {
    const isBlue = team === 1;
    const colorRing1 = isBlue ? 0x00dfff : 0xffd700;
    const colorRing2 = isBlue ? 0x3366ff : 0xffaa00;
    const colorSparks = isBlue ? 0x88f0ff : 0xffeebb;

    // Custom shader for rotating concentric runic-like grid circle
    const runeGeo = new THREE.PlaneGeometry(3.0, 3.0);
    const runeMat = new THREE.ShaderMaterial({
        uniforms: {
            uTime: { value: 0 },
            uColor: { value: new THREE.Color(colorRing1) },
            uColor2: { value: new THREE.Color(colorRing2) },
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
            uniform vec3 uColor2;
            uniform float uTime;
            uniform float uOpacity;
            varying vec2 vUv;

            void main() {
                vec2 uv = vUv - vec2(0.5);
                float dist = length(uv);
                if (dist > 0.5) discard;

                // Runic rings pattern
                float ring1 = smoothstep(0.01, 0.0, abs(dist - 0.45));
                float ring2 = smoothstep(0.01, 0.0, abs(dist - 0.35));
                float ring3 = smoothstep(0.01, 0.0, abs(dist - 0.20));

                // Rotating spokes (runic ticks)
                float angle = atan(uv.y, uv.x);
                float spoke1 = step(0.98, sin(angle * 12.0 + uTime * 3.0));
                float spoke2 = step(0.98, sin(angle * 8.0 - uTime * 2.0));

                float pattern = ring1 + ring2 + ring3 + spoke1 * ring1 + spoke2 * ring2;
                vec3 finalCol = mix(uColor, uColor2, dist * 2.0);
                
                gl_FragColor = vec4(finalCol * 2.0, pattern * uOpacity * (1.0 - dist * 2.0));
            }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
    });
    const runeMesh = new THREE.Mesh(runeGeo, runeMat);
    alignGroundDecal(runeMesh, x, z, 0.04);
    scene.add(runeMesh);

    // Glowing rising column mesh
    const pillarGeo = new THREE.CylinderGeometry(0.8, 1.0, 4.0, 24, 1, true);
    const pillarMat = new THREE.ShaderMaterial({
        uniforms: {
            uTime: { value: 0 },
            uColor: { value: new THREE.Color(colorRing2) },
            uOpacity: { value: 1.0 },
        },
        vertexShader: `
            varying vec2 vUv;
            varying float vPosY;
            void main() {
                vUv = uv;
                vPosY = position.y;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform vec3 uColor;
            uniform float uTime;
            uniform float uOpacity;
            varying vec2 vUv;
            varying float vPosY;

            void main() {
                // Rising energy waves
                float wave = sin(vUv.y * 15.0 - uTime * 6.0) * 0.5 + 0.5;
                float edgeGlow = sin(vUv.x * 3.14159);
                float verticalFade = (2.0 - vPosY) / 4.0; // fade out as it goes up

                gl_FragColor = vec4(uColor * 1.5, wave * edgeGlow * verticalFade * uOpacity * 0.4);
            }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
    });
    const pillar = new THREE.Mesh(pillarGeo, pillarMat);
    pillar.position.set(x, y + 2.0, z);
    scene.add(pillar);

    // Instanced rising stars
    const spGeo = pooledPlane(0.25, 0.25);
    const spMat = getPooledMaterial({
        map: star2Tex,
        color: colorSparks,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
    });
    const SPS = Math.round(18 * fxQualityScale());
    const instMesh = new THREE.InstancedMesh(spGeo, spMat, SPS);
    instMesh.frustumCulled = false;
    scene.add(instMesh);

    const spVels: THREE.Vector3[] = [];
    const spOffsets: THREE.Vector3[] = [];
    for (let i = 0; i < SPS; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = 0.1 + Math.random() * 0.8;
        spOffsets.push(new THREE.Vector3(x + Math.cos(a) * r, y + 0.1, z + Math.sin(a) * r));
        spVels.push(new THREE.Vector3((Math.random() - 0.5) * 0.3, 2.0 + Math.random() * 2.5, (Math.random() - 0.5) * 0.3));
    }

    let age = 0;
    const duration = 1.2;
    activeFX.push({
        update(delta) {
            age += delta;
            const t = Math.min(1, age / duration);
            if (t >= 1) {
                scene.remove(runeMesh);
                scene.remove(pillar);
                scene.remove(instMesh);
                runeGeo.dispose();
                runeMat.dispose();
                pillarGeo.dispose();
                pillarMat.dispose();
                releasePooledMaterial(spMat);
                instMesh.dispose();
                return false;
            }
            const et = easeOutCubic(t);

            runeMat.uniforms.uTime.value = age;
            runeMat.uniforms.uOpacity.value = 1.0 - et;
            runeMesh.scale.setScalar(1.0 + et * 0.3);

            pillarMat.uniforms.uTime.value = age;
            pillarMat.uniforms.uOpacity.value = (1.0 - et) * (1.0 - et);
            pillar.scale.set(1.0 + et * 0.5, 1.0, 1.0 + et * 0.5);

            const cq = camera.quaternion;
            for (let i = 0; i < SPS; i++) {
                spOffsets[i].addScaledVector(spVels[i], delta);
                _tempObj.position.copy(spOffsets[i]);
                _tempObj.quaternion.copy(cq);
                _tempObj.scale.setScalar((1.0 - t) * (0.6 + Math.sin(age * 12 + i) * 0.4));
                _tempObj.updateMatrix();
                instMesh.setMatrixAt(i, _tempObj.matrix);
            }
            instMesh.instanceMatrix.needsUpdate = true;
            return true;
        },
    });
}
