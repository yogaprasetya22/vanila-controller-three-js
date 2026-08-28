import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { getTerrainHeight } from '../../simulation/constants';
import rocksData from './rocksData.json';

export class Rocks {
  constructor(scene: THREE.Scene, gltfLoader: GLTFLoader) {
    const activeRocksData = rocksData.filter((data, idx) => {
      // Sub-sample to keep triangle count down
      if (idx % 2 !== 0) return false;
      const h = getTerrainHeight(data.x, data.z);
      return h >= 0.2; // Dry land only
    });

    const uniqueTypes = Array.from(new Set(activeRocksData.map(r => r.type)));

    const promises = uniqueTypes.map(name => {
      return new Promise<THREE.Group>((resolve) => {
        const baseUrl = import.meta.env.BASE_URL;
        gltfLoader.load(`${baseUrl}environment/rocks/${name}.glb`, (gltf) => {
          gltf.scene.traverse((child) => {
            if ((child as THREE.Mesh).isMesh) {
              const mesh = child as THREE.Mesh;
              mesh.castShadow = false;
              mesh.receiveShadow = false;
              if (mesh.material) {
                const mat = mesh.material as THREE.MeshStandardMaterial;
                mat.roughness = 0.9;
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

      uniqueTypes.forEach((name) => {
        const template = templates[name];
        if (!template) return;

        const instances = activeRocksData.filter(r => r.type === name);
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

          instances.forEach((data, index) => {
            const groundY = getTerrainHeight(data.x, data.z);
            position.set(data.x, groundY - 0.1, data.z); // slightly sink into ground
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

    if (!this.needsFirstUpdate && this.lastUpdatePos.distanceToSquared(cameraPos) < 1.0) {
      return;
    }
    this.needsFirstUpdate = false;
    this.lastUpdatePos.copy(cameraPos);

    const MAX_DIST_SQ = 80 * 80; // Rocks cull at 80m

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

        let currentScale = data.scale;
        if (distSq > MAX_DIST_SQ) {
          currentScale = 0.0;
        }

        if (currentScale > 0.0) {
          activeInstances.push({ data, currentScale });
        }
      });

      activeInstances.forEach((inst, index) => {
        const data = inst.data;
        const groundY = getTerrainHeight(data.x, data.z);
        position.set(data.x, groundY - 0.1, data.z);
        rotation.set(0, data.rotation, 0);
        quaternion.setFromEuler(rotation);
        scale.set(inst.currentScale, inst.currentScale, inst.currentScale);

        instanceMatrix.compose(position, quaternion, scale);
        finalMatrix.multiplyMatrices(instanceMatrix, group.relativeMatrix);
        mesh.setMatrixAt(index, finalMatrix);
      });

      if (mesh.count !== activeInstances.length) {
        mesh.count = activeInstances.length;
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
  }
}
