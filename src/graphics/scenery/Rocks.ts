import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { getTerrainHeight } from '../../simulation/constants';
import rocksData from './rocksData.json';

export class Rocks {
  constructor(scene: THREE.Scene, gltfLoader: GLTFLoader) {
    const activeRocksData = rocksData.filter((data, idx) => {
      // Sub-sample to keep triangle count down
      if (idx % 3 !== 0) return false;
      const h = getTerrainHeight(data.x, data.z);
      return h >= 0.2; // Dry land only
    });

    // ponytail: procedurally generate rocks and towering cliff formations on the outskirt mountains
    let seed = 54321;
    const prng = () => {
      const x = Math.sin(seed++) * 10000;
      return x - Math.floor(x);
    };

    const rockTypes = Array.from(new Set(rocksData.map(r => r.type)));
    if (rockTypes.length > 0) {
      // 1. Scatter natural landscape boulders
      for (let i = 0; i < 60; i++) {
        const rx = (prng() - 0.5) * 2300;
        const rz = (prng() - 0.5) * 2300;
        if (Math.abs(rx) < 95 && Math.abs(rz) < 85) continue; // Skip battlefield area

        const h = getTerrainHeight(rx, rz);
        if (h < 0.2) continue; // Dry land only

        activeRocksData.push({
          x: rx,
          z: rz,
          type: rockTypes[Math.floor(prng() * rockTypes.length)],
          scale: 1.0 + prng() * 1.5,
          rotation: prng() * Math.PI * 2
        });
      }

      // 2. Form massive 3D cliff rock walls along steep mountain ridges & plateaus
      for (let i = 0; i < 75; i++) {
        const rx = (prng() - 0.5) * 2300;
        const rz = (prng() - 0.5) * 2300;
        if (Math.abs(rx) < 95 && Math.abs(rz) < 85) continue;

        const h = getTerrainHeight(rx, rz);
        if (h < 3.0) continue; // Elevated ridges only

        // Check slope magnitude
        const dhx = getTerrainHeight(rx + 1.5, rz) - getTerrainHeight(rx - 1.5, rz);
        const dhz = getTerrainHeight(rx, rz + 1.5) - getTerrainHeight(rx, rz - 1.5);
        const slopeMag = Math.sqrt(dhx * dhx + dhz * dhz);

        if (slopeMag > 0.30) {
          const slopeAngle = Math.atan2(dhz, dhx);
          activeRocksData.push({
            x: rx,
            z: rz,
            type: rockTypes[Math.floor(prng() * rockTypes.length)],
            scale: 2.8 + prng() * 3.8, // Grand towering cliff scale
            rotation: slopeAngle + (prng() - 0.5) * 0.4
          });
        }
      }
    }

    const uniqueTypes = Array.from(new Set(activeRocksData.map(r => r.type)));
    const baseUrl = import.meta.env.BASE_URL;
    const texLoader = new THREE.TextureLoader();
    const rockBaseTex = texLoader.load(`${baseUrl}textures/rocks/Stylized_Rocks_003_basecolor.png`);
    rockBaseTex.colorSpace = THREE.SRGBColorSpace;

    const promises = uniqueTypes.map(name => {
      return new Promise<THREE.Group>((resolve) => {
        gltfLoader.load(`${baseUrl}environment/rocks/${name}.glb`, (gltf) => {
          gltf.scene.traverse((child) => {
            if ((child as THREE.Mesh).isMesh) {
              const mesh = child as THREE.Mesh;
              mesh.castShadow = false;
              mesh.receiveShadow = false;
              if (mesh.material) {
                const mat = mesh.material as THREE.MeshStandardMaterial;
                mat.map = rockBaseTex;
                mat.roughness = 0.88;
                mat.metalness = 0.02;
                mat.needsUpdate = true;
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

          const enrichedInstances = instances.map((data) => {
            const groundY = getTerrainHeight(data.x, data.z);
            const groundX = getTerrainHeight(data.x + 1.0, data.z);
            const groundZ = getTerrainHeight(data.x, data.z + 1.0);
            const dx = groundX - groundY;
            const dz = groundZ - groundY;
            const len = Math.sqrt(dx * dx + 1.0 + dz * dz);
            const normal = new THREE.Vector3(-dx / len, 1.0 / len, -dz / len);
            // Seamlessly anchor cliff rocks and boulders into the floor mesh
            const sink = (data.scale >= 3.0 ? 0.38 : 0.28) * data.scale;

            const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
            const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), data.rotation);
            q.multiply(yaw);

            return {
              ...data,
              groundY,
              sink,
              qx: q.x,
              qy: q.y,
              qz: q.z,
              qw: q.w
            };
          });

          enrichedInstances.forEach((data, index) => {
            position.set(data.x, data.groundY - data.sink, data.z);
            quaternion.set(data.qx, data.qy, data.qz, data.qw);
            scale.set(data.scale, data.scale, data.scale);

            instanceMatrix.compose(position, quaternion, scale);
            finalMatrix.multiplyMatrices(instanceMatrix, relativeMatrix);

            instancedMesh.setMatrixAt(index, finalMatrix);
          });

          instancedMesh.instanceMatrix.needsUpdate = true;
          scene.add(instancedMesh);
          this.instancedMeshes.push({ 
            meshList: instancedMesh, 
            instances: enrichedInstances, 
            relativeMatrix,
            localSphere
          });
        });
      });
    });
  }

  private instancedMeshes: Array<{
    meshList: THREE.InstancedMesh;
    instances: Array<{ x: number; z: number; scale: number; rotation: number; groundY: number; sink: number; qx: number; qy: number; qz: number; qw: number }>;
    relativeMatrix: THREE.Matrix4;
    localSphere: THREE.Sphere;
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
      Rocks._projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      Rocks._frustum.setFromProjectionMatrix(Rocks._projScreenMatrix);
    }

    const MAX_DIST_SQ = 130 * 130; // Rocks cull at 130m to eliminate unnecessary draw calls

    const pos = Rocks._scratchPos;
    const quat = Rocks._scratchQuat;
    const scl = Rocks._scratchScale;
    const instMat = Rocks._scratchInstMat;
    const finalMat = Rocks._scratchFinalMat;
    const sphere = Rocks._scratchSphere;
    const frustum = Rocks._frustum;

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

        // 1. Distance culling (180m)
        if (distSq > MAX_DIST_SQ) {
          continue;
        }

        // 2. Camera Frustum Culling
        if (camera) {
          sphere.center.set(data.x, data.groundY + data.scale * 1.5, data.z);
          sphere.radius = data.scale * 3.5;
          if (!frustum.intersectsSphere(sphere)) {
            continue;
          }
        }

        pos.set(data.x, data.groundY - data.sink, data.z);
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
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const instanceMatrix = new THREE.Matrix4();

    for (const group of this.instancedMeshes) {
      group.instances.forEach((data) => {
        const dx = data.x - playerPos.x;
        const dz = data.z - playerPos.z;
        if (dx * dx + dz * dz <= radiusSq) {
          position.set(data.x, data.groundY - data.sink, data.z);
          quaternion.set(data.qx, data.qy, data.qz, data.qw);
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
