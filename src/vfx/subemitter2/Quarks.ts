import * as THREE from 'three';
import { BatchedParticleRenderer, QuarksLoader } from 'three.quarks';
import subEmitter2Data from '../../../quarks/subEmitter2.json';

export class Subemitter2QuarksVFX {
  private scene: THREE.Scene;
  private batchRenderer: any;
  private pool: THREE.Object3D[] = [];
  private poolIndex = 0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.batchRenderer = new BatchedParticleRenderer();
    this.scene.add(this.batchRenderer);
    const loader = new QuarksLoader();
    // Pre-parse 15 instances to avoid runtime parsing or clone reference sharing
    for (let i = 0; i < 15; i++) {
      this.pool.push(loader.parse(subEmitter2Data as any));
    }
  }

  public spawn(x: number, y: number, z: number) {
    const instance = this.pool[this.poolIndex];
    this.poolIndex = (this.poolIndex + 1) % this.pool.length;

    // Remove from scene if already added
    this.scene.remove(instance);

    instance.position.set(x, y, z);
    instance.scale.setScalar(2.0);
    this.scene.add(instance);
    
    instance.traverse((child: any) => {
      if (child.type === 'ParticleEmitter') {
        child.system.restart();
        this.batchRenderer.addSystem(child.system);
        child.system.autoDestroy = true;
      }
    });

    if (instance.type === 'ParticleEmitter') {
      (instance as any).system.restart();
      this.batchRenderer.addSystem((instance as any).system);
      (instance as any).system.autoDestroy = true;
    }
  }

  public update(delta: number) {
    this.batchRenderer.update(delta);
  }
}
