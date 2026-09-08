import * as THREE from "three";
import {
    getTerrainHeight,
    LAKES,
    BF_HALF_X,
    BF_HALF_Z,
    BF_BLEND,
} from "../../simulation/constants";

function smoothstep(e0: number, e1: number, x: number): number {
    const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
}

// How deep a point is inside a lake (0 = outside, 1 = deepest center)
function lakeWetness(x: number, z: number): number {
    let maxWet = 0;
    for (const lake of LAKES) {
        const dx = (x - lake.cx) / lake.rx;
        const dz = (z - lake.cz) / lake.rz;
        const distSq = dx * dx + dz * dz;
        const wet = Math.exp(-distSq * 0.5);
        if (wet > maxWet) maxWet = wet;
    }
    return maxWet;
}

export class Floor {
    mesh: THREE.Mesh;

    constructor(scene: THREE.Scene) {
        // ponytail: expanded to 400x400 segments (smooth 6m grid, highly accurate surface contours, 60+ FPS)
        const groundGeo = new THREE.PlaneGeometry(2400, 2400, 400, 400);
        const groundPos = groundGeo.attributes.position;
        const colors: number[] = [];

        const cBattleDry = new THREE.Color(0x6b7a3a); // Warm olive path/arena base
        const cBattleEdge = new THREE.Color(0x7a9a3b); // Light olive
        const cForest = new THREE.Color(0x3ea339); // Vibrant anime meadow green (Genshin style)
        const cForestRock = new THREE.Color(0x757e8a); // Slate mountain rock
        const cLakeBed = new THREE.Color(0x1a332d); // Dark teal muddy bed
        const cLakeDeep = new THREE.Color(0x0e241f); // Deep abyss water color
        const cLakeShore = new THREE.Color(0x6b9e7d); // Soft wet shore

        const work = new THREE.Color();

        for (let i = 0; i < groundPos.count; i++) {
            const vx = groundPos.getX(i);
            const vz = -groundPos.getY(i);
            const h = getTerrainHeight(vx, vz);

            groundPos.setZ(i, h);

            const dxEdge = Math.max(0, Math.abs(vx) - BF_HALF_X);
            const dzEdge = Math.max(0, Math.abs(vz) - BF_HALF_Z);
            const edgeDist = Math.sqrt(dxEdge * dxEdge + dzEdge * dzEdge);
            const forestFactor = smoothstep(0, BF_BLEND, edgeDist);

            const wetness = lakeWetness(vx, vz);

            if (wetness > 0.15) {
                if (wetness > 0.7) {
                    const t = Math.min(1, (wetness - 0.7) / 0.3);
                    work.copy(cLakeBed).lerp(cLakeDeep, t);
                } else if (wetness > 0.35) {
                    work.copy(cLakeBed);
                } else {
                    const t = (wetness - 0.15) / 0.2;
                    work.copy(cLakeShore).lerp(cLakeBed, t);
                }
            } else if (forestFactor < 0.1) {
                work.copy(cBattleDry);
            } else if (forestFactor < 0.35) {
                const t = (forestFactor - 0.1) / 0.25;
                work.copy(cBattleEdge).lerp(cForest, t);
            } else {
                const steepT = smoothstep(6.0, 18.0, h);
                work.copy(cForest).lerp(cForestRock, steepT);
            }

            colors.push(work.r, work.g, work.b);
        }

        groundGeo.setAttribute(
            "color",
            new THREE.Float32BufferAttribute(colors, 3),
        );
        groundGeo.computeVertexNormals();

        // ── Load Stylized PBR Texture Suite (Ponytail: GPU-native, zero runtime overhead) ──
        const texLoader = new THREE.TextureLoader();
        const baseUrl = import.meta.env.BASE_URL;

        const setupTex = (url: string): THREE.Texture => {
            const tex = texLoader.load(url);
            tex.wrapS = THREE.RepeatWrapping;
            tex.wrapT = THREE.RepeatWrapping;
            tex.generateMipmaps = true;
            tex.minFilter = THREE.LinearMipmapLinearFilter;
            tex.colorSpace = THREE.SRGBColorSpace;
            return tex;
        };

        const grassTex = setupTex(`${baseUrl}textures/terrain/Stylized_Grass_002_basecolor.jpg`);
        const cliffTex = setupTex(`${baseUrl}textures/terrain/Stylized_Cliff_Rock_006_basecolor.png`);

        const terrainMaterial = new THREE.MeshStandardMaterial({
            vertexColors: true,
            roughness: 0.88,
            metalness: 0.02,
        });

        // ── Ultra-Fast Slope-Based Custom Shader Inject ──
        terrainMaterial.onBeforeCompile = (shader) => {
            shader.uniforms.uGrassTex = { value: grassTex };
            shader.uniforms.uCliffTex = { value: cliffTex };

            shader.vertexShader = `
                varying vec3 vTerrainWorldPos;
                varying vec3 vTerrainWorldNorm;
            ` + shader.vertexShader;

            shader.fragmentShader = `
                varying vec3 vTerrainWorldPos;
                varying vec3 vTerrainWorldNorm;
                uniform sampler2D uGrassTex;
                uniform sampler2D uCliffTex;
            ` + shader.fragmentShader;

            shader.vertexShader = shader.vertexShader.replace(
                '#include <worldpos_vertex>',
                `
                #include <worldpos_vertex>
                vTerrainWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
                vTerrainWorldNorm = normalize((modelMatrix * vec4(objectNormal, 0.0)).xyz);
                `
            );

            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <color_fragment>',
                `
                #include <color_fragment>

                // 1. Slope determination: 0.0 = flat plane, 1.0 = vertical wall
                float slope = clamp(1.0 - abs(vTerrainWorldNorm.y), 0.0, 1.0);
                float cliffFactor = smoothstep(0.18, 0.42, slope);

                // Height-based rock boost for high mountain peaks
                float heightRock = smoothstep(6.0, 18.0, vTerrainWorldPos.y) * 0.40;
                cliffFactor = clamp(cliffFactor + heightRock * smoothstep(0.08, 0.22, slope), 0.0, 1.0);

                // 2. High-performance cliff projection
                vec2 cliffUv = (abs(vTerrainWorldNorm.x) > abs(vTerrainWorldNorm.z)) ? vTerrainWorldPos.zy * 0.035 : vTerrainWorldPos.xy * 0.035;
                vec4 cliffCol = texture2D(uCliffTex, cliffUv);

                // 3. Ground planar sampling
                vec2 groundUv = vTerrainWorldPos.xz * 0.055;
                vec4 grassCol = texture2D(uGrassTex, groundUv);

                // 4. Harmonize with stylized vertex color gradient
                vec3 finalAlbedo = mix(grassCol.rgb * (vColor.rgb * 1.30), cliffCol.rgb * (vColor.rgb * 1.20), cliffFactor);

                diffuseColor.rgb = finalAlbedo;
                `
            );
        };

        this.mesh = new THREE.Mesh(groundGeo, terrainMaterial);
        this.mesh.name = "terrain";
        this.mesh.userData.excludeOcclusion = true;
        this.mesh.rotation.x = -Math.PI / 2;
        scene.add(this.mesh);

        // ponytail: Independent terrain wireframe debug overlay
        if (import.meta.env.VITE_DEBUG_FLOOR === 'true') {
            const wireframeMat = new THREE.MeshBasicMaterial({
                color: 0x00ff88, // Crisp mint green wireframe
                wireframe: true,
                transparent: true,
                opacity: 0.20,
                depthWrite: false,
            });
            const wireframeMesh = new THREE.Mesh(groundGeo, wireframeMat);
            wireframeMesh.name = "terrain-wireframe-debug";
            wireframeMesh.rotation.x = -Math.PI / 2;
            wireframeMesh.position.y += 0.02; // Small bias to eliminate z-fighting
            wireframeMesh.userData.excludeOcclusion = true;
            scene.add(wireframeMesh);
        }
    }
}
