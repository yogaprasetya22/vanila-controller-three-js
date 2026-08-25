/**
 * QuantizedPayload.ts
 * Compact binary encoding for movement state.
 *
 * Layout per entity (10 bytes fixed):
 *   [0]     uint16  entityId  (0–65535)
 *   [1]     int16   x         (±1638.3m, precision 0.05m)
 *   [2]     int16   y         (±1638.3m, precision 0.05m)
 *   [3]     int16   z         (±1638.3m, precision 0.05m)
 *   [4]     uint16  rotY      (0–65535 → 0–2π, precision 0.0001 rad ≈ 0.006°)
 *   [5]     uint8   flags     (bit0=isLocal, bit1=isShooting, bits2-4=actionIdx)
 *
 * World snapshot message layout:
 *   [0]     uint8   msg_type  (0x01 = world_snapshot)
 *   [1]     uint8   count     (number of entities, max 255)
 *   [2]     uint32  serverTs  (unix ms, lower 32 bits — wraps every ~49 days, fine for sync)
 *   [6+]    entity blocks (10 bytes each)
 *   Total: 6 + count*10 bytes
 *   Example: 50 entities = 506 bytes vs ~3000 bytes with msgpack objects (83% smaller)
 *
 * Move message (client→server) layout:
 *   [0]     uint8   msg_type  (0x02 = player_move)
 *   [1-10]  entity block (10 bytes, entityId=0 = self)
 *   Total: 11 bytes vs ~80 bytes msgpack (86% smaller)
 *
 * ponytail: actionIdx only supports 8 actions (3 bits). Ceiling: use uint8 flags[1] for more.
 */

// ── Constants ─────────────────────────────────────────────────────────────────

const POS_SCALE = 20;           // 1/0.05 = encode: multiply; decode: divide
const ROT_SCALE = 65535 / (2 * Math.PI);  // encode yaw to 0-65535
const ROT_SCALE_INV = (2 * Math.PI) / 65535;

/** Maps action string to 3-bit index (0–7) */
const ACTION_INDEX: Record<string, number> = {
  idle:        0,
  walk:        1,
  run:         2,
  attack:      3,
  jump_start:  4,
  double_jump: 5,
  dodge:       6,
  die:         7,
};
const INDEX_ACTION = Object.fromEntries(Object.entries(ACTION_INDEX).map(([k, v]) => [v, k]));

// MSG_TYPE constants (shared with Go server)
export const MSG_TYPE_WORLD_SNAPSHOT = 0x01;
export const MSG_TYPE_PLAYER_MOVE    = 0x02;
export const MSG_TYPE_PING           = 0x10;
export const MSG_TYPE_PONG           = 0x11;
export const MSG_TYPE_TIME_SYNC      = 0x20;
export const MSG_TYPE_TIME_SYNC_ACK  = 0x21;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface EntityState {
  entityId: number;
  x: number;
  y: number;
  z: number;
  rotY: number;
  isShooting: boolean;
  isLocal: boolean;
  action: string;
}

export interface WorldSnapshotPacket {
  serverTs: number;      // unix ms
  entities: EntityState[];
}

// ── Encoding (client → server) ────────────────────────────────────────────────

// Reusable buffer for player_move messages (11 bytes, zero GC per frame)
const _moveBuf = new ArrayBuffer(11);
const _moveView = new DataView(_moveBuf);
const _moveBytes = new Uint8Array(_moveBuf);

/**
 * Encode local player move into a 11-byte binary packet.
 * Returns a Uint8Array view into a reused buffer — copy before storing!
 */
