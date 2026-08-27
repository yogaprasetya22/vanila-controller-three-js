import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import { Floor } from './Floor';
import { WaterSurface } from './WaterSurface';
import { Turrets } from './Turret';
import { Trees } from './Trees';
import { Flowers } from './Flowers';
import { SceneryWindLines } from './SceneryWindLines';
import { Grass } from './Grass';
import { Leaves } from './Leaves';
import { CameraOcclusionManager } from './CameraOcclusionManager';
import { invalidateTerrainCache } from '../../simulation/constants';

export class World {
  floor: Floor;
  waterSurface?: WaterSurface;
  trees?: Trees;
  grass?: Grass;
  flowers?: Flowers;
  windLines: SceneryWindLines;
  turrets: Turrets;
  leaves: Leaves;
  occlusionManager?: CameraOcclusionManager;

  elapsed = 0;
  uniforms = {
    uTime: { value: 0 }
  };

  constructor(scene: THREE.Scene, gltfLoader: GLTFLoader, camera?: THREE.Camera) {
    invalidateTerrainCache();
    this.floor        = new Floor(scene);
    this.waterSurface = new WaterSurface(scene, this.uniforms);
    this.trees        = new Trees(scene, gltfLoader);
    this.grass        = new Grass(scene, this.uniforms);
    // this.flowers      = new Flowers(scene, this.uniforms);
    this.windLines    = new SceneryWindLines(scene);
    this.turrets      = new Turrets(scene, gltfLoader);
    this.leaves       = new Leaves(scene);
    if (camera) {
      this.occlusionManager = new CameraOcclusionManager(scene, camera);
    }
  }

  update(delta: number, camPos: THREE.Vector3, camera?: THREE.Camera, playerPos?: THREE.Vector3) {
    this.elapsed += delta;
    this.uniforms.uTime.value = this.elapsed;
    this.windLines.update(delta, this.elapsed);
    this.waterSurface?.update(camPos);
    
    // ponytail: Dynamic LOD culling for trees
    if (this.trees) {
      this.trees.update(camPos);
    }

    if (camera) {
      this.turrets.update(camera, delta);
    }

    // Camera occlusion: fade leaves + cutout shader when cam is between objects and player
    if (this.occlusionManager && playerPos) {
      this.occlusionManager.update(playerPos, delta);
    }
  }

  getColliderMesh(): THREE.Mesh {
    this.floor.mesh.updateMatrixWorld(true);
    const floorGeometry = this.floor.mesh.geometry.clone();
    floorGeometry.applyMatrix4(this.floor.mesh.matrixWorld);
    (floorGeometry as any).computeBoundsTree();
    const colliderMesh = new THREE.Mesh(floorGeometry);
    return colliderMesh;
  }
}
