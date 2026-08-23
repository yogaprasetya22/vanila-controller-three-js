import * as THREE from "three";
import { camera } from "../core/scene";
import {
    easeOutCubic,
    pooledRing,
    getPooledMaterial,
    releasePooledMaterial,
    sparkTex,
    activeFX,
    fxQualityScale,
    _tempObj,
} from "./FXCore";

let _tauntTex: THREE.CanvasTexture | null = null;
function getTauntTex(): THREE.CanvasTexture {
    if (_tauntTex) return _tauntTex;
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ff0000";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "bold 96px Inter, sans-serif";
    ctx.fillText("💢", 64, 64);
    _tauntTex = new THREE.CanvasTexture(canvas);
    _tauntTex.minFilter = THREE.LinearFilter;
    _tauntTex.magFilter = THREE.LinearFilter;
    return _tauntTex;
}

export function spawnTauntFX(
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
    const colorPrimary = isBlue ? 0x2288ff : 0xff2244;
    const colorSecondary = isBlue ? 0x00dfff : 0xff0033;
    const colorSparks = isBlue ? 0x33ccff : 0xff4444;

    // Custom shader for expanding ground ring wave
    const waveGeo = new THREE.PlaneGeometry(1.0, 1.0);
    const waveMat = new THREE.ShaderMaterial({
        uniforms: {
            uColor: { value: new THREE.Color(colorPrimary) },
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
                // Expanding ripple
                vec2 uv = vUv - vec2(0.5);
                float dist = length(uv);
                if (dist > 0.5) discard;
                
                float r = smoothstep(0.03, 0.0, abs(dist - 0.43));
                gl_FragColor = vec4(uColor * 2.0, r * uOpacity * (1.0 - dist * 2.0));
            }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
    });
    const wave = new THREE.Mesh(waveGeo, waveMat);
    wave.rotation.x = -Math.PI / 2;
    wave.position.set(x, y + 0.05, z);
    scene.add(wave);

    const ringGeo = pooledRing(0.5, 0.7, 16);
    const ringMat = getPooledMaterial({
        color: colorSecondary,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, y + 0.05, z);
    scene.add(ring);

    // Glowing Billboard Red anger Emoji
    const tauntMat = new THREE.SpriteMaterial({
        map: getTauntTex(),
        transparent: true,
        depthWrite: false,
    });
    const tauntSprite = new THREE.Sprite(tauntMat);
    tauntSprite.scale.set(1.4, 1.4, 1.0);
    tauntSprite.position.set(x, y + 2.5, z);
    scene.add(tauntSprite);

    const sparkGeo = new THREE.PlaneGeometry(0.4, 0.4);
    const sparkMat = getPooledMaterial({
        map: sparkTex,
        color: colorSparks,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
    });
    const SP = Math.round(15 * fxQualityScale());
    const sparkMesh = new THREE.InstancedMesh(sparkGeo, sparkMat, SP);
    sparkMesh.frustumCulled = false;
    scene.add(sparkMesh);

    const sparkVels: THREE.Vector3[] = [];
    const sparkPos: THREE.Vector3[] = [];
    for (let i = 0; i < SP; i++) {
        sparkPos.push(new THREE.Vector3(x, y + 0.5, z));
        const theta = Math.random() * Math.PI * 2;
        const speed = 2.0 + Math.random() * 4.0;
        sparkVels.push(new THREE.Vector3(Math.cos(theta) * speed, 3.0 + Math.random() * 5.0, Math.sin(theta) * speed));
    }

    let age = 0;
    const duration = 0.52;
    activeFX.push({
        update(delta) {
            age += delta;
            const t = Math.min(1, age / duration);
            if (t >= 1) {
                scene.remove(wave);
                scene.remove(ring);
                scene.remove(tauntSprite);
                scene.remove(sparkMesh);

                waveGeo.dispose();
                waveMat.dispose();
                releasePooledMaterial(ringMat);
                releasePooledMaterial(sparkMat);
                tauntMat.dispose();
                sparkMesh.dispose();
                sparkGeo.dispose();
                return false;
            }

            const scaleWave = 1.0 + easeOutCubic(t) * 9.0;
            wave.scale.set(scaleWave, scaleWave, 1.0);
            waveMat.uniforms.uOpacity.value = 1.0 - t;

            const scaleRing = 1.0 + easeOutCubic(t) * 6.5;
            ring.scale.set(scaleRing, scaleRing, 1.0);
            ring.rotation.z += delta * 3.5;
            ringMat.opacity = 1.0 - t;

            tauntSprite.position.y = y + 2.5 + Math.sin(age * 12.0) * 0.25;
            tauntSprite.scale.setScalar(1.4 * (1.0 - t));

            const cq = camera.quaternion;
            for (let i = 0; i < SP; i++) {
                sparkPos[i].addScaledVector(sparkVels[i], delta);
                sparkVels[i].y -= 9.8 * delta; // gravity

                _tempObj.position.copy(sparkPos[i]);
                _tempObj.quaternion.copy(cq);
                _tempObj.scale.setScalar((1.0 - t) * 0.7);
                _tempObj.updateMatrix();
                sparkMesh.setMatrixAt(i, _tempObj.matrix);
            }
            sparkMesh.instanceMatrix.needsUpdate = true;
            sparkMat.opacity = 1.0 - t;

            return true;
        },
    });
}
