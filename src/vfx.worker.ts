// src/vfx.worker.ts

interface WorkerInitData {
  sab: SharedArrayBuffer;
  maxParticles: number;
}

interface SpawnData {
  type: 'spawn';
  count: number;
  x: number;
  y: number;
  z: number;
  color: [number, number, number];
}

type WorkerMessage = { type: 'init'; data: WorkerInitData } | SpawnData;

let sab: SharedArrayBuffer;
let particleData: Float32Array;
let maxParticles = 0;

const STRIDE = 12;

self.onmessage = (e: MessageEvent<WorkerMessage>) => {
  const msg = e.data;
  if (msg.type === 'init') {
    sab = msg.data.sab;
    maxParticles = msg.data.maxParticles;
    particleData = new Float32Array(sab);
    startSimulationLoop();
  } else if (msg.type === 'spawn') {
    spawnParticles(msg);
  }
};

function spawnParticles(data: SpawnData) {
  if (!particleData) return;

  let spawned = 0;
  for (let i = 0; i < maxParticles; i++) {
    const idx = i * STRIDE;
    if (particleData[idx + 11] === 0.0) {
      particleData[idx + 0] = data.x;
      particleData[idx + 1] = data.y;
      particleData[idx + 2] = data.z;

      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos((Math.random() * 2) - 1);
      const speed = 2.0 + Math.random() * 5.0;

      particleData[idx + 3] = Math.sin(phi) * Math.cos(theta) * speed;
      particleData[idx + 4] = Math.sin(phi) * Math.sin(theta) * speed + 3.0;
      particleData[idx + 5] = Math.cos(phi) * speed;

      const life = 0.5 + Math.random() * 1.5;
      particleData[idx + 6] = life;
      particleData[idx + 7] = life;

      particleData[idx + 8] = data.color[0];
      particleData[idx + 9] = data.color[1];
      particleData[idx + 10] = data.color[2];

      particleData[idx + 11] = 1.0;

      spawned++;
      if (spawned >= data.count) break;
    }
  }
}

let lastTime = performance.now();

function startSimulationLoop() {
  setInterval(() => {
    const now = performance.now();
    const dt = (now - lastTime) / 1000;
    lastTime = now;

    updatePhysics(dt);
  }, 1000 / 60);
}

function updatePhysics(dt: number) {
  if (!particleData) return;

  const gravity = -9.8;

  for (let i = 0; i < maxParticles; i++) {
    const idx = i * STRIDE;
    if (particleData[idx + 11] === 0.0) continue;

    particleData[idx + 6] -= dt;
    if (particleData[idx + 6] <= 0) {
      particleData[idx + 11] = 0.0;
      continue;
    }

    particleData[idx + 4] += gravity * dt;

    particleData[idx + 0] += particleData[idx + 3] * dt;
    particleData[idx + 1] += particleData[idx + 4] * dt;
    particleData[idx + 2] += particleData[idx + 5] * dt;
  }
}
