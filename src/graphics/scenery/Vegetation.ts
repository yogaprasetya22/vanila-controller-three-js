import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { getTerrainHeight } from '../../simulation/constants';
import vegetationData from './vegetationData.json';

export class Vegetation {
  constructor(scene: THREE.Scene, gltfLoader: GLTFLoader, uniforms: { uTime: { value: number } }) {
    const activeVegetationData = vegetationData.filter((data, idx) => {
      // Sub-sample to keep triangle count down
      if (idx % 2 !== 0) return false;
      const h = getTerrainHeight(data.x, data.z);
      return h >= 0.8; // Dry land only (above lakes & shores)
    });

    // ponytail: procedurally generate vegetation on the outskirts to populate the 2400x2400 world
    let seed = 12345;
    const prng = () => {
      const x = Math.sin(seed++) * 10000;
      return x - Math.floor(x);
    };

    const vegTypes = Array.from(new Set(vegetationData.map(v => v.type)));
    if (vegTypes.length > 0) {
      for (let i = 0; i < 400; i++) {
        const rx = (prng() - 0.5) * 2300;
        const rz = (prng() - 0.5) * 2300;
        if (Math.abs(rx) < 100 && Math.abs(rz) < 100) continue; // Skip battlefield area

        const h = getTerrainHeight(rx, rz);
        if (h < 0.8) continue; // Dry land only

        activeVegetationData.push({
          x: rx,
          z: rz,
          type: vegTypes[Math.floor(prng() * vegTypes.length)],
          scale: 0.8 + prng() * 1.0,
          rotation: prng() * Math.PI * 2
        });
      }
    }

    const uniqueTypes = Array.from(new Set(activeVegetationData.map(v => v.type)));

    const promises = uniqueTypes.map(name => {
      return new Promise<THREE.Group>((resolve) => {
        const baseUrl = import.meta.env.BASE_URL;
        gltfLoader.load(`${baseUrl}environment/vegetation/${name}.glb`, (gltf) => {
          gltf.scene.traverse((child) => {
            if ((child as THREE.Mesh).isMesh) {
              const mesh = child as THREE.Mesh;
              mesh.castShadow = false;
              mesh.receiveShadow = false;
              if (mesh.material) {
                const mat = mesh.material as THREE.MeshStandardMaterial;
                mat.roughness = 0.95;
                mat.flatShading = true;

                // Suntikkan Shader Angin
                mat.onBeforeCompile = (shader) => {
                  shader.uniforms.uTime = uniforms.uTime;

                  // Deklarasikan uTime di atas
                  shader.vertexShader = `
                    uniform float uTime;
                  ` + shader.vertexShader;

                  // Modifikasi posisi vertex sebelum di-render
                  shader.vertexShader = shader.vertexShader.replace(
                    '#include <begin_vertex>',
                    `
                    #include <begin_vertex>
                    
                    // Ambil posisi dunia instans untuk variasi angin per tanaman
                    vec4 worldPos = instanceMatrix * vec4(position, 1.0);
                    
                    // Kalkulasi angin persis seperti di Grass.ts tetapi dengan amplitudo lebih besar agar terlihat jelas
                    float wind1 = sin(uTime * 1.8 + worldPos.x * 0.8 + worldPos.z * 0.8) * 0.45;
                    float wind2 = sin(uTime * 3.5 + worldPos.x * 1.8 + worldPos.z * 1.2) * 0.15;
                    float wind = (wind1 + wind2);
                    
                    // Batasi gerakan hanya untuk vertex bagian atas (y > 0) dengan faktor pengali lebih sensitif
                    float heightFactor = clamp(position.y * 2.0 + 0.2, 0.2, 2.0); 
                    
                    transformed.x += wind * heightFactor;
                    transformed.z += wind * 0.35 * heightFactor;
                    `
                  );
                };
              }
            }
          });
          resolve(gltf.scene);
        }, undefined, () => resolve(new THREE.Group()));
      });
    });

    Promise.all(promises).then((loadedModels) => {
      const templates: Record<string, THREE.Group> = {};
      uniqueTypes.forEach((name, index) => {
        const model = loadedModels[index];
        if (model && model.children.length > 0) {
          templates[name] = model;
        }
      });

      uniqueTypes.forEach((name) => {
        const template = templates[name];
        if (!template) return;

        const instances = activeVegetationData.filter(v => v.type === name);
        const count = instances.length;
        if (count === 0) return;

        const meshesInfo: { mesh: THREE.Mesh; relativeMatrix: THREE.Matrix4 }[] = [];
        template.updateMatrixWorld(true);
        template.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            const mesh = child as THREE.Mesh;
            const relativeMatrix = new THREE.Matrix4();
            let current: THREE.Object3D | null = mesh;
            while (current && current !== template) {
              current.updateMatrix();
              relativeMatrix.premultiply(current.matrix);
              current = current.parent;
            }
            meshesInfo.push({ mesh, relativeMatrix });
          }
        });

        meshesInfo.forEach(({ mesh, relativeMatrix }) => {
          const instancedMesh = new THREE.InstancedMesh(
            mesh.geometry,
            mesh.material,
            count
          );

          instancedMesh.name = name;
          instancedMesh.castShadow = false;
          instancedMesh.receiveShadow = false;
          instancedMesh.frustumCulled = false;

          const position = new THREE.Vector3();
          const rotation = new THREE.Euler();
          const quaternion = new THREE.Quaternion();
          const scale = new THREE.Vector3();
          const instanceMatrix = new THREE.Matrix4();
          const finalMatrix = new THREE.Matrix4();

          const enrichedInstances = instances.map((data) => {
            const groundY = getTerrainHeight(data.x, data.z);
            const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, data.rotation, 0));
            return {
              ...data,
              groundY,
              qx: q.x,
              qy: q.y,
              qz: q.z,
              qw: q.w
            };
          });

          enrichedInstances.forEach((data, index) => {
            position.set(data.x, data.groundY, data.z);
            quaternion.set(data.qx, data.qy, data.qz, data.qw);
            scale.set(data.scale, data.scale, data.scale);

            instanceMatrix.compose(position, quaternion, scale);
            finalMatrix.multiplyMatrices(instanceMatrix, relativeMatrix);

            instancedMesh.setMatrixAt(index, finalMatrix);
          });

          instancedMesh.instanceMatrix.needsUpdate = true;
          scene.add(instancedMesh);
          this.instancedMeshes.push({ meshList: instancedMesh, instances: enrichedInstances, relativeMatrix });
        });
      });
    });
  }

  private instancedMeshes: Array<{
    meshList: THREE.InstancedMesh;
    instances: Array<{ x: number; z: number; scale: number; rotation: number; groundY: number; qx: number; qy: number; qz: number; qw: number }>;
    relativeMatrix: THREE.Matrix4;
  }> = [];

  private lastUpdatePos = new THREE.Vector3(9999, 9999, 9999);
  private lastUpdateQuat = new THREE.Quaternion();
  private needsFirstUpdate = true;

  private static _scratchPos = new THREE.Vector3();
  private static _scratchQuat = new THREE.Quaternion();
  private static _scratchScale = new THREE.Vector3();
  private static _scratchInstMat = new THREE.Matrix4();
  private static _scratchFinalMat = new THREE.Matrix4();
  private static _scratchSphere = new THREE.Sphere();
  private static _projScreenMatrix = new THREE.Matrix4();
  private static _frustum = new THREE.Frustum();

  public update(cameraOrPos: THREE.Camera | THREE.Vector3) {
    if (this.instancedMeshes.length === 0) return;

    const isCamera = (cameraOrPos as THREE.Camera).isCamera;
    const camera = isCamera ? (cameraOrPos as THREE.Camera) : null;
    const cameraPos = isCamera ? (cameraOrPos as THREE.Camera).position : (cameraOrPos as THREE.Vector3);

    let camMoved = this.lastUpdatePos.distanceToSquared(cameraPos) > 0.35;
    let camRotated = false;
    if (camera) {
      camRotated = this.lastUpdateQuat.angleTo(camera.quaternion) > 0.035;
    }

    if (!this.needsFirstUpdate && !camMoved && !camRotated) {
      return;
    }
    this.needsFirstUpdate = false;
    this.lastUpdatePos.copy(cameraPos);
    if (camera) {
      this.lastUpdateQuat.copy(camera.quaternion);
      Vegetation._projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      Vegetation._frustum.setFromProjectionMatrix(Vegetation._projScreenMatrix);
    }

    const MAX_DIST_SQ = 80 * 80; // Vegetation culls at 80m

    const pos = Vegetation._scratchPos;
    const quat = Vegetation._scratchQuat;
    const scl = Vegetation._scratchScale;
    const instMat = Vegetation._scratchInstMat;
    const finalMat = Vegetation._scratchFinalMat;
    const sphere = Vegetation._scratchSphere;
    const frustum = Vegetation._frustum;

    for (let g = 0; g < this.instancedMeshes.length; g++) {
      const group = this.instancedMeshes[g];
      const mesh = group.meshList;
      const instances = group.instances;
      let visibleCount = 0;

      for (let i = 0; i < instances.length; i++) {
        const data = instances[i];
        const dx = data.x - cameraPos.x;
        const dz = data.z - cameraPos.z;
        const distSq = dx * dx + dz * dz;

        // 1. Distance culling (80m)
        if (distSq > MAX_DIST_SQ) {
          continue;
        }

        // 2. Camera Frustum Culling
        if (camera) {
          sphere.center.set(data.x, data.groundY + data.scale * 0.8, data.z);
          sphere.radius = data.scale * 2.0;
          if (!frustum.intersectsSphere(sphere)) {
            continue;
          }
        }

        pos.set(data.x, data.groundY, data.z);
        quat.set(data.qx, data.qy, data.qz, data.qw);
        scl.set(data.scale, data.scale, data.scale);

        instMat.compose(pos, quat, scl);
        finalMat.multiplyMatrices(instMat, group.relativeMatrix);
        mesh.setMatrixAt(visibleCount++, finalMat);
      }

      if (mesh.count !== visibleCount) {
        mesh.count = visibleCount;
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  public getNearbyInstanceMeshes(playerPos: THREE.Vector3, radius: number = 15) {
    const radiusSq = radius * radius;
    const result: Array<{ geometry: THREE.BufferGeometry; matrix: THREE.Matrix4 }> = [];

    const position = new THREE.Vector3();
    const rotation = new THREE.Euler();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const instanceMatrix = new THREE.Matrix4();

    for (const group of this.instancedMeshes) {
      group.instances.forEach((data) => {
        const dx = data.x - playerPos.x;
        const dz = data.z - playerPos.z;
        if (dx * dx + dz * dz <= radiusSq) {
          const groundY = getTerrainHeight(data.x, data.z);
          position.set(data.x, groundY, data.z);
          rotation.set(0, data.rotation, 0);
          quaternion.setFromEuler(rotation);
          scale.set(data.scale, data.scale, data.scale);

          instanceMatrix.compose(position, quaternion, scale);

          const finalMatrix = new THREE.Matrix4();
          finalMatrix.multiplyMatrices(instanceMatrix, group.relativeMatrix);

          result.push({
            geometry: group.meshList.geometry,
            matrix: finalMatrix
          });
        }
      });
    }
    return result;
  }
}
