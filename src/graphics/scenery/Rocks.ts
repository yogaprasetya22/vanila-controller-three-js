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

    // ponytail: procedurally generate rocks on the outskirt mountains/forests to populate the 900x900 world
    let seed = 54321;
    const prng = () => {
      const x = Math.sin(seed++) * 10000;
      return x - Math.floor(x);
    };

    const rockTypes = Array.from(new Set(rocksData.map(r => r.type)));
    if (rockTypes.length > 0) {
      for (let i = 0; i < 200; i++) {
        const rx = (prng() - 0.5) * 820;
        const rz = (prng() - 0.5) * 820;
        if (Math.abs(rx) < 100 && Math.abs(rz) < 100) continue; // Skip battlefield area

        const h = getTerrainHeight(rx, rz);
        if (h < 0.2) continue; // Dry land only

        activeRocksData.push({
          x: rx,
          z: rz,
          type: rockTypes[Math.floor(prng() * rockTypes.length)],
          scale: 0.8 + prng() * 1.4,
          rotation: prng() * Math.PI * 2
        });
      }
    }

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
          instancedMesh.userData.isRock = true;

          // Compute exact local bounding sphere from the original geometry
          if (!mesh.geometry.boundingSphere) {
            mesh.geometry.computeBoundingSphere();
          }
          const localSphere = mesh.geometry.boundingSphere!.clone();
          localSphere.applyMatrix4(relativeMatrix); // transform to template space

          // Temp variables to compose instance matrices
          const position = new THREE.Vector3();
          const rotation = new THREE.Euler();
          const quaternion = new THREE.Quaternion();
          const scale = new THREE.Vector3();
          const instanceMatrix = new THREE.Matrix4();
          const finalMatrix = new THREE.Matrix4();

          instances.forEach((data, index) => {
            const groundY = getTerrainHeight(data.x, data.z);
            const groundX = getTerrainHeight(data.x + 1.0, data.z);
            const groundZ = getTerrainHeight(data.x, data.z + 1.0);
            const dx = groundX - groundY;
            const dz = groundZ - groundY;
            const len = Math.sqrt(dx * dx + 1.0 + dz * dz);
            const normal = new THREE.Vector3(-dx / len, 1.0 / len, -dz / len);

            const sink = 0.25 * data.scale;
            position.set(data.x, groundY - sink, data.z);
            
            quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
            const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), data.rotation);
            quaternion.multiply(yaw);
            
            scale.set(data.scale, data.scale, data.scale);

            instanceMatrix.compose(position, quaternion, scale);
            finalMatrix.multiplyMatrices(instanceMatrix, relativeMatrix);

            instancedMesh.setMatrixAt(index, finalMatrix);
          });

          instancedMesh.instanceMatrix.needsUpdate = true;
          scene.add(instancedMesh);
          this.instancedMeshes.push({ 
            meshList: instancedMesh, 
            instances, 
            relativeMatrix,
            localSphere
          });
        });
      });
    });
  }

  private instancedMeshes: Array<{
    meshList: THREE.InstancedMesh;
    instances: Array<{ x: number; z: number; scale: number; rotation: number }>;
    relativeMatrix: THREE.Matrix4;
    localSphere: THREE.Sphere;
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
        const groundX = getTerrainHeight(data.x + 1.0, data.z);
        const groundZ = getTerrainHeight(data.x, data.z + 1.0);
        const dx = groundX - groundY;
        const dz = groundZ - groundY;
        const len = Math.sqrt(dx * dx + 1.0 + dz * dz);
        const normal = new THREE.Vector3(-dx / len, 1.0 / len, -dz / len);

        const sink = 0.25 * inst.currentScale;
        position.set(data.x, groundY - sink, data.z);

        quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
        const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), data.rotation);
        quaternion.multiply(yaw);

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

  public getNearbyColliders(playerPos: THREE.Vector3, radius: number = 5) {
    const radiusSq = radius * radius;
    const colliders: Array<{ x: number; z: number; radius: number }> = [];
    const seen = new Set<string>();

    for (const group of this.instancedMeshes) {
      for (const data of group.instances) {
        const key = `${data.x.toFixed(1)},${data.z.toFixed(1)}`;
        if (seen.has(key)) continue;

        const dx = data.x - playerPos.x;
        const dz = data.z - playerPos.z;
        if (dx * dx + dz * dz <= radiusSq) {
          seen.add(key);
          // Radius rintangan batu (0.6 dikali skala agar lebih pas dan tidak macet)
          colliders.push({ x: data.x, z: data.z, radius: data.scale * 0.6 }); 
        }
      }
    }
    return colliders;
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
          const groundX = getTerrainHeight(data.x + 1.0, data.z);
          const groundZ = getTerrainHeight(data.x, data.z + 1.0);
          const diffX = groundX - groundY;
          const diffZ = groundZ - groundY;
          const len = Math.sqrt(diffX * diffX + 1.0 + diffZ * diffZ);
          const normal = new THREE.Vector3(-diffX / len, 1.0 / len, -diffZ / len);

          const sink = 0.25 * data.scale;
          position.set(data.x, groundY - sink, data.z);

          quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
          const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), data.rotation);
          quaternion.multiply(yaw);

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

  public getNearbyCollisionSpheres(playerPos: THREE.Vector3, radius: number = 5) {
    const radiusSq = radius * radius;
    const spheres: Array<{ center: THREE.Vector3; radius: number }> = [];

    for (const group of this.instancedMeshes) {
      group.instances.forEach((data) => {
        const dx = data.x - playerPos.x;
        const dz = data.z - playerPos.z;
        if (dx * dx + dz * dz <= radiusSq) {
          // Transform local template sphere center to world space for this instance
          const worldCenter = group.localSphere.center.clone();
          worldCenter.multiplyScalar(data.scale);
          worldCenter.applyAxisAngle(new THREE.Vector3(0, 1, 0), data.rotation);

          const groundY = getTerrainHeight(data.x, data.z);
          worldCenter.x += data.x;
          worldCenter.y += groundY - 0.1;
          worldCenter.z += data.z;

          const worldRadius = group.localSphere.radius * data.scale;

          spheres.push({
            center: worldCenter,
            radius: worldRadius
          });
        }
      });
    }
    return spheres;
  }
}
