import * as THREE from "three";
import { LAKES, type LakeDef } from "../../simulation/constants";

// VERTEX SHADER
const VERT = /* glsl */ `
    varying vec2 vWorldXZ;
    varying vec3 vWorldPosition; // Ditambahkan untuk kalkulasi view vector Fresnel

    void main() {
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldXZ = worldPos.xz;
        vWorldPosition = worldPos.xyz;
        
        gl_Position = projectionMatrix * viewMatrix * worldPos;
    }
`;

// FRAGMENT SHADER
const FRAG = /* glsl */ `
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

        // ponytail: early out for central battlefield (no forest factor, height is flat 0.0) to save fragment shader cost
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

    // Pembangkit Normal Ombak Prosedural
    vec3 getWaveNormal(vec2 p) {
        // Turunan dari fungsi sinus menghasilkan arah kemiringan ombak (normal)
        float wave1 = sin(p.x) * cos(p.y);
        vec3 n1 = vec3(-cos(p.x) * cos(p.y), 1.5, sin(p.x) * sin(p.y));
        return normalize(n1);
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

        float depthFactor = clamp(depth * 0.5, 0.0, 1.0);

        // 1. Ilusi Ombak 3D (Panning Normals)
        vec2 uv = vWorldXZ * 0.3;
        vec2 timeOffset = vec2(uTime * 0.4, uTime * 0.3);
        
        // Dua layer ombak bersilangan
        vec3 waveNormal1 = getWaveNormal(uv + timeOffset);
        vec3 waveNormal2 = getWaveNormal(uv * 1.5 - timeOffset * 1.2);
        
        // Blend normal (0.0, 1.0, 0.0 adalah base normal flat/atas)
        vec3 surfaceNormal = normalize(vec3(0.0, 1.0, 0.0) + (waveNormal1 + waveNormal2) * 0.3);

        // 2. Efek Fresnel (Refleksi Langit & Transparansi Kedalaman)
        vec3 viewDir = normalize(cameraPosition - vWorldPosition);
        
        // Schlick's approximation
        float fresnelDot = max(dot(viewDir, surfaceNormal), 0.0);
        float fresnel = pow(1.0 - fresnelDot, 3.0); 

        // Warna dasar air
        vec3 shallowColor = vec3(0.20, 0.60, 0.68);
        vec3 deepColor    = vec3(0.02, 0.12, 0.25);
        vec3 baseWaterColor = mix(shallowColor, deepColor, depthFactor);

        // [ponytail: universal shore foam] Sederhana tapi dinamis memanfaatkan kedalaman air
        float shoreFoamNoise = sin(vWorldXZ.x * 5.0 + uTime * 1.5) * cos(vWorldXZ.y * 5.0 + uTime * 1.2) * 0.5 + 0.5;
        float shoreDist = depth;
        float wavePulse = sin(shoreDist * 20.0 - uTime * 3.0) * 0.5 + 0.5;
        // Busa utama tepat di bibir pantai
        float shoreFoam = smoothstepGLSL(0.20, 0.0, shoreDist) * (0.7 + shoreFoamNoise * 0.3);
        // Riak ombak busa sekunder dekat pantai
        float waveFoam = smoothstepGLSL(0.12, 0.0, abs(shoreDist - 0.10 - wavePulse * 0.05)) * 0.4;
        float totalFoam = clamp(shoreFoam + waveFoam, 0.0, 1.0) * shoreFade;

        // Busa air (Foam) bereaksi pada batas dan distorsi normal (untuk danau)
        float foamRing  = smoothstepGLSL(0.60, 0.88, distCenter) * (1.0 - smoothstepGLSL(0.88, 1.08, distCenter));
        float foamNoise = sin(vWorldXZ.x * 16.0 + uTime * 2.0) * cos(vWorldXZ.y * 13.0 + uTime * 2.5);
        float lakeFoamIntensity = foamRing * (0.25 + foamNoise * 0.2) * 0.5 * shoreFade;
        
        float finalFoam = max(totalFoam, lakeFoamIntensity);

        vec3 waterWithFoam = mix(baseWaterColor, vec3(0.90, 0.95, 0.96), finalFoam);

        // [ponytail: cel-shaded shore waves] Garis riak ombak kartun yang lebih besar dan menjangkau lebih ke tengah
        float waveTravel = sin(depth * 14.0 - uTime * 3.5) * 0.5 + 0.5;
        float celWave = smoothstepGLSL(0.76, 0.85, waveTravel);
        // Menjangkau lebih ke tengah (depth hingga 1.8)
        float waveMask = smoothstepGLSL(1.80, 0.0, depth) * shoreFade;
        waterWithFoam = mix(waterWithFoam, vec3(0.90, 0.95, 0.98), celWave * waveMask * 0.75);

        // Caustics matahari yang terdistorsi oleh normal ombak
        float caustic = abs(sin((vWorldXZ.x + surfaceNormal.x) * 9.0 + uTime * 1.4) * 
                            sin((vWorldXZ.y + surfaceNormal.z) * 7.5 - uTime * 1.0));
        waterWithFoam += caustic * vec3(0.05, 0.12, 0.10) * depthFactor * 0.5;

        // Campurkan warna dasar air dengan warna langit berdasarkan Fresnel
        vec3 finalColor = mix(waterWithFoam, uSkyColor, fresnel * 0.7);

        // Alpha calculation: Pixel menghadap kamera lebih transparan, di tepi pantai lebih mulus
        float finalAlpha = mix(0.35, 0.9, depthFactor) * shoreFade;
        finalAlpha = clamp(finalAlpha + fresnel * 0.3 + finalFoam * 0.5, 0.0, 1.0); // Grazing angle & foam lebih solid

        gl_FragColor = vec4(finalColor, finalAlpha);
    }
`;

