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
    uniform vec3  uSkyColor;
    uniform sampler2D uWaterColorTex;
    uniform sampler2D uWaterNormTex;
    uniform sampler2D uWaterSpecTex;
    
    varying vec2  vWorldXZ;
    varying vec3  vWorldPosition;

    void main() {
        // 1. Dual Scrolled Normal Map Sampling (Flowing animated liquid waves)
        vec2 uv1 = vWorldXZ * 0.055 + vec2(uTime * 0.015, uTime * 0.012);
        vec2 uv2 = vWorldXZ * 0.038 - vec2(uTime * 0.012, uTime * 0.018);
        vec3 n1 = texture2D(uWaterNormTex, uv1).rgb * 2.0 - 1.0;
        vec3 n2 = texture2D(uWaterNormTex, uv2).rgb * 2.0 - 1.0;
        vec3 surfaceNormal = normalize(vec3(n1.x + n2.x, 2.2, n1.y + n2.y));

        // 2. Texture Sample for Color & Specular Map
        vec4 texWaterCol = texture2D(uWaterColorTex, uv1);
        float specTexVal = texture2D(uWaterSpecTex, uv2).r;

        // 3. Efek Fresnel (Refleksi Langit & Transparansi Kedalaman)
        vec3 viewDir = normalize(cameraPosition - vWorldPosition);
        float fresnelDot = max(dot(viewDir, surfaceNormal), 0.0);
        float fresnel = pow(1.0 - fresnelDot, 3.2); 

        // 4. Gradasi Warna Air Stylized Anime
        vec3 shallowColor = vec3(0.18, 0.72, 0.88);
        vec3 deepColor    = vec3(0.04, 0.16, 0.36);
        vec3 baseWaterColor = mix(shallowColor, deepColor, 0.45);
        baseWaterColor = mix(baseWaterColor, texWaterCol.rgb * 1.15, 0.40);

        // 5. Kilau Pantulan Matahari / Specular Sun Reflection
        vec3 sunDir = normalize(vec3(0.5, 0.75, 0.4));
        vec3 halfVec = normalize(viewDir + sunDir);
        float spec = pow(max(dot(surfaceNormal, halfVec), 0.0), 38.0) * (specTexVal * 1.5 + 0.5);
        vec3 sunSpecular = vec3(1.0, 0.96, 0.84) * spec * 0.65;
        vec3 waterWithGlint = baseWaterColor + sunSpecular;

        // 6. Campurkan warna dasar air dengan warna langit berdasarkan Fresnel
        vec3 finalColor = mix(waterWithGlint, uSkyColor, fresnel * 0.55);

        float finalAlpha = clamp(0.88 + fresnel * 0.10, 0.0, 0.98);

        gl_FragColor = vec4(finalColor, finalAlpha);
        #include <fog_fragment>
    }
`;

export class WaterSurface {
    meshes: THREE.Mesh[] = [];
    materials: THREE.ShaderMaterial[] = [];
    private skyColor = new THREE.Color(0.6, 0.75, 0.9);

    constructor(scene: THREE.Scene, uniforms: { uTime: { value: number } }) {
        const baseUrl = import.meta.env.BASE_URL;
        const texLoader = new THREE.TextureLoader();

        const loadWaterTex = (path: string): THREE.Texture => {
            const tex = texLoader.load(path);
            tex.wrapS = THREE.RepeatWrapping;
            tex.wrapT = THREE.RepeatWrapping;
            tex.generateMipmaps = true;
            tex.minFilter = THREE.LinearMipmapLinearFilter;
            return tex;
        };

        const waterColorTex = loadWaterTex(`${baseUrl}textures/water/Water_001_COLOR.jpg`);
        waterColorTex.colorSpace = THREE.SRGBColorSpace;
        const waterNormTex  = loadWaterTex(`${baseUrl}textures/water/Water_001_NORM.jpg`);
        const waterSpecTex  = loadWaterTex(`${baseUrl}textures/water/Water_001_SPEC.jpg`);

        // ponytail: Single unified 2400x2400 water plane covering all lakes and rivers across the expanded world.
        const waterGeo = new THREE.PlaneGeometry(2400, 2400);
        const waterUniforms = THREE.UniformsUtils.merge([
            THREE.UniformsLib.fog,
            {
                uTime: uniforms.uTime,
                uSkyColor: { value: this.skyColor },
                uWaterColorTex: { value: waterColorTex },
                uWaterNormTex:  { value: waterNormTex },
                uWaterSpecTex:  { value: waterSpecTex },
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
