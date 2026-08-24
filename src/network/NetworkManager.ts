// NetworkManager.ts: PlayroomKit wrapper for custom Go WebSocket server
// Designed to keep changes to main.ts and BossController.ts minimal.
import { CHARACTER_CONFIG } from '../character/character-config.ts';
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

    private lastSendTimes: Record<string, number> = {};

    public setState(key: string, value: any) {
        // 1. Dirty check: Only send if the value actually changed
        const currentValStr = JSON.stringify(this.state[key]);
        const newValStr = JSON.stringify(value);
        if (currentValStr === newValStr) {
            return;
        }

        this.state[key] = value;

        // 2. Throttle continuous values like pos and rot (max once every 50ms / 20 Hz)
        if (key === 'pos' || key === 'rot') {
            const now = performance.now();
            const lastSend = this.lastSendTimes[key] || 0;
            if (now - lastSend < 50) {
                return; // Skip this frame's update to save bandwidth
            }
            this.lastSendTimes[key] = now;
        }

        // Send state to Go Server
        NetworkManager.send({
            type: "state_update",
            key,
            value
        });
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

    public static send(msg: any) {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            // Use msgpack binary for smaller payloads (30-50% smaller than JSON)
            const encoded = encode(msg);
            this.socket.send(encoded);
        }
    }

    public static async insertCoin(): Promise<void> {
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
        let name = localStorage.getItem("playerName") || "Player-" + Math.floor(100 + Math.random() * 900);
        localStorage.setItem("playerName", name);

        // Fetch JWT token from /login endpoint before connecting
        const httpBase = import.meta.env.VITE_API_URL || `${window.location.protocol}//${window.location.hostname}:8080`;
        let token = "";
        try {
            const resp = await fetch(`${httpBase}/login`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name }),
            });
            if (resp.ok) {
                const data = await resp.json();
                token = data.token || "";
            }
        } catch (e) {
            console.warn("Login failed, connecting without token (server may not require auth):", e);
        }

        return new Promise((resolve) => {
            let wsBaseUrl = import.meta.env.VITE_WS_URL;
            if (!wsBaseUrl) {
                const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
                wsBaseUrl = `${protocol}//${window.location.hostname}:8080/ws`;
            }
            // ponytail: token as query param — browsers can't set headers on WebSocket upgrade.
            // Ceiling: use Sec-WebSocket-Protocol subprotocol for token when browser support matures.
            const wsUrl = `${wsBaseUrl}?room=${this.roomID}&token=${encodeURIComponent(token)}`;
            console.log("Connecting to WebSocket:", wsUrl);

            this.resolveInitPromise = resolve;
            this.socket = new WebSocket(wsUrl);
            // Accept binary (msgpack) messages
            this.socket.binaryType = 'arraybuffer';

            this.socket.onopen = () => {
                console.log("Connected to Go multiplayer backend. Room:", this.roomID);
            };

            this.socket.onmessage = (event) => {
                try {
                    let msg: any;
                    if (event.data instanceof ArrayBuffer) {
                        // Binary message = msgpack
                        msg = decode(new Uint8Array(event.data));
                    } else {
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
                NetworkManager.showConnectionLostOverlay();
            };
        });
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
                if (msg.config) {
                    Object.assign(CHARACTER_CONFIG.combat, msg.config);
                    console.log("Authoritative combat config synced from server:", CHARACTER_CONFIG.combat);
                }
                if (msg.npcConfig) {
                    this.npcConfig = msg.npcConfig;
                    console.log("Authoritative NPC config synced from server:", this.npcConfig);
                }
                this.localPlayer = new Player(msg.playerId, localStorage.getItem("playerName") || "Player");
                this.playersMap.set(msg.playerId, this.localPlayer);
                
                if (this.resolveInitPromise) {
                    this.resolveInitPromise();
                    this.resolveInitPromise = null;
                }
                
                this.joinCallbacks.forEach(cb => cb(this.localPlayer!));
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
                this.roomState["bossHp"] = msg.bossHp;
                this.bossDamagedCallbacks.forEach(cb => cb(msg));
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

            case "room_state_update":
                this.roomState[msg.key] = msg.value;
                break;

            case "rpc":
                const handler = this.rpcHandlers.get(msg.name);
                if (handler) {
                    handler(msg.data, msg.senderId);
                }
                break;
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
export const insertCoin = () => NetworkManager.insertCoin();
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
        NetworkManager.send({
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
