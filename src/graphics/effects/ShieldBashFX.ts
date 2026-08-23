import * as THREE from "three";
import { camera } from "../core/scene";
import {
    pooledPlane,
    getPooledMaterial,
    releasePooledMaterial,
    sparkTex,
    activeFX,
    fxQualityScale,
    _tempObj,
} from "./FXCore";

export function spawnShieldBashFX(
    scene: THREE.Scene,
    x: number,
    y: number,
    z: number,
    tx: number,
    ty: number,
    tz: number,
    team?: number,
) {
    const isBlue = team === 1;
    const colorArc = isBlue ? 0x00aaff : 0xffaa00;
    const colorShock = isBlue ? 0x00dfff : 0xffdd44;
    const colorSparks = isBlue ? 0x88f0ff : 0xffdd88;

    const start = new THREE.Vector3(x, y + 0.8, z);
    const end = new THREE.Vector3(tx, ty + 0.8, tz);

    // Glowing holographic shield plane projecting forward
    const shieldGeo = new THREE.PlaneGeometry(2.0, 2.2);
    const shieldMat = new THREE.ShaderMaterial({
        uniforms: {
            uTime: { value: 0 },
            uColor: { value: new THREE.Color(colorArc) },
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
            varying vec2 vUv;
            void main() {
                // Shield border glow
                float borderX = smoothstep(0.46, 0.5, abs(vUv.x - 0.5));
                float borderY = smoothstep(0.46, 0.5, abs(vUv.y - 0.5));
                float border = max(borderX, borderY);
                
                // Holographic grid scan lines
                float grid = sin(vUv.x * 25.0) * sin(vUv.y * 25.0);
                grid = smoothstep(0.65, 0.9, grid) * 0.35;
                
                gl_FragColor = vec4(uColor * 2.5, max(border, grid) * uOpacity);
            }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
    });
    const shield = new THREE.Mesh(shieldGeo, shieldMat);
    shield.position.copy(start);
    shield.lookAt(end);
    scene.add(shield);

    // Flat ground shockwave expanding on impact point
    const shockGeo = new THREE.PlaneGeometry(1.0, 1.0);
    const shockMat = new THREE.ShaderMaterial({
        uniforms: {
            uColor: { value: new THREE.Color(colorShock) },
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
            varying vec2 vUv;
            void main() {
                vec2 uv = vUv - vec2(0.5);
                float dist = length(uv);
                if (dist > 0.5) discard;
                float r = smoothstep(0.02, 0.0, abs(dist - 0.45));
                gl_FragColor = vec4(uColor * 2.2, r * uOpacity * (1.0 - dist * 1.5));
            }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
    });
    const shock = new THREE.Mesh(shockGeo, shockMat);
    shock.rotation.x = -Math.PI / 2;
    shock.position.set(tx, y + 0.05, tz);
    scene.add(shock);

    const sparkGeo = pooledPlane(0.35, 0.35);
    const sparkMat = getPooledMaterial({
        map: sparkTex,
        color: colorSparks,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
    });
    const SK = Math.round(18 * fxQualityScale());
    const instMesh = new THREE.InstancedMesh(sparkGeo, sparkMat, SK);
    instMesh.frustumCulled = false;
    scene.add(instMesh);

    const sparkVels: THREE.Vector3[] = [];
    const sparkOffsets: THREE.Vector3[] = [];
    const hideM = new THREE.Matrix4().makeScale(0, 0, 0);

    for (let i = 0; i < SK; i++) {
        sparkOffsets.push(end.clone());
        const a = Math.random() * Math.PI * 2;
        const speed = 4.0 + Math.random() * 6.0;
        sparkVels.push(new THREE.Vector3(Math.cos(a) * speed, 1.0 + Math.random() * 5.0, Math.sin(a) * speed));
        instMesh.setMatrixAt(i, hideM);
    }
    instMesh.instanceMatrix.needsUpdate = true;

    let age = 0;
    const duration = 0.45;
    activeFX.push({
        update(delta) {
            age += delta;
            const t = Math.min(1, age / duration);
            if (t >= 1) {
                scene.remove(shield);
                scene.remove(shock);
                scene.remove(instMesh);

                shieldGeo.dispose();
                shieldMat.dispose();
                shockGeo.dispose();
                shockMat.dispose();
                releasePooledMaterial(sparkMat);
                instMesh.dispose();
                return false;
            }

            // Slide shield plane rapidly towards target
            const currentPos = new THREE.Vector3().lerpVectors(start, end, Math.min(1.0, t * 2.0));
            shield.position.copy(currentPos);
            shieldMat.uniforms.uOpacity.value = 1.0 - t;

            // Expand ground shockwave ring
            const ds = 0.5 + t * 5.0;
            shock.scale.set(ds, ds, 1.0);
            shockMat.uniforms.uOpacity.value = 1.0 - t;

            // Instanced sparks
            const cq = camera.quaternion;
            for (let i = 0; i < SK; i++) {
                if (t > 0.3) {
                    const elapsed = t - 0.3;
                    sparkOffsets[i].addScaledVector(sparkVels[i], delta);
                    sparkVels[i].y -= 9.8 * delta; // gravity

                    _tempObj.position.copy(sparkOffsets[i]);
                    _tempObj.quaternion.copy(cq);
                    _tempObj.scale.setScalar((1.0 - elapsed / 0.7) * 0.9);
                    _tempObj.updateMatrix();
                    instMesh.setMatrixAt(i, _tempObj.matrix);
                }
            }
            instMesh.instanceMatrix.needsUpdate = true;
            sparkMat.opacity = 1.0 - t;

            return true;
        },
    });
}
