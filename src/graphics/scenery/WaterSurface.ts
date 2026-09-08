import * as THREE from "three";
import { LAKES, type LakeDef } from "../../simulation/constants";

// VERTEX SHADER
const VERT = /* glsl */ `
    #include <fog_pars_vertex>
    varying vec2 vWorldXZ;
    varying vec3 vWorldPosition; // Ditambahkan untuk kalkulasi view vector Fresnel

    void main() {
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldXZ = worldPos.xz;
        vWorldPosition = worldPos.xyz;
        
        vec4 mvPosition = viewMatrix * worldPos;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
    }
`;

// FRAGMENT SHADER
const FRAG = /* glsl */ `
    #include <fog_pars_fragment>
    uniform float uTime;
    uniform vec2  uLakeCenter;
    uniform vec2  uLakeRadius;
    uniform vec3  uSkyColor; // Warna langit untuk pantulan Fresnel
    
    varying vec2  vWorldXZ;
    varying vec3  vWorldPosition;

    // Helper Math
    float smoothstepGLSL(float edge0, float edge1, float x) {
        float t = clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);
        return t * t * (3.0 - 2.0 * t);
    }

    // [OPTIMASI] Versi lebih ringan dari getTerrainHeight.
    // Menghindari kalkulasi detail tinggi jika tidak diperlukan.
    // [OPTIMASI] Versi lebih ringan dari getTerrainHeight.
    // Menghindari kalkulasi detail tinggi jika tidak diperlukan.
    float getTerrainHeightGLSL(vec2 p) {
        float dxEdge = max(0.0, abs(p.x) - 84.0);
        float dzEdge = max(0.0, abs(p.y) - 76.0);

        // Early out for central battlefield (no forest factor, height is flat 0.0)
        if (dxEdge == 0.0 && dzEdge == 0.0) {
            return 0.0;
        }

        float forestFactor = smoothstepGLSL(0.0, 14.0, sqrt(dxEdge * dxEdge + dzEdge * dzEdge));

        // Primary mountain ridges
        float mountainH = sin(p.x * 0.010) * cos(p.y * 0.012 + 0.3) * 32.0 + cos(p.x * 0.025) * sin(p.y * 0.022) * 14.0;
        
        // Secondary plateau layers (Must match TS constants.ts exactly to prevent leaks/holes)
        float h1 = sin(p.x * 0.12 + 0.5) * cos(p.y * 0.12) * 3.5;
        float h2 = sin(p.x * 0.28) * sin(p.y * 0.22 + 1.2) * 1.2;
        float h3 = sin(p.x * 0.06 + 1.1) * cos(p.y * 0.055 + 0.8) * 9.0;
        float h4 = cos(p.x * 0.09) * sin(p.y * 0.075 + 2.0) * 5.5;

        float riverPath = sin(p.x * 0.013) * 75.0;
        float riverDist = abs(p.y - riverPath);
        float riverDepth = 0.0;
        if (riverDist < 28.0) {
            float rT = 1.0 - (riverDist / 28.0);
            riverDepth = -7.0 * sin(rT * 1.5708); // 1.5708 adalah PI * 0.5 pre-calculated
        }

        float hills = mountainH + h1 + h2 + h3 + h4 + riverDepth;

        // Kalkulasi cekungan danau yang dioptimalkan (8 danau untuk map 2x)
        float maxWetness = 0.0;
        float lakeBowlDepth = 0.0;

        vec4 lakeCoords[8];
        lakeCoords[0] = vec4(-136.0, -124.0, 18.0, 13.0);
        lakeCoords[1] = vec4(136.0,  -124.0, 17.0, 12.0);
        lakeCoords[2] = vec4(-136.0, 124.0,  16.0, 13.0);
        lakeCoords[3] = vec4(136.0,  124.0,  18.0, 12.0);
        lakeCoords[4] = vec4(-176.0, 0.0,    12.0, 10.0);
        lakeCoords[5] = vec4(176.0,  0.0,    12.0, 10.0);
        lakeCoords[6] = vec4(0.0,    -148.0, 11.0, 8.0);
        lakeCoords[7] = vec4(0.0,    148.0,  11.0, 8.0);

        float lakeDepths[8];
        lakeDepths[0] = 1.4;
        lakeDepths[1] = 1.3;
        lakeDepths[2] = 1.2;
        lakeDepths[3] = 1.5;
        lakeDepths[4] = 1.0;
        lakeDepths[5] = 1.0;
        lakeDepths[6] = 1.1;
        lakeDepths[7] = 1.2;

        for(int i=0; i<8; i++) {
            vec2 d = (p - lakeCoords[i].xy) / lakeCoords[i].zw; 
            float wet = exp(-dot(d, d) * 0.5);
            maxWetness = max(maxWetness, wet);
            lakeBowlDepth -= (lakeDepths[i] * 2.2) * wet;
        }

        hills = mix(hills, -3.0, smoothstepGLSL(0.0, 0.8, maxWetness));
        return (hills + lakeBowlDepth) * forestFactor;
    }

    // Pembangkit Normal Ombak Gerstner Prosedural Multi-Octave (3 Harmonics)
    vec3 getWaveNormal(vec2 p, float t) {
        // Harmonic 1: Ombak utama arah diagonal barat-daya
        vec2 d1 = vec2(0.707, 0.707);
        float w1 = dot(d1, p) * 0.40 + t * 1.0;
        vec2 dw1 = d1 * cos(w1) * 0.22;

        // Harmonic 2: Riak silang angin arah barat-laut
        vec2 d2 = vec2(-0.6, 0.8);
        float w2 = dot(d2, p) * 0.85 - t * 1.3;
        vec2 dw2 = d2 * cos(w2) * 0.14;

        // Harmonic 3: Micro-ripple kilau permukaan
        vec2 d3 = vec2(0.9, -0.4);
        float w3 = dot(d3, p) * 1.60 + t * 1.8;
        vec2 dw3 = d3 * cos(w3) * 0.08;

        vec2 slope = dw1 + dw2 + dw3;
        return normalize(vec3(-slope.x, 1.2, -slope.y));
    }

    void main() {
        float WATER_LEVEL = -3.0;
        float terrainY = getTerrainHeightGLSL(vWorldXZ);

        if (terrainY >= WATER_LEVEL) {
            discard;
        }
        float depth = WATER_LEVEL - terrainY;
        vec2 centerDistVec = (vWorldXZ - uLakeCenter) / uLakeRadius;
        float distCenter = length(centerDistVec);

        float shoreFade = smoothstepGLSL(0.0, 0.25, depth);
        if (shoreFade < 0.01) discard;

        float depthFactor = clamp(depth * 0.45, 0.0, 1.0);

        // 1. Gerstner Wave Synthesis Normal (Multi-Harmonic 3D Waves)
        vec3 surfaceNormal = getWaveNormal(vWorldXZ * 0.45, uTime);

        // 2. Efek Fresnel (Refleksi Langit & Transparansi Kedalaman)
        vec3 viewDir = normalize(cameraPosition - vWorldPosition);
        float fresnelDot = max(dot(viewDir, surfaceNormal), 0.0);
        float fresnel = pow(1.0 - fresnelDot, 3.5); 

        // 3. Gradasi Kedalaman Warna (Shallow Turquoise -> Deep Ocean)
        vec3 shallowColor = vec3(0.18, 0.72, 0.88); // Crystal sparkling turquoise
        vec3 deepColor    = vec3(0.03, 0.14, 0.38); // Deep rich royal navy
        vec3 baseWaterColor = mix(shallowColor, deepColor, smoothstepGLSL(0.0, 2.5, depth));

        // 4. Distorsi Organik Ombak Bibir Pantai (Organic Shoreline Wave Displacement)
        float shoreNoise = sin(vWorldXZ.x * 0.35 + vWorldXZ.y * 0.25 + uTime * 0.9) * 0.14 +
                           cos(vWorldXZ.x * 0.70 - vWorldXZ.y * 0.60 - uTime * 1.3) * 0.07;

        // Gelombang sapuan dinamis bolak-balik (surging and receding wave wash)
        float waveWash = sin(uTime * 2.2 - depth * 9.0 + shoreNoise * 3.5) * 0.5 + 0.5;

        // 5. Busa Pantai Organik Halus (Soft Shore Contact Foam)
        float shoreContact = smoothstepGLSL(0.32, 0.02, depth + shoreNoise * 0.25);
        float waveCrest = smoothstepGLSL(0.45, 0.05, depth) * smoothstepGLSL(0.55, 0.92, waveWash);
        float microNoise = sin(vWorldXZ.x * 2.5 + uTime * 1.1) * cos(vWorldXZ.y * 2.5 - uTime * 0.8) * 0.5 + 0.5;
        float finalFoam = clamp(shoreContact * 0.75 + waveCrest * (0.50 + 0.35 * microNoise), 0.0, 1.0);

        vec3 foamColor = vec3(0.96, 0.99, 1.0);
        vec3 waterWithFoam = mix(baseWaterColor, foamColor, finalFoam * shoreFade * 0.85);

        // 6. Kilau Pantulan Matahari / Specular Sun Reflection
        vec3 sunDir = normalize(vec3(0.5, 0.75, 0.4));
        vec3 halfVec = normalize(viewDir + sunDir);
        float spec = pow(max(dot(surfaceNormal, halfVec), 0.0), 36.0);
        vec3 sunSpecular = vec3(1.0, 0.95, 0.82) * spec * 0.55 * shoreFade;
        waterWithFoam += sunSpecular;

        // 7. Caustics Cairan Organik Melengkung (Curved Liquid Caustics — No Grid Matrix)
        // ponytail: non-orthogonal diagonal wave superposition creates natural organic flowing ribbons instead of grid tiles
        vec2 cCoord = vWorldXZ * 0.45 + surfaceNormal.xz * 0.35;
        float cWave1 = sin(cCoord.x * 1.4 + cCoord.y * 1.1 + uTime * 1.2);
        float cWave2 = sin(-cCoord.x * 1.2 + cCoord.y * 1.5 - uTime * 0.9);
        float cWave3 = cos(cCoord.x * 0.9 - cCoord.y * 1.8 + uTime * 1.5);
        float caustic = pow(clamp((cWave1 + cWave2 + cWave3) * 0.33 + 0.5, 0.0, 1.0), 3.0);
        waterWithFoam += caustic * vec3(0.06, 0.16, 0.20) * depthFactor * 0.35;

        // Campurkan warna dasar air dengan warna langit berdasarkan Fresnel
        vec3 finalColor = mix(waterWithFoam, uSkyColor, fresnel * 0.65);

        // Alpha calculation: Opacity pekat halus yang menutupi wireframe dasar tanah namun tetap transparan di bibir pantai
        float finalAlpha = mix(0.85, 0.98, depthFactor) * shoreFade;
        finalAlpha = clamp(finalAlpha + fresnel * 0.25 + finalFoam * 0.45, 0.0, 1.0);

        gl_FragColor = vec4(finalColor, finalAlpha);
        #include <fog_fragment>
    }
`;

