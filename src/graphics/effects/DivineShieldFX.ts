import * as THREE from "three";
import { activeFX, alignGroundDecal } from "./FXCore";

export function spawnDivineShieldFX(
    scene: THREE.Scene,
    targetPos: THREE.Vector3,
    team?: number,
) {
    const isBlue = team === 1;
    const colorShield = isBlue ? 0x00f0ff : 0xffc300;
    const colorCore = isBlue ? 0xaae8ff : 0xffeebb;

    // Glowing energy sphere geometry using a custom edge-glow shader
    const shieldGeo = new THREE.SphereGeometry(1.25, 32, 32);
    const shieldMat = new THREE.ShaderMaterial({
        uniforms: {
            uTime: { value: 0 },
            uColor: { value: new THREE.Color(colorShield) },
            uCoreColor: { value: new THREE.Color(colorCore) },
            uOpacity: { value: 1.0 },
        },
        vertexShader: `
            varying vec3 vNormal;
            varying vec3 vViewPosition;
            varying vec2 vUv;
            void main() {
                vUv = uv;
                vNormal = normalize(normalMatrix * normal);
                vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                vViewPosition = -mvPosition.xyz;
                gl_Position = projectionMatrix * mvPosition;
            }
        `,
        fragmentShader: `
            uniform vec3 uColor;
            uniform vec3 uCoreColor;
            uniform float uTime;
            uniform float uOpacity;
            varying vec3 vNormal;
            varying vec3 vViewPosition;
            varying vec2 vUv;

            void main() {
                vec3 normal = normalize(vNormal);
                vec3 viewDir = normalize(vViewPosition);

                // Fresnel Edge-Glow
                float edge = pow(1.0 - max(0.0, dot(normal, viewDir)), 2.5);

                // Scrolling holographic grid grid lines
                float grid = sin(vUv.x * 60.0 + uTime * 2.0) * sin(vUv.y * 60.0 - uTime * 2.0);
                grid = smoothstep(0.7, 0.9, grid) * 0.3;

                // Pulsing energy waves
                float pulse = sin(vUv.y * 12.0 - uTime * 8.0) * 0.15 + 0.85;

                vec3 color = mix(uColor, uCoreColor, edge * 0.5);
                gl_FragColor = vec4(color * 1.8, (edge * 0.9 + grid * pulse) * uOpacity);
            }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
    });
    const shieldMesh = new THREE.Mesh(shieldGeo, shieldMat);
    shieldMesh.position.copy(targetPos);
    shieldMesh.position.y += 0.8; // center around character body
    scene.add(shieldMesh);

    // Dynamic ground runic aura ring
    const groundGeo = new THREE.RingGeometry(0.2, 1.3, 32);
    const groundMat = new THREE.MeshBasicMaterial({
        color: colorShield,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
    });
    const groundRing = new THREE.Mesh(groundGeo, groundMat);
    alignGroundDecal(groundRing, targetPos.x, targetPos.z, 0.04);
    scene.add(groundRing);

    let age = 0;
    const duration = 2.0; // shield stays for 2 seconds
    activeFX.push({
        update(delta) {
            age += delta;
            const t = Math.min(1, age / duration);
            if (t >= 1) {
                scene.remove(shieldMesh);
                scene.remove(groundRing);
                shieldGeo.dispose();
                shieldMat.dispose();
                groundGeo.dispose();
                groundMat.dispose();
                return false;
            }

            shieldMat.uniforms.uTime.value = age;
            
            // Pulse scale slightly
            const scale = 1.0 + Math.sin(age * 5.0) * 0.03;
            shieldMesh.scale.setScalar(scale);

            // Fade out near end of duration
            const fade = t > 0.8 ? (1.0 - (t - 0.8) / 0.2) : 1.0;
            shieldMat.uniforms.uOpacity.value = fade;
            groundMat.opacity = 0.9 * fade;
            groundRing.rotation.z += 0.02;

            return true;
        },
    });
}
