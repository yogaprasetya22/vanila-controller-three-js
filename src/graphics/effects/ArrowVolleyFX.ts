import * as THREE from "three";
import { camera } from "../core/scene";
import {
    easeOutCubic,
    easeOutQuad,
    pooledPlane,
    starTex,
    activeFX,
    fxQualityScale,
    getPooledMaterial,
    releasePooledMaterial,
    _tempObj,
    alignGroundDecal,
} from "./FXCore";

const texLoader = new THREE.TextureLoader();
const subSmokeTex = texLoader.load('/vfx/subemitter2/tex_0.png');

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

export function spawnArrowVolleyFX(
    scene: THREE.Scene,
    centerX: number,
    centerZ: number,
    groundY: number,
    radius: number = 4.0,
    team?: number,
): void {
    const isBlue = team === 1;
    const colorCircle = isBlue ? 0x00dfff : 0xff3300;
    const colorRune = isBlue ? 0xaae8ff : 0xffdd44;
    const colorStar = isBlue ? 0xffffff : 0xffeedd;

    // Glowing runic targeting circle on the ground
    const ringGeo = new THREE.PlaneGeometry(radius * 2.5, radius * 2.5);
    const ringMat = new THREE.ShaderMaterial({
        uniforms: {
            uTime: { value: 0 },
            uColor: { value: new THREE.Color(colorCircle) },
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

                float ring = smoothstep(0.015, 0.0, abs(dist - 0.44));
                float ringInner = smoothstep(0.01, 0.0, abs(dist - 0.32));
                float rad = atan(uv.y, uv.x);
                float spokes = step(0.96, sin(rad * 12.0 + uTime * 3.0)) * ring;

                gl_FragColor = vec4(uColor * 2.2, (ring + ringInner * 0.4 + spokes) * uOpacity * (1.0 - dist * 1.5));
            }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    alignGroundDecal(ring, centerX, centerZ, 0.05);
    scene.add(ring);

    const COUNT = 60;
    const arrowGeo = new THREE.CylinderGeometry(0.01, 0.035, 1.2, 4);
    const arrowMat = new THREE.MeshBasicMaterial({
        color: colorStar,
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
    });
    const arrows = new THREE.InstancedMesh(arrowGeo, arrowMat, COUNT);
    arrows.frustumCulled = false;
    scene.add(arrows);

    // Glowing ribbon trails using an instanced mesh of cylinders
    const tracerGeo = new THREE.CylinderGeometry(0.02, 0.02, 3.0, 4);
    const tracerMat = new THREE.MeshBasicMaterial({
        color: colorRune,
        transparent: true,
        opacity: 0.45,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
    });
    const tracers = new THREE.InstancedMesh(tracerGeo, tracerMat, COUNT);
    tracers.frustumCulled = false;
    scene.add(tracers);

    // Instanced crystal shards geometry
    const SHARDS_PER_ARROW = 3;
    const shardCount = COUNT * SHARDS_PER_ARROW;
    const shardGeo = new THREE.DodecahedronGeometry(0.12, 0);
    const shardMat = new THREE.ShaderMaterial({
        uniforms: {
            uColor: { value: new THREE.Color(isBlue ? 0x00dfff : 0xffaa00) },
            uOpacity: { value: 1.0 },
        },
        vertexShader: `
            varying float vNormalDot;
            void main() {
                vec3 norm = normalize(normalMatrix * normal);
                vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
                vNormalDot = abs(dot(norm, normalize(-mvPosition.xyz)));
                gl_Position = projectionMatrix * mvPosition;
            }
        `,
        fragmentShader: `
            uniform vec3 uColor;
            uniform float uOpacity;
            varying float vNormalDot;
            void main() {
                float highlight = pow(1.0 - vNormalDot, 3.0);
                gl_FragColor = vec4(mix(uColor, vec3(1.0), highlight * 0.7) * 2.2, uOpacity);
            }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
    });
    const shardMesh = new THREE.InstancedMesh(shardGeo, shardMat, shardCount);
    shardMesh.frustumCulled = false;
    scene.add(shardMesh);

    // Ground impact smoke flipbook particles (2x2 layout from subemitter2/tex_0.png)
    const impactGeo = new THREE.PlaneGeometry(1.6, 1.6);
    const impactMat = getFlipbookMat(subSmokeTex, 2, 2, isBlue ? new THREE.Color(0.3, 0.8, 1.0) : new THREE.Color(1.0, 0.5, 0.2));
    const impacts = new THREE.InstancedMesh(impactGeo, impactMat, COUNT);
    impacts.frustumCulled = false;
    const aFrame = new Float32Array(COUNT);
    const aOpacity = new Float32Array(COUNT);
    impacts.geometry.setAttribute('aFrame', new THREE.InstancedBufferAttribute(aFrame, 1));
    impacts.geometry.setAttribute('aOpacity', new THREE.InstancedBufferAttribute(aOpacity, 1));
    scene.add(impacts);

    const positions: THREE.Vector3[] = [];
    const vels: THREE.Vector3[] = [];
    const delays: number[] = [];
    const impactAges: number[] = [];

    const shardPositions: THREE.Vector3[] = [];
    const shardVels: THREE.Vector3[] = [];
    const shardScales: number[] = [];
    const shardRots: THREE.Vector3[] = [];
    const shardRotVels: THREE.Vector3[] = [];

    const tempObj = new THREE.Object3D();
    const tempTracerObj = new THREE.Object3D();
    const tempImpactObj = new THREE.Object3D();

    const hideM = new THREE.Matrix4().makeScale(0, 0, 0);

    for (let i = 0; i < COUNT; i++) {
        const angle = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * radius;
        const targetX = centerX + Math.cos(angle) * r;
        const targetZ = centerZ + Math.sin(angle) * r;

        const startHeight = 22.0 + Math.random() * 8.0;
        positions.push(new THREE.Vector3(targetX + (Math.random() - 0.5) * 1.5, groundY + startHeight, targetZ + (Math.random() - 0.5) * 1.5));
        vels.push(new THREE.Vector3(0, -38.0 - Math.random() * 12.0, 0));
        delays.push(Math.random() * 0.95);
        impactAges.push(-1);

        arrows.setMatrixAt(i, hideM);
        tracers.setMatrixAt(i, hideM);
        impacts.setMatrixAt(i, hideM);
        aOpacity[i] = 0.0;
    }

    for (let i = 0; i < shardCount; i++) {
        shardPositions.push(new THREE.Vector3());
        shardVels.push(new THREE.Vector3());
        shardScales.push(0.4 + Math.random() * 0.6);
        shardRots.push(new THREE.Vector3(Math.random(), Math.random(), Math.random()));
        shardRotVels.push(new THREE.Vector3((Math.random() - 0.5) * 8.0, (Math.random() - 0.5) * 8.0, (Math.random() - 0.5) * 8.0));
        shardMesh.setMatrixAt(i, hideM);
    }

    arrows.instanceMatrix.needsUpdate = true;
    tracers.instanceMatrix.needsUpdate = true;
    impacts.instanceMatrix.needsUpdate = true;
    shardMesh.instanceMatrix.needsUpdate = true;
    (impacts.geometry.getAttribute('aOpacity') as THREE.InstancedBufferAttribute).needsUpdate = true;
    (impacts.geometry.getAttribute('aFrame') as THREE.InstancedBufferAttribute).needsUpdate = true;

    let age = 0;
    const duration = 2.0;
    activeFX.push({
        update(delta) {
            age += delta;
            const t = Math.min(1, age / duration);
            if (t >= 1) {
                scene.remove(ring);
                scene.remove(arrows);
                scene.remove(tracers);
                scene.remove(impacts);
                scene.remove(shardMesh);

                ringGeo.dispose();
                ringMat.dispose();
                arrowGeo.dispose();
                arrowMat.dispose();
                tracerGeo.dispose();
                tracerMat.dispose();
                impactGeo.dispose();
                impactMat.dispose();
                shardGeo.dispose();
                shardMat.dispose();

                arrows.dispose();
                tracers.dispose();
                impacts.dispose();
                shardMesh.dispose();
                return false;
            }

            ringMat.uniforms.uTime.value = age;
            ringMat.uniforms.uOpacity.value = 1.0 - t;

            const cq = camera.quaternion;
            arrowsUpdated = false;
            let impactsUpdated = false;
            let shardsUpdated = false;

            for (let i = 0; i < COUNT; i++) {
                const elapsed = age - delays[i];
                if (elapsed < 0) continue;

                const yPos = positions[i].y + vels[i].y * elapsed;
                if (yPos > groundY) {
                    tempObj.position.set(positions[i].x, yPos, positions[i].z);
                    tempObj.scale.set(1.0, 1.0, 1.0);
                    tempObj.updateMatrix();
                    arrows.setMatrixAt(i, tempObj.matrix);

                    tempTracerObj.position.set(positions[i].x, yPos + 1.5, positions[i].z);
                    tempTracerObj.scale.set(1.0, 1.0, 1.0);
                    tempTracerObj.updateMatrix();
                    tracers.setMatrixAt(i, tempTracerObj.matrix);

                    arrowsUpdated = true;
                } else {
                    arrows.setMatrixAt(i, hideM);
                    tracers.setMatrixAt(i, hideM);
                    arrowsUpdated = true;

                    const justHit = (impactAges[i] === -1);
                    if (justHit) {
                        impactAges[i] = age;
                        const baseIdx = i * SHARDS_PER_ARROW;
                        for (let k = 0; k < SHARDS_PER_ARROW; k++) {
                            const idx = baseIdx + k;
                            shardPositions[idx].set(positions[i].x, groundY + 0.1, positions[i].z);
                            const theta = Math.random() * Math.PI * 2;
                            const speed = 2.0 + Math.random() * 4.0;
                            shardVels[idx].set(
                                Math.cos(theta) * speed,
                                3.0 + Math.random() * 4.0,
                                Math.sin(theta) * speed
                            );
                        }
                    }

                    const impactTime = age - impactAges[i];
                    const maxImpactLife = 0.4;
                    const ip = Math.min(1, impactTime / maxImpactLife);

                    if (ip < 1.0) {
                        tempImpactObj.position.set(positions[i].x, groundY + 0.05, positions[i].z);
                        tempImpactObj.quaternion.copy(cq);
                        tempImpactObj.scale.setScalar(0.4 + ip * 2.0);
                        tempImpactObj.updateMatrix();
                        impacts.setMatrixAt(i, tempImpactObj.matrix);

                        aFrame[i] = Math.min(3, Math.floor(ip * 4.0));
                        aOpacity[i] = 1.0 - ip;
                    } else {
                        impacts.setMatrixAt(i, hideM);
                        aOpacity[i] = 0;
                    }
                    impactsUpdated = true;

                    // Update crystal shards
                    const baseIdx = i * SHARDS_PER_ARROW;
                    for (let k = 0; k < SHARDS_PER_ARROW; k++) {
                        const idx = baseIdx + k;
                        const p = shardPositions[idx];
                        if (impactTime < 0.35) {
                            shardVels[idx].y -= 9.8 * delta;
                            p.addScaledVector(shardVels[idx], delta);
                            shardRots[idx].addScaledVector(shardRotVels[idx], delta);

                            _tempObj.position.copy(p);
                            _tempObj.rotation.set(shardRots[idx].x, shardRots[idx].y, shardRots[idx].z);
                            _tempObj.scale.setScalar(shardScales[idx] * Math.sin((impactTime / 0.35) * Math.PI));
                            _tempObj.updateMatrix();
                            shardMesh.setMatrixAt(idx, _tempObj.matrix);
                        } else {
                            shardMesh.setMatrixAt(idx, hideM);
                        }
                    }
                    shardsUpdated = true;
                }
            }

            if (arrowsUpdated) {
                arrows.instanceMatrix.needsUpdate = true;
                tracers.instanceMatrix.needsUpdate = true;
            }
            if (impactsUpdated) {
                impacts.instanceMatrix.needsUpdate = true;
                (impacts.geometry.getAttribute('aFrame') as THREE.InstancedBufferAttribute).needsUpdate = true;
                (impacts.geometry.getAttribute('aOpacity') as THREE.InstancedBufferAttribute).needsUpdate = true;
            }
            if (shardsUpdated) {
                shardMesh.instanceMatrix.needsUpdate = true;
            }

            arrowMat.opacity = 0.95 * (1.0 - t);
            tracerMat.opacity = 0.45 * (1.0 - t);
            shardMat.uniforms.uOpacity.value = 1.0 - t;

            return true;
        },
    });
}
// Add missing variable declaration to make compiler happy
let arrowsUpdated = false;
