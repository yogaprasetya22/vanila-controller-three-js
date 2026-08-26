import * as THREE from 'three';

export interface CastContext {
  scene: THREE.Scene;
  forward: THREE.Vector3;
  target?: any;
  customData?: any;
}

export interface ISkill {
  id: string;
  name: string;
  cooldown: number;
  
  cast(caster: any, context: CastContext): boolean;
  onImpact(caster: any, target: any, impactPoint: THREE.Vector3): void;
}
