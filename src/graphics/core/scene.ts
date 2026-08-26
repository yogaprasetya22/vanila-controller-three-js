import * as THREE from 'three';
import { TargetingManager } from '../../systems/targeting/TargetingManager';

export let scene: THREE.Scene = null as any;
export let camera: THREE.PerspectiveCamera = null as any;
export const referencePosition = new THREE.Vector3();

export function setScene(s: THREE.Scene) {
  scene = s;
}

export function setCamera(c: THREE.PerspectiveCamera) {
  camera = c;
}

export function getLODLevelAt(pos: THREE.Vector3): 'full' | 'name-only' | 'culled' {
  const dist = pos.distanceTo(referencePosition);
  if (dist > 40.0) return 'culled';

  const allEntities = TargetingManager.getAllEntities();
  const totalEntities = allEntities.length;

  if (dist <= 10.0 || totalEntities <= 10) {
    return 'full';
  }

  // Count how many entities are closer to the reference position than this position.
  let closerCount = 0;
  for (const entity of allEntities) {
    if (entity.position.distanceTo(referencePosition) < dist) {
      closerCount++;
      if (closerCount >= 10) {
        return 'name-only';
      }
    }
  }

  return 'full';
}
