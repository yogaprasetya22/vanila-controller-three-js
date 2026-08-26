// NetworkManager.ts: PlayroomKit wrapper for custom Go WebSocket server
// Designed to keep changes to main.ts and BossController.ts minimal.
import { CHARACTER_CONFIG } from '../entities/player/PlayerConfig.ts';
import { encode, decode } from '@msgpack/msgpack';
type PlayerStateCallback = (val: any) => void;
type RPCMode = 'HOST' | 'OTHERS' | 'ALL';

export class Player {
    public id: string;
    public name: string;
    private state: Record<string, any> = {};
    private quitCallbacks: Array<() => void> = [];

    constructor(id: string, name: string) {
        this.id = id;
        this.name = name;
    }

    public getProfile() {
        return { name: this.name };
    }

    private pendingBatch: Record<string, any> = {};

    public setState(key: string, value: any) {
        // Dirty check: only accumulate if value changed
        const currentValStr = JSON.stringify(this.state[key]);
        const newValStr     = JSON.stringify(value);
        if (currentValStr === newValStr) return;

        this.state[key]        = value;
        this.pendingBatch[key] = value;
    }


    public flushBatch() {
        const hasBatch = Object.keys(this.pendingBatch).length > 0;

        if (hasBatch) {
            const batch = this.pendingBatch;
            this.pendingBatch = {}; // swap out atomically
            NetworkManager.send({
                type: "state_updates_batch",
                value: batch
            });
        }

        // Flush queued RPCs together with the state batch in the same tick
        // ponytail: coalesces keydown-rapid RPC bursts (skill spam) into at-most 30Hz sends,
        // preventing TCP buffer flooding that causes ping spikes during aggressive input.
        const rpcs = NetworkManager.pendingRPCs.splice(0);
        for (const rpc of rpcs) {
            NetworkManager.send(rpc);
        }
    }

    public getState(key: string) {
        return this.state[key];
    }

    public onQuit(callback: () => void) {
        this.quitCallbacks.push(callback);
    }

    public triggerQuit() {
        this.quitCallbacks.forEach(cb => cb());
    }

    public setInternalState(key: string, value: any) {
        this.state[key] = value;
    }
}

export class NetworkManager {
    private static socket: WebSocket | null = null;
    private static roomID = "lobby";
    private static localPlayer: Player | null = null;
    private static playersMap: Map<string, Player> = new Map();
    private static roomState: Record<string, any> = {};
    private static hostID = "";
    private static joinCallbacks: Array<(player: Player) => void> = [];
    private static rpcHandlers: Map<string, (data: any, senderId: string) => void> = new Map();
    private static bossDamagedCallbacks: Array<(data: any) => void> = [];
    private static bossSkillCallbacks: Array<(data: any) => void> = [];
    private static npcConfig: any = null;
    private static resolveInitPromise: (() => void) | null = null;
    private static heartbeatInterval: any = null;
    private static reconnectAttempts = 0;
    private static maxReconnectAttempts = 8;
    public static ping = 0;
    private static pingInterval: any = null;
    public static bytesSent = 0;
    public static bytesReceived = 0;
    public static packetsSent = 0;
    public static packetsReceived = 0;
    public static flushTimeouts: Record<string, any> = {};

    // Queued RPCs — flushed together with state batch in the 30Hz pump
    // ponytail: prevents direct-send RPC bursts from flooding TCP send buffer
    public static pendingRPCs: any[] = [];

    // Clock sync: offset between server unix-ms and client performance.now()
    // serverTs ≈ performance.now() + clockOffset
    // ponytail: one NTP round; multi-sample Cristian's algo if drift > 50ms is detected
    public static clockOffset = 0;
    private static clockSyncInterval: any = null;

    // 30Hz flush pump — drives all Player.setState() batches
    private static flushPumpId: ReturnType<typeof setInterval> | null = null;

    public static startFlushPump() {
        if (this.flushPumpId !== null) return;
        this.flushPumpId = setInterval(() => {
            this.localPlayer?.flushBatch();
        }, 33);
    }


    public static stopFlushPump() {
        if (this.flushPumpId !== null) {
            clearInterval(this.flushPumpId);
            this.flushPumpId = null;
        }
    }


