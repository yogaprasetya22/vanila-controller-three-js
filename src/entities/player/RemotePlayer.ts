import { LocalPlayer } from './LocalPlayer';
import * as THREE from 'three';

export class RemotePlayer extends LocalPlayer {
  constructor(scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    super(scene, camera, false);
  }
}
