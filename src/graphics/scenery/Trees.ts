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

    // ponytail: procedurally generate endless trees beyond battlefield boundaries to fit the expanded 2400x2400 world
    let seed = 98765;
    const prng = () => {
      const x = Math.sin(seed++) * 10000;
      return x - Math.floor(x);
    };

    const treeTypes = ["Pine_1", "BirchTree_2", "MapleTree_1"];
    // Generate 450 random trees on the outskirt mountains/forests deterministically
    for (let i = 0; i < 450; i++) {
      const rx = (prng() - 0.5) * 2300;
      const rz = (prng() - 0.5) * 2300;
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

                // Tag materials explicitly so CameraOcclusionManager only targets leaves, not bark
                const matName = mat.name.toLowerCase();
                if (/leaf|leaves|foliage/.test(matName)) {
                  mat.userData.isLeaf = true;
                  mat.userData.isBark = false;
                } else {
                  mat.userData.isLeaf = false;
                  mat.userData.isBark = true; // bark/trunk stays visible always
                }
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
        const pos = new THREE.Vector3(data.x, groundY, data.z);
        (pos as any).treeType = data.type;
        treePositions.push(pos);
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

          // Tag leaf mesh
          const isLeafMesh = mesh.material && (
            (mesh.material as any).userData?.isLeaf === true ||
            /leaf|leaves|foliage/.test((mesh.material as any).name?.toLowerCase() || '')
          ) ? true : false;

          // Compute exact local bounding sphere from the original geometry
          if (!mesh.geometry.boundingSphere) {
            mesh.geometry.computeBoundingSphere();
          }
          const localSphere = mesh.geometry.boundingSphere!.clone();
          localSphere.applyMatrix4(relativeMatrix); // transform to template space

          // Compute exact local bounding box from the original geometry for accurate OBB leaf culling
          if (!mesh.geometry.boundingBox) {
            mesh.geometry.computeBoundingBox();
          }
          const localBox = mesh.geometry.boundingBox!.clone();
          localBox.applyMatrix4(relativeMatrix); // transform to template space
          localBox.expandByScalar(1.8); // Add extra padding area so leaves cull slightly before camera clips through them

          // Temp variables to compose instance matrices
          const position = new THREE.Vector3();
          const rotation = new THREE.Euler();
          const quaternion = new THREE.Quaternion();
          const scale = new THREE.Vector3();
          const instanceMatrix = new THREE.Matrix4();
          const finalMatrix = new THREE.Matrix4();

          // ponytail: pre-compute groundY, sink, and rotation quaternion at init.
          // Saves 5× getTerrainHeight + setFromEuler per visible tree per update() call.
          const _tmpEuler = new THREE.Euler();
          const _tmpQuat = new THREE.Quaternion();
          const enrichedInstances = instances.map((data) => {
            const groundY = getTerrainHeight(data.x, data.z);
            const hL = getTerrainHeight(data.x - 1, data.z);
            const hR = getTerrainHeight(data.x + 1, data.z);
            const hD = getTerrainHeight(data.x, data.z - 1);
            const hU = getTerrainHeight(data.x, data.z + 1);
            const slopeX = hR - hL;
            const slopeZ = hU - hD;
            const steepness = Math.sqrt(slopeX * slopeX + slopeZ * slopeZ);
            const sink = steepness > 0.4 ? Math.min(2.0, (steepness - 0.4) * 2.0) : 0.0;
            _tmpEuler.set(0, data.rotation, 0);
            _tmpQuat.setFromEuler(_tmpEuler);
            return { ...data, groundY, sink, qx: _tmpQuat.x, qy: _tmpQuat.y, qz: _tmpQuat.z, qw: _tmpQuat.w };
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
            isLeafMesh,
            localSphere,
            localBox
          });
        });
      });

      // ponytail: Create wireframe debug box helper representing the exact OBB leaves collision margins if debug env is true
      if (import.meta.env.VITE_DEBUG_COLLIDERS === 'true') {
        const debugGroup = new THREE.Group();
        debugGroup.name = "tree-debug-canopy-boxes";
        scene.add(debugGroup);

        const boxMat = new THREE.MeshBasicMaterial({
          color: 0x00ffff, // cyan wireframe to distinguish from green player collisions
          wireframe: true,
          transparent: true,
          opacity: 0.15,
          depthWrite: false
        });

        this.instancedMeshes.forEach((group) => {
          if (!group.isLeafMesh) return;

          const size = new THREE.Vector3();
          group.localBox.getSize(size);

          const center = new THREE.Vector3();
          group.localBox.getCenter(center);

          // BoxGeometry centered at (0, 0, 0)
          const boxGeo = new THREE.BoxGeometry(size.x, size.y, size.z);

          group.instances.forEach((data) => {
            const mesh = new THREE.Mesh(boxGeo, boxMat);
            
            // Apply local template center offset
            mesh.position.copy(center);
            
            // Apply scale
            mesh.scale.setScalar(data.scale);
            mesh.position.multiplyScalar(data.scale);
            
            // Apply rotation
            mesh.position.applyAxisAngle(new THREE.Vector3(0, 1, 0), data.rotation);
            mesh.rotation.y = data.rotation;

            // Apply world position
            mesh.position.x += data.x;
            mesh.position.y += data.groundY - data.sink;
            mesh.position.z += data.z;

            debugGroup.add(mesh);
          });
        });
      }
    });
  }

  private instancedMeshes: Array<{
    meshList: THREE.InstancedMesh;
    instances: Array<{ x: number; z: number; scale: number; rotation: number; groundY: number; sink: number; qx: number; qy: number; qz: number; qw: number }>;
    relativeMatrix: THREE.Matrix4;
    isLeafMesh: boolean;
    localSphere: THREE.Sphere;
    localBox: THREE.Box3;
  }> = [];

  private lastUpdatePos = new THREE.Vector3(9999, 9999, 9999);
  private lastUpdateQuat = new THREE.Quaternion();
  private needsFirstUpdate = true;

  // Module level scratch structures to avoid GC allocation in update loop
  private localCamPosScratch = new THREE.Vector3();
  private static _scratchPos = new THREE.Vector3();
  private static _scratchCamPos = new THREE.Vector3();
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

    // ponytail: throttle LOD calculations when camera is stationary
    let camMoved = this.lastUpdatePos.distanceToSquared(cameraPos) > 0.35;
    let camRotated = false;
    if (camera) {
      camRotated = this.lastUpdateQuat.angleTo(camera.quaternion) > 0.035; // ~2 degrees
    }

    if (!this.needsFirstUpdate && !camMoved && !camRotated) {
      return;
    }
    this.needsFirstUpdate = false;
    this.lastUpdatePos.copy(cameraPos);
    if (camera) {
      this.lastUpdateQuat.copy(camera.quaternion);
      Trees._projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      Trees._frustum.setFromProjectionMatrix(Trees._projScreenMatrix);
    }

    // ponytail: Tighter Dynamic LOD tree distance (160m matches horizon fog)
    const MAX_DIST_SQ = 160 * 160; // 160 meters

    const pos = Trees._scratchPos;
    const quat = Trees._scratchQuat;
    const scl = Trees._scratchScale;
    const instMat = Trees._scratchInstMat;
    const finalMat = Trees._scratchFinalMat;
    const sphere = Trees._scratchSphere;
    const frustum = Trees._frustum;

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

        // 1. Distance culling (220m)
        if (distSq > MAX_DIST_SQ) {
          continue;
        }

        // 2. Camera Frustum Culling (Skip everything outside FOV / behind camera)
        if (camera) {
          sphere.center.set(data.x, data.groundY + data.scale * 2.0, data.z);
          sphere.radius = data.scale * 4.5;
          if (!frustum.intersectsSphere(sphere)) {
            continue;
          }
        }

        let currentScale = data.scale;

        // Leaf canopy culling: if camera is inside the leaf canopy OBB, set scale to 0.0
        if (group.isLeafMesh) {
          const groundY = data.groundY;
          const tx = cameraPos.x - data.x;
          const ty = cameraPos.y - groundY;
          const tz = cameraPos.z - data.z;

          const cosRot = Math.cos(-data.rotation);
          const sinRot = Math.sin(-data.rotation);
          const rx = tx * cosRot - tz * sinRot;
          const rz = tx * sinRot + tz * cosRot;

          this.localCamPosScratch.set(rx / data.scale, ty / data.scale, rz / data.scale);

          if (distSq < 6.5 * 6.5 || group.localBox.containsPoint(this.localCamPosScratch)) {
            currentScale = 0.0;
          }
        }

        // Trunk collision culling
        if (currentScale > 0.0) {
          const cullRadius = 1.0 + data.scale * 0.4;
          const cullRadiusSq = cullRadius * cullRadius;

          if (distSq < cullRadiusSq && !group.isLeafMesh) {
            currentScale = 0.0;
          }
        }

        if (currentScale > 0.0) {
          pos.set(data.x, data.groundY - data.sink, data.z);
          quat.set(data.qx, data.qy, data.qz, data.qw);
          scl.set(currentScale, currentScale, currentScale);

          instMat.compose(pos, quat, scl);
          finalMat.multiplyMatrices(instMat, group.relativeMatrix);
          mesh.setMatrixAt(visibleCount++, finalMat);
        }
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
      // Abaikan daun, karakter hanya menabrak batang pohon
      if (group.isLeafMesh) continue; 

      for (const data of group.instances) {
        const key = `${data.x.toFixed(1)},${data.z.toFixed(1)}`;
        if (seen.has(key)) continue;

        const dx = data.x - playerPos.x;
        const dz = data.z - playerPos.z;
        const distSq = dx * dx + dz * dz;

        if (distSq <= radiusSq) {
          seen.add(key);
          // Asumsikan radius batang pohon adalah 0.35 dikali skala visualnya (agar tidak terlalu lebar/seret)
          colliders.push({ x: data.x, z: data.z, radius: data.scale * 0.35 });
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
      if (group.isLeafMesh) continue; // Only collide with trunks, ignore leaves!

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
          worldCenter.y += groundY;
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
