import * as THREE from 'three';
import { NetworkManager } from '../../network/NetworkManager';

export interface MovementSnapshot {
  // serverTs: unix-ms from server payload (used for accurate interpolation timeline)
  // Falls back to performance.now() if server doesn't send timestamp yet
  serverTs: number;
  position: THREE.Vector3;
  rotation: THREE.Quaternion;
  velocity: THREE.Vector3; // needed for dead-reckoning extrapolation
  action: string;
}

// Fixed-size ring buffer — O(1) insert, zero GC pressure from shift()
// ponytail: cap=16 covers ~530ms at 30Hz with headroom; raise to 32 if tick rate goes to 60Hz
const BUFFER_CAP = 16;

export class MovementInterpolator {
  // Ring buffer: head points to oldest slot, tail to newest
  private buf: MovementSnapshot[] = new Array(BUFFER_CAP);
  private head = 0; // oldest
  private tail = 0; // next write slot
  private count = 0;

  // bufferDelay: how far behind server time we render (ms)
  // 100ms = safe for ~30Hz server tick + 30ms jitter headroom
  // ponytail: adaptive delay (Valve-style) would help on high-jitter connections — ceiling to implement if stddev > 20ms
  private bufferDelay = 100;

  // Smoothing for position snap-correction
  private lambda = 12.0;

  // Velocity tracking for dead-reckoning
  private lastOutputPos = new THREE.Vector3();
  private smoothedVelocity = new THREE.Vector3();
  private frameVelocity = 0;

  // Pre-allocated scratch objects to avoid GC
  private _scratchPos = new THREE.Vector3();
  private _scratchRot = new THREE.Quaternion();

