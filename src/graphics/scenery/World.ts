import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import { Floor } from './Floor';
import { WaterSurface } from './WaterSurface';
import { Trees } from './Trees';
import { Rocks } from './Rocks';
import { Vegetation } from './Vegetation';
import { Flowers } from './Flowers';
import { SceneryWindLines } from './SceneryWindLines';
import { Grass } from './Grass';
import { Leaves } from './Leaves';
import { CameraOcclusionManager } from './CameraOcclusionManager';
import { VisualTornado } from './VisualTornado';
import { Clouds } from './Clouds';
import { invalidateTerrainCache, getTerrainHeight } from '../../simulation/constants';

import { globalWind } from './Wind';

// Helper to normalize any geometry (meshopt interleaved buffers, etc.) into a standard Float32 position and Uint16/32 index
function getCleanGeometry(geom: THREE.BufferGeometry): THREE.BufferGeometry {
  const clean = new THREE.BufferGeometry();
  
  const posAttr = geom.attributes.position;
  const count = posAttr.count;
  const posArr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    posArr[i * 3]     = posAttr.getX(i);
    posArr[i * 3 + 1] = posAttr.getY(i);
    posArr[i * 3 + 2] = posAttr.getZ(i);
  }
  clean.setAttribute('position', new THREE.BufferAttribute(posArr, 3));

  if (geom.index) {
    const idxAttr = geom.index;
    const idxCount = idxAttr.count;
    const idxArr = idxCount > 65535 ? new Uint32Array(idxCount) : new Uint16Array(idxCount);
    for (let i = 0; i < idxCount; i++) {
      idxArr[i] = idxAttr.getX(i);
    }
    clean.setIndex(new THREE.BufferAttribute(idxArr, 1));
  }
  
  return clean;
}

export class World {
  floor: Floor;
  waterSurface?: WaterSurface;
  trees?: Trees;
  rocks?: Rocks;
  vegetation?: Vegetation;
  grass?: Grass;
  flowers?: Flowers;
  windLines: SceneryWindLines;
  leaves: Leaves;
  occlusionManager?: CameraOcclusionManager;
  visualTornadoes: VisualTornado[] = [];
  clouds?: Clouds;

  elapsed = 0;
  uniforms = {
    uTime: { value: 0 }
  };

  constructor(scene: THREE.Scene, gltfLoader: GLTFLoader, camera?: THREE.Camera) {
    invalidateTerrainCache();
    this.floor        = new Floor(scene);
    this.waterSurface = new WaterSurface(scene, this.uniforms);
    this.trees        = new Trees(scene, gltfLoader);
    this.rocks        = new Rocks(scene, gltfLoader);
    this.vegetation   = new Vegetation(scene, gltfLoader, this.uniforms);
    this.grass        = new Grass(scene, this.uniforms);
    // this.flowers      = new Flowers(scene, this.uniforms);
    this.windLines    = new SceneryWindLines(scene);
    this.leaves       = new Leaves(scene);
    this.visualTornadoes = [
      new VisualTornado(scene, 45, -60, 0),
      new VisualTornado(scene, -120, 80, 50),
      new VisualTornado(scene, 100, 110, 100)
    ];
    this.clouds = new Clouds(scene);
    if (camera) {
      this.occlusionManager = new CameraOcclusionManager(scene, camera);
    }
  }

  update(delta: number, camPos: THREE.Vector3, camera?: THREE.Camera, playerPos?: THREE.Vector3) {
    globalWind.update(delta);
    this.elapsed += delta;
    this.uniforms.uTime.value = this.elapsed;
    this.windLines.update(delta, this.elapsed, camPos);
    this.leaves.update(delta, this.elapsed, camPos);
    this.waterSurface?.update(camPos);
    
    // ponytail: Dynamic LOD and Camera Frustum Culling for trees, rocks, and vegetation
    const camTarget = camera || camPos;
    if (this.trees) {
      this.trees.update(camTarget);
    }
    if (this.rocks) {
      this.rocks.update(camTarget);
    }
    if (this.vegetation) {
      this.vegetation.update(camTarget);
    }
    if (this.grass) {
      this.grass.update(camPos);
    }
    for (const tornado of this.visualTornadoes) {
       tornado.update(delta, this.elapsed, camPos);
    }
    if (this.clouds) {
      this.clouds.update(delta, camPos);
    }

    // Camera occlusion: fade leaves + cutout shader when cam is between objects and player
    if (this.occlusionManager && playerPos) {
      this.occlusionManager.update(playerPos, delta);
    }
  }