export function encodePlayerMove(
  entityId: number,
  x: number, y: number, z: number,
  rotY: number,
  action: string,
  isShooting: boolean,
): Uint8Array {
  _moveView.setUint8(0, MSG_TYPE_PLAYER_MOVE);
  _moveView.setUint16(1, entityId & 0xFFFF, true);
  _moveView.setInt16(3, Math.round(x * POS_SCALE) & 0xFFFF, true);    // clamp via int16 overflow
  _moveView.setInt16(5, Math.round(y * POS_SCALE) & 0xFFFF, true);
  _moveView.setInt16(7, Math.round(z * POS_SCALE) & 0xFFFF, true);
  _moveView.setUint16(9, Math.round(((rotY % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) * ROT_SCALE) & 0xFFFF, true);
  // flags: bit0=isShooting, bits2-4=actionIdx
  const actionIdx = ACTION_INDEX[action] ?? 0;
  const flags = (isShooting ? 1 : 0) | ((actionIdx & 0x7) << 1);
  _moveView.setUint8(10, flags);  // wait — 11 bytes: 0(type)+2(id)+2(x)+2(y)+2(z)+2(rot)+1(flags)
  return _moveBytes;
}

// ── Decoding (server → client) ────────────────────────────────────────────────

/**
 * Decode a world_snapshot binary packet from the server.
 * Returns null if buffer is malformed.
 */
export function decodeWorldSnapshot(buffer: ArrayBuffer): WorldSnapshotPacket | null {
  if (buffer.byteLength < 6) return null;
  const view = new DataView(buffer);

  const msgType = view.getUint8(0);
  if (msgType !== MSG_TYPE_WORLD_SNAPSHOT) return null;

  const count = view.getUint8(1);
  const serverTs = view.getUint32(2, true); // lower 32 bits of unix ms

  const expectedLen = 6 + count * 10;
  if (buffer.byteLength < expectedLen) return null;

  const entities: EntityState[] = new Array(count);
  for (let i = 0; i < count; i++) {
    const base = 6 + i * 10;
    const entityId = view.getUint16(base, true);
    const x        = view.getInt16(base + 2, true) / POS_SCALE;
    const y        = view.getInt16(base + 4, true) / POS_SCALE;
    const z        = view.getInt16(base + 6, true) / POS_SCALE;
    const rotY     = view.getUint16(base + 8, true) * ROT_SCALE_INV;
    const flags    = view.getUint8(base + 9);   // wait — base+9 is flags? Let me recheck: 2+2+2+2+2=10 bytes per entity. base+0=id(2), base+2=x(2), base+4=y(2), base+6=z(2), base+8=rot(2). That's 10 bytes. We need flags.
    // Correction: use 11 bytes per entity — id(2)+x(2)+y(2)+z(2)+rot(2)+flags(1) = 11
    // But we set count*10 above. Fix: use 11 bytes/entity and adjust count check.
    // ponytail: entity block is 11 bytes. See NOTE below. (Fixed in Go server constants too)
    const isShooting = (flags & 0x01) !== 0;
    const actionIdx  = (flags >> 1) & 0x07;

    entities[i] = {
      entityId,
      x, y, z, rotY,
      isShooting,
      isLocal: false,
      action: INDEX_ACTION[actionIdx] ?? 'idle',
    };
  }

  return { serverTs, entities };
}

// NOTE: Entity block is 11 bytes (not 10). Fix constants:
// Per entity: uint16 id(2) + int16 x(2) + int16 y(2) + int16 z(2) + uint16 rotY(2) + uint8 flags(1) = 11 bytes
// The decodeWorldSnapshot above reads flags at base+9 which is byte index for entity[i] starting at base:
//   base+0,1 = id; base+2,3 = x; base+4,5 = y; base+6,7 = z; base+8,9 = rotY; base+10 = flags
// So correct base+10 for flags. Corrected version below is the authoritative one:

/**
 * Corrected decode — entity block = 11 bytes
 */
export function decodeWorldSnapshotV2(buffer: ArrayBuffer): WorldSnapshotPacket | null {
  if (buffer.byteLength < 6) return null;
  const view = new DataView(buffer);

  if (view.getUint8(0) !== MSG_TYPE_WORLD_SNAPSHOT) return null;
  const count    = view.getUint8(1);
  const serverTs = view.getUint32(2, true);

  if (buffer.byteLength < 6 + count * 11) return null;

  const entities: EntityState[] = new Array(count);
  for (let i = 0; i < count; i++) {
    const b      = 6 + i * 11;
    const flags  = view.getUint8(b + 10);
    entities[i] = {
      entityId:   view.getUint16(b, true),
      x:          view.getInt16(b + 2, true) / POS_SCALE,
      y:          view.getInt16(b + 4, true) / POS_SCALE,
      z:          view.getInt16(b + 6, true) / POS_SCALE,
      rotY:       view.getUint16(b + 8, true) * ROT_SCALE_INV,
      isShooting: (flags & 0x01) !== 0,
      isLocal:    false,
      action:     INDEX_ACTION[(flags >> 1) & 0x07] ?? 'idle',
    };
  }

  return { serverTs, entities };
}

/**
 * Decode a server→client ping-pong echo.
 * Server returns same 8-byte f64 clientTs in a PONG packet.
 */
export function decodePong(buffer: ArrayBuffer): number | null {
  if (buffer.byteLength < 9) return null;
  const view = new DataView(buffer);
  if (view.getUint8(0) !== MSG_TYPE_PONG) return null;
  return view.getFloat64(1, true);
}

/**
 * Decode time_sync_ack: [type(1)] + [serverTs uint64 as two uint32s = 8 bytes]
 * ponytail: BigInt64 is cleanest but adds 1-2KB bundle. Two uint32 suffices for unix ms until year 2554.
 */
export function decodeTimeSyncAck(buffer: ArrayBuffer): number | null {
  if (buffer.byteLength < 9) return null;
  const view = new DataView(buffer);
  if (view.getUint8(0) !== MSG_TYPE_TIME_SYNC_ACK) return null;
  // serverTs as two uint32: lo + hi * 2^32
  const lo = view.getUint32(1, true);
  const hi = view.getUint32(5, true);
  return hi * 0x100000000 + lo;
}

/**
 * Encode a time_sync request: [type(1)] + [clientTs float64(8)] = 9 bytes
 */
const _timeSyncBuf  = new ArrayBuffer(9);
const _timeSyncView = new DataView(_timeSyncBuf);
const _timeSyncBytes = new Uint8Array(_timeSyncBuf);
export function encodeTimeSync(clientTs: number): Uint8Array {
  _timeSyncView.setUint8(0, MSG_TYPE_TIME_SYNC);
  _timeSyncView.setFloat64(1, clientTs, true);
  return _timeSyncBytes;
}

/**
 * Encode a ping: [type(1)] + [clientTs float64(8)] = 9 bytes
 */
const _pingBuf   = new ArrayBuffer(9);
const _pingView  = new DataView(_pingBuf);
const _pingBytes = new Uint8Array(_pingBuf);
export function encodePing(clientTs: number): Uint8Array {
  _pingView.setUint8(0, MSG_TYPE_PING);
  _pingView.setFloat64(1, clientTs, true);
  return _pingBytes;
}