    public static send(msg: any) {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            // Use msgpack binary for smaller payloads (30-50% smaller than JSON)
            const encoded = encode(msg);
            this.bytesSent += encoded.byteLength;
            this.packetsSent++;
            this.socket.send(encoded);
        }
    }

    public static async insertCoin(username?: string, password?: string): Promise<void> {
        // Clean up previous socket connection if it exists to avoid leaks/gaps during reconnects
        if (this.socket) {
            this.socket.onopen = null;
            this.socket.onmessage = null;
            this.socket.onerror = null;
            this.socket.onclose = null;
            try { this.socket.close(); } catch (e) {}
            this.socket = null;
        }

        // Read Room ID from URL Hash. e.g. #ROOM123
        let hash = window.location.hash;
        if (!hash || hash === "#") {
            const randomCode = "ROOM-" + Math.floor(1000 + Math.random() * 9000);
            window.location.hash = randomCode;
            this.roomID = randomCode;
        } else {
            this.roomID = hash.substring(1);
        }

        // Simple prompt or fallback for username
        let name = username || localStorage.getItem("playerName") || "Player-" + Math.floor(100 + Math.random() * 900);
        localStorage.setItem("playerName", name);
        let pass = password || "";

        // Fetch JWT token from /login endpoint if we have a password.
        // If password is empty (e.g. active session reload), we bypass /login and rely on the HTTP-only cookie.
        const httpBase = import.meta.env.VITE_API_URL || `${window.location.protocol}//${window.location.hostname}:8080`;
        let token = "";
        if (pass) {
            try {
                const role = localStorage.getItem("playerRole") || "archer";
                const resp = await fetch(`${httpBase}/login`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    credentials: "include", // send & receive HTTP-only cookie
                    body: JSON.stringify({ username: name, password: pass, role }),
                });
                if (resp.ok) {
                    const data = await resp.json();
                    token = data.token || "";
                } else {
                    const errorData = await resp.json().catch(() => ({}));
                    throw new Error(errorData.error || "Authentication failed");
                }
            } catch (e: any) {
                console.warn("[Auth] Login failed:", e.message);
                throw e; // propagate to lobby
            }
        }

        // Split Handshake: Load initial static game configuration over HTTP instead of WebSocket
        try {
            const role = localStorage.getItem("playerRole") || "archer";
            const configResp = await fetch(`${httpBase}/room/config?role=${role}`, {
                credentials: "include",
            });
            if (configResp.ok) {
                const configData = await configResp.json();
                if (configData.config) {
                    Object.assign(CHARACTER_CONFIG.combat, configData.config);
                    if (configData.config.projectileSpeed !== undefined) {
                        CHARACTER_CONFIG.projectiles.speed = configData.config.projectileSpeed;
                    }
                    if (configData.config.projectileMaxDist !== undefined) {
                        CHARACTER_CONFIG.projectiles.maxDistance = configData.config.projectileMaxDist;
                    }
                    console.log("[REST] Authoritative combat config loaded:", CHARACTER_CONFIG.combat);
                }
                if (configData.npcConfig) {
                    this.npcConfig = configData.npcConfig;
                    console.log("[REST] Authoritative NPC config loaded:", this.npcConfig);
                }
            }
        } catch (e) {
            console.error("Failed to load initial configurations via REST:", e);
        }

        // Generate a persistent session-based player ID unique to this tab
        let sessionPlayerId = sessionStorage.getItem("sessionPlayerId");
        if (!sessionPlayerId) {
            sessionPlayerId = "p_" + Math.floor(1000 + Math.random() * 9000);
            sessionStorage.setItem("sessionPlayerId", sessionPlayerId);
        }

        return new Promise((resolve) => {
            let wsBaseUrl = import.meta.env.VITE_WS_URL;
            if (!wsBaseUrl) {
                const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
                wsBaseUrl = `${protocol}//${window.location.hostname}:8080/ws`;
            }
            // ponytail: token as query param — browsers can't set headers on WebSocket upgrade.
            // Ceiling: use Sec-WebSocket-Protocol subprotocol for token when browser support matures.
            const wsUrl = `${wsBaseUrl}?room=${this.roomID}&token=${encodeURIComponent(token)}&playerId=${sessionPlayerId}`;
            console.log("Connecting to WebSocket:", wsUrl);

            this.resolveInitPromise = resolve;
            this.socket = new WebSocket(wsUrl);
            // Accept binary (msgpack) messages
            this.socket.binaryType = 'arraybuffer';

            this.socket.onopen = () => {
                console.log("Connected to Go multiplayer backend. Room:", this.roomID);
                this.reconnectAttempts = 0;
                NetworkManager.startHeartbeat();
                // Pilar 4: kick off clock sync immediately after connect
                NetworkManager.sendTimeSync();
                NetworkManager.startClockSyncInterval();
            };


            this.socket.onmessage = (event) => {
                try {
                    let msg: any;
                    if (event.data instanceof ArrayBuffer) {
                        this.bytesReceived += event.data.byteLength;
                        this.packetsReceived++;
                        // Binary message = msgpack
                        msg = decode(new Uint8Array(event.data));
                    } else {
                        if (typeof event.data === 'string') {
                            this.bytesReceived += event.data.length;
                        }
                        this.packetsReceived++;
                        // Text message = JSON (fallback for backward compatibility)
                        msg = JSON.parse(event.data);
                    }
                    this.handleMessage(msg);
                } catch (e) {
                    console.error("Failed to parse websocket message", e);
                }
            };

            this.socket.onclose = () => {
                console.warn("WebSocket disconnected.");
                NetworkManager.stopHeartbeat();
                NetworkManager.attemptReconnect();
            };
        });
    }

    private static attemptReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error("Max reconnect attempts reached");
            this.showConnectionLostOverlay();
            return;
        }

        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 8000);
        this.reconnectAttempts++;
        console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

        setTimeout(() => {
            this.insertCoin().catch(() => {
                // connection fail will trigger onclose and retry
            });
        }, delay);
    }

    private static startHeartbeat() {
        this.stopHeartbeat();
        this.heartbeatInterval = setInterval(() => {
            this.send({ type: "heartbeat" });
        }, 15000); // Send heartbeat every 15 seconds
    }

    public static startPingInterval() {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
        }
        this.pingInterval = setInterval(() => {
            this.send({ type: "ping", value: performance.now() });
        }, 2000);
    }

    private static stopHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }
        if (this.clockSyncInterval) {
            clearInterval(this.clockSyncInterval);
            this.clockSyncInterval = null;
        }
    }

    // Send a time_sync request and record the send timestamp
    private static _pendingTimeSyncTs = 0;
    private static sendTimeSync() {
        this._pendingTimeSyncTs = performance.now();
        this.send({ type: 'time_sync', clientTs: this._pendingTimeSyncTs });
    }

    private static startClockSyncInterval() {
        if (this.clockSyncInterval) clearInterval(this.clockSyncInterval);
        // Re-sync every 30s to correct clock drift
        this.clockSyncInterval = setInterval(() => this.sendTimeSync(), 30_000);
    }



    private static showConnectionLostOverlay() {
        if (document.getElementById('connection-lost-overlay')) return;
        const overlay = document.createElement('div');
        overlay.id = 'connection-lost-overlay';
        overlay.style.cssText = `
            position: absolute;
            top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(5, 2, 2, 0.85);
            backdrop-filter: blur(15px);
            -webkit-backdrop-filter: blur(15px);
            display: flex; flex-direction: column; align-items: center; justify-content: center;
            z-index: 1000000;
            color: white;
            font-family: 'Outfit', sans-serif;
        `;
        overlay.innerHTML = `
            <div style="font-weight: 800; font-size: 26px; text-transform: uppercase; color: #ef4444; letter-spacing: 2px; text-shadow: 0 0 12px rgba(239, 68, 68, 0.6); margin-bottom: 10px; font-family: 'Press Start 2P', monospace;">Koneksi Terputus</div>
            <div style="font-size: 14px; color: rgba(255,255,255,0.7); margin-bottom: 25px; font-family: monospace;">Hubungan dengan server multiplayer terputus karena batas waktu (idle).</div>
            <button id="reconnect-btn" style="background: #ef4444; border: none; border-radius: 6px; color: white; padding: 12px 24px; font-size: 14px; font-weight: 700; cursor: pointer; box-shadow: 0 4px 14px rgba(239, 68, 68, 0.4); transition: transform 0.2s, background 0.2s;">Sambung Kembali</button>
        `;
        document.body.appendChild(overlay);

        const btn = document.getElementById('reconnect-btn');
        if (btn) {
            btn.addEventListener('click', () => {
                window.location.reload();
            });
            btn.addEventListener('mouseover', () => {
                (btn.style as any).background = '#dc2626';
                (btn.style as any).transform = 'scale(1.05)';
            });
            btn.addEventListener('mouseout', () => {
                (btn.style as any).background = '#ef4444';
                (btn.style as any).transform = 'scale(1)';
            });
        }
    }

    private static handleMessage(msg: any) {
        switch (msg.type) {
            case "init":
                this.hostID = msg.hostId;

                // If reconnecting, do not duplicate local player controller / object
                const isNewPlayer = !this.playersMap.has(msg.playerId);
                if (isNewPlayer) {
                    this.localPlayer = new Player(msg.playerId, localStorage.getItem("playerName") || "Player");
                    this.playersMap.set(msg.playerId, this.localPlayer);
                }
                
                if (this.resolveInitPromise) {
                    this.resolveInitPromise();
                    this.resolveInitPromise = null;
                }
                
                if (isNewPlayer && this.localPlayer) {
                    this.joinCallbacks.forEach(cb => cb(this.localPlayer!));
                }
                // Start the 30Hz network batch flush pump now that localPlayer is ready
                NetworkManager.startFlushPump();
                break;

            case "player_joined":
                if (this.playersMap.has(msg.player.id)) return;
                const newPlayer = new Player(msg.player.id, msg.player.name);
                this.playersMap.set(msg.player.id, newPlayer);
                this.joinCallbacks.forEach(cb => cb(newPlayer));
                break;

            case "player_left":
                const leavingPlayer = this.playersMap.get(msg.playerId);
                if (leavingPlayer) {
                    leavingPlayer.triggerQuit();
                    this.playersMap.delete(msg.playerId);
                }
                if (msg.newHostId) {
                    this.hostID = msg.newHostId;
                }
                break;

            case "boss_damaged":
            case "npc_damaged":
                this.bossDamagedCallbacks.forEach(cb => cb(msg));
                break;

            case "npc_respawned":
                // Notify clients or handle locally
                break;

            case "boss_skill":
                this.bossSkillCallbacks.forEach(cb => cb(msg));
                break;

            case "state_update":
                const player = this.playersMap.get(msg.playerId);
                if (player) {
                    player.setInternalState(msg.key, msg.value);
                }
                break;

            case "state_updates_batch": {
                const p = this.playersMap.get(msg.playerId);
                if (p && msg.value) {
                    for (const [k, v] of Object.entries(msg.value)) {
                        p.setInternalState(k, v);
                    }
                }
                break;
            }

            case "world_snapshot": {
                // Pilar 3+4: Server sends AoI-filtered snapshot at 30Hz with serverTs
                const snapServerTs: number = msg.serverTs || 0;
                const snapPlayers: Array<any> = msg.players || [];
                for (const playerData of snapPlayers) {
                    const pid = playerData.id as string;
                    if (!pid) continue;
                    const p = this.playersMap.get(pid);
                    if (!p) continue;
                    // Inject serverTs so interpolator can use server timeline
                    p.setInternalState('_serverTs', snapServerTs);
                    for (const [k, v] of Object.entries(playerData)) {
                        if (k === 'id') continue;
                        p.setInternalState(k, v);
                    }
                }
                // AoI: server now also embeds npcs in snapshot for visible range
                if (msg.npcs) {
                    // Inject _snapshotServerTs so syncNPCs() can pass it to addSnapshot()
                    msg.npcs._snapshotServerTs = snapServerTs;
                    this.roomState['npcs'] = msg.npcs;
                }
                break;
            }

            case "room_state_update":
                this.roomState[msg.key] = msg.value;
                break;

            case "rpc":
                const handler = this.rpcHandlers.get(msg.name);
                if (handler) {
                    handler(msg.data, msg.senderId);
                }
                break;

            case "pong": {
                const rawPing = performance.now() - msg.value;
                NetworkManager.ping = NetworkManager.ping <= 0 
                    ? rawPing 
                    : NetworkManager.ping * 0.4 + rawPing * 0.6;
                break;
            }

            case "time_sync_ack": {
                // NTP Cristian's algorithm: offset = serverTs - (clientTs + rtt/2)
                const now = performance.now();
                const rtt = now - NetworkManager._pendingTimeSyncTs;
                // msg.serverTs is unix ms from Go server
                // We want: serverTs_in_perf_units = serverTs (unix ms) adjusted by epoch
                // Simpler: just track delta so: server_perf_now = msg.serverTs + clockOffset
                NetworkManager.clockOffset = msg.serverTs - (NetworkManager._pendingTimeSyncTs + rtt / 2);
                console.log(`[ClockSync] RTT=${rtt.toFixed(1)}ms offset=${NetworkManager.clockOffset.toFixed(1)}ms`);
                break;
            }
        }
    }

    public static onPlayerJoin(callback: (player: Player) => void) {
        this.joinCallbacks.push(callback);
        // Execute callback immediately for already joined players
        this.playersMap.forEach(player => callback(player));
    }

    public static myPlayer(): Player {
        if (!this.localPlayer) {
            // Fallback object to prevent null exceptions during init
            return new Player("temp", "Connecting...");
        }
        return this.localPlayer;
    }

    public static isHost(): boolean {
        if (!this.localPlayer) return false;
        return this.localPlayer.id === this.hostID;
    }

    public static setState(key: string, value: any) {
        const currentValStr = JSON.stringify(this.roomState[key]);
        const newValStr     = JSON.stringify(value);
        if (currentValStr === newValStr) return;

        this.roomState[key] = value;
        this.send({
            type: "room_state_update",
            key,
            value
        });
    }

    public static getState(key: string): any {
        return this.roomState[key];
    }

    public static onBossDamaged(callback: (data: any) => void) {
        this.bossDamagedCallbacks.push(callback);
    }

    public static onBossSkill(callback: (data: any) => void) {
        this.bossSkillCallbacks.push(callback);
    }

    public static getNPCConfig(): any {
        return this.npcConfig;
    }
}

