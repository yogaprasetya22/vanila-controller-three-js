import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { getTerrainHeight } from '../../simulation/constants';
import treesData from './treesData.json';

// Shared module-level state for tree positions
export const treePositions: THREE.Vector3[] = [];

export class Trees {
  constructor(scene: THREE.Scene, gltfLoader: GLTFLoader) {
    treePositions.length = 0;
    // Sub-sample treesData (1 tree out of 4) to slash triangle count
    // ponytail: filter out any static tree coordinates that land below water levels (Y < 0.2)
    const activeTreesData = treesData.filter((data, idx) => {
      if (idx % 4 !== 0) return false;
      const h = getTerrainHeight(data.x, data.z);
      return h >= 0.2; // Keep only if it's on dry land
    });

    // ponytail: procedurally generate endless trees beyond battlefield boundaries to fit the expanded 900x900 world
    let seed = 98765;
    const prng = () => {
      const x = Math.sin(seed++) * 10000;
      return x - Math.floor(x);
    };

    const treeTypes = ["Pine_1", "BirchTree_2", "MapleTree_1"];
    // Generate 350 random trees on the outskirt mountains/forests deterministically
    for (let i = 0; i < 350; i++) {
      const rx = (prng() - 0.5) * 820;
      const rz = (prng() - 0.5) * 820;
      // Skip the central battlefield
      if (Math.abs(rx) < 50 && Math.abs(rz) < 50) continue;
      
      const h = getTerrainHeight(rx, rz);
      if (h < 0.2) continue; // no trees inside lakes/rivers

      activeTreesData.push({
        x: rx,
        z: rz,
        type: treeTypes[Math.floor(prng() * treeTypes.length)],
        scale: 1.5 + prng() * 2.2,
        rotation: prng() * Math.PI * 2
      });
    }

    const uniqueTypes = Array.from(new Set(activeTreesData.map(t => t.type)));

    const promises = uniqueTypes.map(name => {
      return new Promise<THREE.Group>((resolve) => {
        const baseUrl = import.meta.env.BASE_URL;
        gltfLoader.load(`${baseUrl}environment/trees/${name}.glb`, (gltf) => {
          gltf.scene.traverse((child) => {
            if ((child as THREE.Mesh).isMesh) {
              const mesh = child as THREE.Mesh;
              mesh.castShadow = false;
              mesh.receiveShadow = false;
              if (mesh.material) {
                const mat = mesh.material as THREE.MeshStandardMaterial;
                mat.roughness = 0.95;
                mat.flatShading = true;
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

      // Pre-populate treePositions since it is used elsewhere
      activeTreesData.forEach((data) => {
        const groundY = getTerrainHeight(data.x, data.z);
        treePositions.push(new THREE.Vector3(data.x, groundY, data.z));
      });

      // Create InstancedMesh for each unique tree type
      uniqueTypes.forEach((name) => {
        const template = templates[name];
        if (!template) return;

        const instances = activeTreesData.filter(t => t.type === name);
        const count = instances.length;
        if (count === 0) return;

        // Traverse template and collect meshes with their relative transform matrices
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

        // Create an InstancedMesh for each sub-mesh found in the template
        meshesInfo.forEach(({ mesh, relativeMatrix }) => {
          const instancedMesh = new THREE.InstancedMesh(
            mesh.geometry,
            mesh.material,
            count
          );

          instancedMesh.name = name;
          instancedMesh.userData.isTree = true;
          instancedMesh.castShadow = false;
          instancedMesh.receiveShadow = false;
          instancedMesh.frustumCulled = false; // Disable frustum culling since we handle LOD distance culling manually in update()

          // Temp variables to compose instance matrices
          const position = new THREE.Vector3();
          const rotation = new THREE.Euler();
          const quaternion = new THREE.Quaternion();
          const scale = new THREE.Vector3();
          const instanceMatrix = new THREE.Matrix4();
          const finalMatrix = new THREE.Matrix4();

          instances.forEach((data, index) => {
            const groundY = getTerrainHeight(data.x, data.z);
            position.set(data.x, groundY, data.z);
            rotation.set(0, data.rotation, 0);
            quaternion.setFromEuler(rotation);
            scale.set(data.scale, data.scale, data.scale);

            instanceMatrix.compose(position, quaternion, scale);
            finalMatrix.multiplyMatrices(instanceMatrix, relativeMatrix);

            instancedMesh.setMatrixAt(index, finalMatrix);
          });

          instancedMesh.instanceMatrix.needsUpdate = true;
          scene.add(instancedMesh);
          this.instancedMeshes.push({ meshList: instancedMesh, instances, relativeMatrix });
        });
      });
    });
  }

  private instancedMeshes: Array<{
    meshList: THREE.InstancedMesh;
    instances: Array<{ x: number; z: number; scale: number; rotation: number }>;
    relativeMatrix: THREE.Matrix4;
  }> = [];

  private lastUpdatePos = new THREE.Vector3(9999, 9999, 9999);
  private needsFirstUpdate = true;

  public update(cameraPos: THREE.Vector3) {
    if (this.instancedMeshes.length === 0) return;

    // ponytail: throttle LOD calculations to avoid doing matrix composition for all 350+ trees every frame
    if (!this.needsFirstUpdate && this.lastUpdatePos.distanceToSquared(cameraPos) < 0.25) {
      return;
    }
    this.needsFirstUpdate = false;
    this.lastUpdatePos.copy(cameraPos);

    // ponytail: Dynamic LOD tree distance culling (100m)
    const MAX_DIST_SQ = 100 * 100; // 100 meters
    const FADE_START_SQ = 85 * 85;

    const position = new THREE.Vector3();
    const rotation = new THREE.Euler();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const instanceMatrix = new THREE.Matrix4();
    const finalMatrix = new THREE.Matrix4();

    for (const group of this.instancedMeshes) {
      const mesh = group.meshList;
      const activeInstances: { data: typeof group.instances[0]; currentScale: number }[] = [];

      group.instances.forEach((data) => {
        const dx = data.x - cameraPos.x;
        const dz = data.z - cameraPos.z;
        const distSq = dx * dx + dz * dz;
        
        const cullRadius = 2.0 + data.scale * 1.5; // dynamically scale cull radius with tree scale
        const cullRadiusSq = cullRadius * cullRadius;

        let currentScale = data.scale;
        if (distSq > MAX_DIST_SQ) {
          currentScale = 0.0; // Cull far away
        } else if (distSq < cullRadiusSq) {
          currentScale = 0.0; // Cull close-up when camera enters tree leaves to prevent lag
        } else if (distSq > FADE_START_SQ) {
          const dist = Math.sqrt(distSq);
          const fade = 1.0 - (dist - 85) / 15;
          currentScale *= fade; // Fade
        }

        if (currentScale > 0.0) {
          activeInstances.push({ data, currentScale });
        }
      });

      // Write visible instances first
      activeInstances.forEach((inst, index) => {
        const data = inst.data;
        const groundY = getTerrainHeight(data.x, data.z);
        position.set(data.x, groundY, data.z);
        rotation.set(0, data.rotation, 0);
        quaternion.setFromEuler(rotation);
        scale.set(inst.currentScale, inst.currentScale, inst.currentScale);

        instanceMatrix.compose(position, quaternion, scale);
        finalMatrix.multiplyMatrices(instanceMatrix, group.relativeMatrix);
        mesh.setMatrixAt(index, finalMatrix);
      });

      // Set mesh.count so the GPU draw call skips all culled trees (cuts triangles count from 1.5M to ~80k!)
      if (mesh.count !== activeInstances.length) {
        mesh.count = activeInstances.length;
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
  }
}