export class WaterSurface {
    meshes: THREE.Mesh[] = [];
    materials: THREE.ShaderMaterial[] = [];
    private skyColor = new THREE.Color(0.6, 0.75, 0.9);

    constructor(scene: THREE.Scene, uniforms: { uTime: { value: number } }) {
        // ponytail: Single unified 2400x2400 water plane covering all lakes and rivers across the expanded world.
        const waterGeo = new THREE.PlaneGeometry(2400, 2400);
        const waterUniforms = THREE.UniformsUtils.merge([
            THREE.UniformsLib.fog,
            {
                uTime: uniforms.uTime,
                uSkyColor: { value: this.skyColor },
            }
        ]);
        waterUniforms.uTime = uniforms.uTime;

        const waterMat = new THREE.ShaderMaterial({
            uniforms: waterUniforms,
            vertexShader: VERT,
            fragmentShader: FRAG,
            transparent: true,
            depthWrite: false, // Prevents Z-buffer fighting and transparency sorting artifacts
            side: THREE.DoubleSide,
            fog: true,
        });

        const waterMesh = new THREE.Mesh(waterGeo, waterMat);
        waterMesh.name = "water";
        waterMesh.userData.excludeOcclusion = true;
        waterMesh.rotation.x = -Math.PI / 2;
        waterMesh.position.set(0, -3.0, 0);
        waterMesh.frustumCulled = false;
        waterMesh.renderOrder = -1;
        
        scene.add(waterMesh);
        this.meshes.push(waterMesh);
        this.materials.push(waterMat);
    }

    update(_camPos: THREE.Vector3) {
        // Single unified plane doesn't require individual mesh iteration
    }
}