// Global Exports mirroring playroomkit
export const insertCoin = (username?: string, password?: string) => NetworkManager.insertCoin(username, password);
export const onPlayerJoin = (cb: (p: Player) => void) => NetworkManager.onPlayerJoin(cb);
export const myPlayer = () => NetworkManager.myPlayer();
export const isHost = () => NetworkManager.isHost();
export const setState = (k: string, v: any) => NetworkManager.setState(k, v);
export const getState = (k: string) => NetworkManager.getState(k);
export const send = (msg: any) => NetworkManager.send(msg);
export const onBossDamaged = (cb: (data: any) => void) => NetworkManager.onBossDamaged(cb);
export const onBossSkill = (cb: (data: any) => void) => NetworkManager.onBossSkill(cb);
export const getNPCConfig = () => NetworkManager.getNPCConfig();

// RPC API to mirror PlayroomKit
export const RPC = {
    register: (name: string, callback: (data: any, senderId: string) => void) => {
        NetworkManager["rpcHandlers"].set(name, callback);
    },
    call: (name: string, data: any, mode: RPCMode = "ALL") => {
        // Enqueue RPC — will be sent in the next 30Hz flush pump tick together with
        // state_updates_batch. This prevents direct-send bursts (skill spam, rapid input)
        // from filling the TCP send buffer and causing ping spikes.
        NetworkManager.pendingRPCs.push({
            type: "rpc",
            name,
            data,
            senderId: NetworkManager.myPlayer().id
        });
    },
    Mode: {
        ALL: "ALL" as RPCMode,
        OTHERS: "OTHERS" as RPCMode,
        HOST: "HOST" as RPCMode
    }
};