export class WaterSurface {
    meshes: THREE.Mesh[] = [];
    materials: THREE.ShaderMaterial[] = [];
    private lakeMeshes: THREE.Mesh[] = []; // Store lake meshes for LOD culling

    // Tambahkan sky color untuk pantulan Fresnel
    private skyColor = new THREE.Color(0.6, 0.75, 0.9);

    constructor(scene: THREE.Scene, uniforms: { uTime: { value: number } }) {
        for (const lake of LAKES) {
            const { mesh, mat } = this._buildLake(lake, uniforms);
            scene.add(mesh);
            this.meshes.push(mesh);
            this.materials.push(mat);
            this.lakeMeshes.push(mesh);
        }

        // River plane
        const riverGeo = new THREE.PlaneGeometry(900, 900);
        const riverMat = new THREE.ShaderMaterial({
            uniforms: {
                uTime: uniforms.uTime,
                uLakeCenter: { value: new THREE.Vector2(9999, 9999) },
                uLakeRadius: { value: new THREE.Vector2(1, 1) },
                uSkyColor: { value: this.skyColor },
            },
            vertexShader: VERT,
            fragmentShader: FRAG,
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
        });
        const riverMesh = new THREE.Mesh(riverGeo, riverMat);
        riverMesh.name = "water";
        riverMesh.userData.excludeOcclusion = true;
        riverMesh.rotation.x = -Math.PI / 2;
        riverMesh.position.set(0, -3.0, 0);
        riverMesh.frustumCulled = false;
        riverMesh.renderOrder = 1;
        scene.add(riverMesh);
        this.meshes.push(riverMesh);
        this.materials.push(riverMat);
    }

    update(camPos: THREE.Vector3) {
        // LOD: Cull lakes that are too far from the camera
        const LOD_DIST_SQ = 260.0 * 260.0;
        for (const mesh of this.lakeMeshes) {
            const dx = mesh.position.x - camPos.x;
            const dz = mesh.position.z - camPos.z;
            const distSq = dx * dx + dz * dz;
            mesh.visible = distSq < LOD_DIST_SQ;
        }
    }

    private _buildLake(
        lake: LakeDef,
        uniforms: { uTime: { value: number } },
    ): { mesh: THREE.Mesh; mat: THREE.ShaderMaterial } {
        const width = lake.rx * 2.6;
        const height = lake.rz * 2.6;
        const geo = new THREE.PlaneGeometry(width, height);

        const mat = new THREE.ShaderMaterial({
            uniforms: {
                uTime: uniforms.uTime,
                uLakeCenter: { value: new THREE.Vector2(lake.cx, lake.cz) },
                uLakeRadius: { value: new THREE.Vector2(lake.rx, lake.rz) },
                uSkyColor: { value: this.skyColor },
            },
            vertexShader: VERT,
            fragmentShader: FRAG,
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
        });

        const mesh = new THREE.Mesh(geo, mat);
        mesh.name = "water";
        mesh.userData.excludeOcclusion = true;
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.set(lake.cx, -3.0, lake.cz);
        mesh.frustumCulled = false;
        mesh.renderOrder = 1;

        return { mesh, mat };
    }
}
