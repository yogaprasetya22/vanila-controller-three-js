import * as THREE from 'three';

export let scene: THREE.Scene = null as any;
export let camera: THREE.PerspectiveCamera = null as any;

export function setScene(s: THREE.Scene) {
  scene = s;
}

export function setCamera(c: THREE.PerspectiveCamera) {
  camera = c;
}