  getColliderMesh(): THREE.Mesh {
    this.floor.mesh.updateMatrixWorld(true);
    
    // Create floor geometry normalized to standard position and index attributes
    const floorGeom = getCleanGeometry(this.floor.mesh.geometry);
    floorGeom.applyMatrix4(this.floor.mesh.matrixWorld);
    
    const geometries = [floorGeom];

    // If rocks are loaded, merge their instances into the static BVH to allow standing on top of them
    if (this.rocks && (this.rocks as any).instancedMeshes) {
      const rockGroups = (this.rocks as any).instancedMeshes;
      for (const group of rockGroups) {
        const geom = group.meshList.geometry;
        
        group.instances.forEach((data: any) => {
          const position = new THREE.Vector3();
          const quaternion = new THREE.Quaternion();
          const scale = new THREE.Vector3();
          const instanceMatrix = new THREE.Matrix4();
          const finalMatrix = new THREE.Matrix4();

          position.set(data.x, data.groundY - data.sink, data.z);
          quaternion.set(data.qx, data.qy, data.qz, data.qw);
          scale.set(data.scale, data.scale, data.scale);

          instanceMatrix.compose(position, quaternion, scale);
          finalMatrix.multiplyMatrices(instanceMatrix, group.relativeMatrix);

          // Normalize instance geometry attributes to standard array formats before merging
          const instanceGeom = getCleanGeometry(geom);
          instanceGeom.applyMatrix4(finalMatrix);
          geometries.push(instanceGeom);
        });
      }
    }

    // If trees are loaded, merge their trunk instances into the static BVH to allow sliding/climbing on trunks
    if (this.trees && (this.trees as any).instancedMeshes) {
      const treeGroups = (this.trees as any).instancedMeshes;
      for (const group of treeGroups) {
        if (group.isLeafMesh) continue; // Only merge trunks, skip leaf meshes to avoid blocking the player vertically

        const geom = group.meshList.geometry;
        
        group.instances.forEach((data: any) => {
          const position = new THREE.Vector3();
          const quaternion = new THREE.Quaternion();
          const scale = new THREE.Vector3();
          const instanceMatrix = new THREE.Matrix4();
          const finalMatrix = new THREE.Matrix4();

          position.set(data.x, data.groundY - data.sink, data.z);
          quaternion.set(data.qx, data.qy, data.qz, data.qw);
          scale.set(data.scale, data.scale, data.scale);

          instanceMatrix.compose(position, quaternion, scale);
          finalMatrix.multiplyMatrices(instanceMatrix, group.relativeMatrix);

          // Normalize instance geometry attributes to standard array formats before merging
          const instanceGeom = getCleanGeometry(geom);
          instanceGeom.applyMatrix4(finalMatrix);
          geometries.push(instanceGeom);
        });
      }
    }

    const mergedGeometry = BufferGeometryUtils.mergeGeometries(geometries);
    (mergedGeometry as any).computeBoundsTree();
    const colliderMesh = new THREE.Mesh(mergedGeometry);
    return colliderMesh;
  }

  public rebuildCollider(onComplete: (mesh: THREE.Mesh) => void) {
    const checkInterval = setInterval(() => {
      const rocksReady = this.rocks && (this.rocks as any).instancedMeshes.length > 0;
      const treesReady = this.trees && (this.trees as any).instancedMeshes.length > 0;
      if (rocksReady && treesReady) {
        clearInterval(checkInterval);
        const mesh = this.getColliderMesh();
        onComplete(mesh);
      }
    }, 100);
  }
}
