import * as THREE from 'three';
import { QuarksLoader } from 'three.quarks';
import fs from 'fs';

const data = JSON.parse(fs.readFileSync('/home/yoga/Dokumen/game_3d/custom-vfx-multi-trade-threejs/quarks/subEmitter2.json', 'utf-8'));
const loader = new QuarksLoader();
const template = loader.parse(data);
console.log('Template parsed. Cloning...');
try {
  const clone = template.clone();
  console.log('Clone successful. Type:', clone.type);
  let cloneEmitterCount = 0;
  clone.traverse((child) => {
    if (child.type === 'ParticleEmitter') {
      cloneEmitterCount++;
      console.log('Found emitter in clone. System exists:', !!child.system);
    }
  });
  console.log('Total emitters in clone:', cloneEmitterCount);
} catch (e) {
  console.error('Clone failed:', e);
}