  /** Push a new snapshot from the server.
   *  @param serverTs  unix-ms from server (0 = use local clock as fallback)
   */
  public addSnapshot(
    x: number, y: number, z: number,
    rotationYaw: number,
    action: string,
    serverTs = 0,
  ) {
    // Fallback: if server doesn't send ts yet, approximate via clockOffset
    const ts = serverTs > 0
      ? serverTs
      : performance.now() + NetworkManager.clockOffset;

    // Derive velocity from previous snapshot for dead-reckoning
    let vx = 0, vy = 0, vz = 0;
    if (this.count > 0) {
      const prev = this._newest();
      if (ts <= prev.serverTs) {
        return;
      }
      const dtMs = ts - prev.serverTs;
      if (dtMs > 1000) {
        // Time gap too large (e.g., server AoI culling or major lag). 
        // Reset the buffer so the entity snaps to the new position instantly
        // instead of freezing or interpolating across the huge stale time gap.
        this.reset();
      } else if (dtMs > 1) {
        const dtS = dtMs / 1000;
        vx = (x - prev.position.x) / dtS;
        vy = (y - prev.position.y) / dtS;
        vz = (z - prev.position.z) / dtS;
      }
    }

    const slot = this.tail;
    if (!this.buf[slot]) {
      // Lazy-allocate on first use — zero GC after warmup
      this.buf[slot] = {
        serverTs: ts,
        position: new THREE.Vector3(x, y, z),
        rotation: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotationYaw),
        velocity: new THREE.Vector3(vx, vy, vz),
        action,
      };
    } else {
      // Reuse allocated objects — no GC
      this.buf[slot].serverTs = ts;
      this.buf[slot].position.set(x, y, z);
      this.buf[slot].rotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotationYaw);
      this.buf[slot].velocity.set(vx, vy, vz);
      this.buf[slot].action = action;
    }

    this.tail = (this.tail + 1) % BUFFER_CAP;
    if (this.count < BUFFER_CAP) {
      this.count++;
    } else {
      // Buffer full: advance head (discard oldest)
      this.head = (this.head + 1) % BUFFER_CAP;
    }
  }

  private _newest(): MovementSnapshot {
    return this.buf[(this.tail - 1 + BUFFER_CAP) % BUFFER_CAP];
  }

  private _at(i: number): MovementSnapshot {
    return this.buf[(this.head + i) % BUFFER_CAP];
  }

  /** Call every frame. Writes lerped result into outPosition / outQuaternion.
   *  Returns { action, velocity } for animation driving.
   */
  public update(
    delta: number,
    outPosition: THREE.Vector3,
    outQuaternion: THREE.Quaternion,
  ): { action: string; velocity: number } {
    if (this.count < 1) return { action: 'idle', velocity: 0 };

    // Render time in server-clock space
    // = current client time (perf.now) mapped to server timeline, then walked back by bufferDelay
    const renderTs = (performance.now() + NetworkManager.clockOffset) - this.bufferDelay;

    const newest = this._newest();

    // ── Dead-reckoning extrapolation ─────────────────────────────────────────
    // If renderTs is AHEAD of newest snapshot (buffer ran dry / packet loss):
    // extrapolate using last known velocity instead of freezing
    if (renderTs >= newest.serverTs) {
      const dtS = Math.min((renderTs - newest.serverTs) / 1000, 0.3); // cap 300ms
      this._scratchPos.copy(newest.position).addScaledVector(newest.velocity, dtS);
      this._scratchRot.copy(newest.rotation);

      outPosition.x = THREE.MathUtils.damp(outPosition.x, this._scratchPos.x, this.lambda, delta);
      outPosition.y = THREE.MathUtils.damp(outPosition.y, this._scratchPos.y, this.lambda, delta);
      outPosition.z = THREE.MathUtils.damp(outPosition.z, this._scratchPos.z, this.lambda, delta);
      outQuaternion.slerp(this._scratchRot, Math.min(1.0, delta * this.lambda));
      this._updateVelocity(outPosition, delta);
      return { action: newest.action, velocity: this.frameVelocity };
    }

    // ── Normal snapshot interpolation ────────────────────────────────────────
    // Find the two snapshots that straddle renderTs
    let lo = 0, hi = this.count - 1;
    for (let i = 0; i < this.count - 1; i++) {
      if (this._at(i).serverTs <= renderTs && this._at(i + 1).serverTs >= renderTs) {
        lo = i;
        hi = i + 1;
        break;
      }
    }

    const s0 = this._at(lo);
    const s1 = this._at(hi);

    let t = 1.0;
    const span = s1.serverTs - s0.serverTs;
    if (span > 0) {
      t = Math.max(0, Math.min(1, (renderTs - s0.serverTs) / span));
    }

    this._scratchPos.lerpVectors(s0.position, s1.position, t);
    this._scratchRot.slerpQuaternions(s0.rotation, s1.rotation, t);

    outPosition.x = THREE.MathUtils.damp(outPosition.x, this._scratchPos.x, this.lambda, delta);
    outPosition.y = THREE.MathUtils.damp(outPosition.y, this._scratchPos.y, this.lambda, delta);
    outPosition.z = THREE.MathUtils.damp(outPosition.z, this._scratchPos.z, this.lambda, delta);
    outQuaternion.slerp(this._scratchRot, Math.min(1.0, delta * this.lambda));

    this._updateVelocity(outPosition, delta);
    return { action: s1.action, velocity: this.frameVelocity };
  }

  private _updateVelocity(outPos: THREE.Vector3, delta: number) {
    const dist = outPos.distanceTo(this.lastOutputPos);
    this.lastOutputPos.copy(outPos);
    if (delta > 0.0001) {
      const raw = dist / delta;
      // Low-pass filter: smooth velocity for animation speed scaling
      this.frameVelocity = THREE.MathUtils.lerp(this.frameVelocity, raw, 0.15);
    }
  }

  /** Reset interpolator state (e.g. on teleport / respawn) */
  public reset() {
    this.head = 0;
    this.tail = 0;
    this.count = 0;
    this.frameVelocity = 0;
  }
}
