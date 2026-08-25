import * as THREE from 'three';

export interface BaseEntity {
  id: string;
  type: 'player' | 'enemy';
  position: THREE.Vector3;
  playerGroup: THREE.Group;
  hp: number;
  radius?: number;
}
