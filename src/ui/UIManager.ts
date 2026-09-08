import { CHARACTER_CONFIG } from '../entities/player/PlayerConfig.ts';
import { BaseEnemyController } from '../entities/enemy/BaseEnemyController.ts';

export class UIManager {
  private static timeLabel: HTMLDivElement | null = null;
  private static webglStatsEl: HTMLDivElement | null = null;
  private static bossUiContainer: HTMLDivElement | null = null;
  private static bossHpBarFg: HTMLDivElement | null = null;
  private static bossHpBarText: HTMLDivElement | null = null;
  private static errorEl: HTMLDivElement | null = null;

  // ── Player Profile HUD Elements ──
  private static playerProfileEl: HTMLDivElement | null = null;
  private static profileAvatarIcon: HTMLDivElement | null = null;
  private static profileLevelBadge: HTMLDivElement | null = null;
  private static profileNameText: HTMLDivElement | null = null;
  private static profileRoleText: HTMLDivElement | null = null;
  private static profileHpFg: HTMLDivElement | null = null;
  private static profileHpText: HTMLDivElement | null = null;
  private static profileMpFg: HTMLDivElement | null = null;
  private static profileMpText: HTMLDivElement | null = null;
  private static profileXpFg: HTMLDivElement | null = null;
  private static profileXpText: HTMLDivElement | null = null;

  public static init() {
    // ── MMORPG Player Profile HUD (Top-Left) ──
    this.playerProfileEl = document.createElement('div');
    this.playerProfileEl.id = 'player-profile-hud';
    this.playerProfileEl.style.cssText = `
      position: fixed;
      top: 18px;
      left: 18px;
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 8px 14px 8px 8px;
      background: linear-gradient(135deg, rgba(18, 14, 10, 0.88) 0%, rgba(28, 18, 12, 0.78) 100%);
      backdrop-filter: blur(14px) saturate(180%);
      -webkit-backdrop-filter: blur(14px) saturate(180%);
      border: 1px solid rgba(251, 146, 60, 0.35);
      border-radius: 16px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.6), 0 0 20px rgba(251, 146, 60, 0.12) inset;
      font-family: 'Outfit', sans-serif;
      z-index: 9999;
      pointer-events: none;
      user-select: none;
      transition: transform 0.2s ease, opacity 0.3s ease;
    `;

    this.playerProfileEl.innerHTML = `
      <!-- Avatar Section -->
      <div style="position: relative; width: 54px; height: 54px; flex-shrink: 0;">
        <div id="player-profile-avatar" style="
          width: 100%; height: 100%; border-radius: 50%;
          background: radial-gradient(circle at 35% 35%, #f59e0b 0%, #b45309 60%, #451a03 100%);
          border: 2px solid #fbbf24;
          box-shadow: 0 0 12px rgba(245, 158, 11, 0.6), inset 0 2px 4px rgba(255, 255, 255, 0.4);
          display: flex; align-items: center; justify-content: center;
          font-size: 24px; text-shadow: 0 2px 6px rgba(0, 0, 0, 0.7);
        ">🏹</div>
        
        <!-- Level Badge -->
        <div id="player-profile-level" style="
          position: absolute; bottom: -4px; right: -4px;
          background: linear-gradient(135deg, #d97706, #78350f);
          border: 1.5px solid #fbbf24;
          color: #fffbeb; font-size: 10px; font-weight: 900;
          padding: 1px 6px; border-radius: 10px;
          box-shadow: 0 2px 6px rgba(0, 0, 0, 0.8);
          letter-spacing: 0.5px; font-family: monospace;
        ">LV 1</div>
      </div>

      <!-- Info & Bars Section -->
      <div style="display: flex; flex-direction: column; gap: 4px; min-width: 170px;">
        <!-- Header: Name & Role -->
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
          <span id="player-profile-name" style="
            font-size: 13px; font-weight: 800; color: #fff8ee;
            letter-spacing: 0.5px; text-shadow: 0 1px 4px rgba(0, 0, 0, 0.8);
            max-width: 110px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
          ">Player</span>
          <span id="player-profile-role" style="
            font-size: 9px; font-weight: 800; color: #fb923c;
            background: rgba(251, 146, 60, 0.15); border: 1px solid rgba(251, 146, 60, 0.3);
            padding: 1px 6px; border-radius: 4px; letter-spacing: 1px; text-transform: uppercase;
          ">ARCHER</span>
        </div>

        <!-- HP Bar -->
        <div style="position: relative; width: 100%; height: 13px; background: rgba(20, 10, 10, 0.85); border-radius: 4px; overflow: hidden; border: 1px solid rgba(239, 68, 68, 0.3);">
          <div id="player-profile-hp-fg" style="
            width: 100%; height: 100%;
            background: linear-gradient(90deg, #10b981 0%, #34d399 50%, #6ee7b7 100%);
            box-shadow: 0 0 8px rgba(16, 185, 129, 0.6);
            transition: width 0.2s cubic-bezier(0.4, 0, 0.2, 1), background 0.3s;
          "></div>
          <div id="player-profile-hp-text" style="
            position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
            font-size: 9px; font-weight: 800; color: #ffffff; text-shadow: 0 1px 2px #000;
            font-family: monospace; letter-spacing: 0.5px;
          ">100 / 100</div>
        </div>

        <!-- MP / Stamina Bar -->
        <div style="position: relative; width: 100%; height: 9px; background: rgba(10, 15, 25, 0.85); border-radius: 3px; overflow: hidden; border: 1px solid rgba(59, 130, 246, 0.3);">
          <div id="player-profile-mp-fg" style="
            width: 100%; height: 100%;
            background: linear-gradient(90deg, #2563eb 0%, #38bdf8 100%);
            box-shadow: 0 0 6px rgba(56, 189, 248, 0.5);
            transition: width 0.2s cubic-bezier(0.4, 0, 0.2, 1);
          "></div>
          <div id="player-profile-mp-text" style="
            position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
            font-size: 8px; font-weight: 800; color: #ffffff; text-shadow: 0 1px 2px #000;
            font-family: monospace; letter-spacing: 0.5px;
          ">100 / 100</div>
        </div>

        <!-- EXP Progress Bar (Thin Bottom) -->
        <div style="position: relative; width: 100%; height: 4px; background: rgba(20, 20, 20, 0.9); border-radius: 2px; overflow: hidden; border: 0.5px solid rgba(245, 158, 11, 0.25);">
          <div id="player-profile-xp-fg" style="
            width: 45%; height: 100%;
            background: linear-gradient(90deg, #d97706, #fbbf24);
            box-shadow: 0 0 4px #fbbf24;
            transition: width 0.3s ease-out;
          "></div>
        </div>
      </div>
    `;
    document.body.appendChild(this.playerProfileEl);

    this.profileAvatarIcon = document.getElementById('player-profile-avatar') as HTMLDivElement;
    this.profileLevelBadge = document.getElementById('player-profile-level') as HTMLDivElement;
    this.profileNameText   = document.getElementById('player-profile-name')   as HTMLDivElement;
    this.profileRoleText   = document.getElementById('player-profile-role')   as HTMLDivElement;
    this.profileHpFg       = document.getElementById('player-profile-hp-fg')  as HTMLDivElement;
    this.profileHpText     = document.getElementById('player-profile-hp-text') as HTMLDivElement;
    this.profileMpFg       = document.getElementById('player-profile-mp-fg')  as HTMLDivElement;
    this.profileMpText     = document.getElementById('player-profile-mp-text') as HTMLDivElement;
    this.profileXpFg       = document.getElementById('player-profile-xp-fg')  as HTMLDivElement;

    // ── Time of Day HUD ──
    this.timeLabel = document.createElement('div');
    this.timeLabel.style.cssText = 'position:absolute;top:20px;left:300px;background:rgba(10,10,15,0.75);color:#00ffaa;border:1px solid rgba(0,255,170,0.3);padding:8px 14px;border-radius:8px;font-family:sans-serif;font-size:12px;font-weight:bold;z-index:9999;backdrop-filter:blur(5px);pointer-events:none;transition:all 0.3s;';
    this.timeLabel.innerText = 'Waktu: Pagi';
    document.body.appendChild(this.timeLabel);

    // ── WebGL Profiler HUD ──
    this.webglStatsEl = document.createElement('div');
    this.webglStatsEl.id = 'webgl-stats';
    this.webglStatsEl.style.cssText = `
      position: fixed;
      top: 105px;
      left: 18px;
      background: rgba(10, 10, 15, 0.75);
      color: #00ffaa;
      border: 1px solid rgba(0, 255, 170, 0.3);
      padding: 8px 12px;
      border-radius: 6px;
      font-family: monospace;
      font-size: 11px;
      z-index: 9999;
      pointer-events: none;
      backdrop-filter: blur(5px);
      line-height: 1.4;
    `;
    document.body.appendChild(this.webglStatsEl);

    // ── Boss HP Bar UI ──
    this.bossUiContainer = document.createElement('div');
    this.bossUiContainer.id = 'boss-ui-container';
    this.bossUiContainer.style.cssText = `
      position: absolute; top: 24px; left: 50%; transform: translateX(-50%);
      width: 420px; background: rgba(10, 5, 5, 0.65);
      backdrop-filter: blur(12px) saturate(180%); border: 1px solid rgba(239, 68, 68, 0.45);
      border-radius: 12px; padding: 10px 16px;
      box-shadow: 0 8px 32px rgba(239, 68, 68, 0.15), 0 0 16px rgba(0, 0, 0, 0.8);
      color: white; font-family: 'Outfit', sans-serif; z-index: 9999; display: none;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    `;
    this.bossUiContainer.innerHTML = `
      <div style="font-weight:800;font-size:14px;text-transform:uppercase;color:#ef4444;letter-spacing:2px;text-shadow:0 0 8px rgba(239,68,68,0.8);margin-bottom:6px;text-align:center;font-family:'Press Start 2P',monospace;">Giant Chief Barbarian</div>
      <div style="position:relative;width:100%;height:18px;background:rgba(30,5,5,0.9);border-radius:6px;overflow:hidden;border:1.5px solid rgba(255,255,255,0.12);">
        <div id="boss-hp-bar-fg" style="width:100%;height:100%;background:linear-gradient(90deg,#b91c1c,#ef4444,#f87171);box-shadow:0 0 8px #ef4444;transition:width 0.1s ease-out;"></div>
        <div id="boss-hp-bar-text" style="position:absolute;width:100%;height:100%;top:0;left:0;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:900;text-shadow:1px 1px 2px black;font-family:monospace;letter-spacing:1px;">10000000 / 10000000</div>
      </div>
    `;
    document.body.appendChild(this.bossUiContainer);

    this.bossHpBarFg   = document.getElementById('boss-hp-bar-fg')   as HTMLDivElement;
    this.bossHpBarText = document.getElementById('boss-hp-bar-text') as HTMLDivElement;
    this.errorEl        = document.getElementById("lobby-error") as HTMLDivElement;

    // ── Global Error Overlays ──
    window.addEventListener('error', (e) => {
      const el = document.createElement('div');
      el.style.cssText = 'position:absolute;bottom:100px;left:20px;background:rgba(255,0,0,0.85);color:white;padding:15px;border-radius:5px;font-family:monospace;font-size:12px;z-index:9999;max-width:80%';
      el.innerText = `Error: ${e.message}\nAt: ${e.filename}:${e.lineno}`;
      document.body.appendChild(el);
    });

    window.addEventListener('unhandledrejection', (e) => {
      const el = document.createElement('div');
      el.style.cssText = 'position:absolute;bottom:200px;left:20px;background:rgba(255,100,0,0.85);color:white;padding:15px;border-radius:5px;font-family:monospace;font-size:12px;z-index:9999;max-width:80%';
      el.innerText = `Promise Error: ${e.reason?.message ?? e.reason ?? 'Unknown Reason'}`;
      document.body.appendChild(el);
    });
  }

  public static updatePlayerProfile(data: {
    name?: string;
    role?: string;
    level?: number;
    hp?: number;
    maxHp?: number;
    mp?: number;
    maxMp?: number;
    xp?: number;
    maxXp?: number;
  }) {
    if (!this.playerProfileEl) return;

    if (data.name && this.profileNameText) {
      this.profileNameText.innerText = data.name;
    }

    if (data.role && this.profileRoleText) {
      this.profileRoleText.innerText = data.role.toUpperCase();
      if (this.profileAvatarIcon) {
        const roleLower = data.role.toLowerCase();
        let icon = '🏹';
        if (roleLower.includes('knight')) icon = '⚔️';
        else if (roleLower.includes('tank')) icon = '🛡️';
        else if (roleLower.includes('assassin')) icon = '🗡️';
        else if (roleLower.includes('mage')) icon = '🔮';
        this.profileAvatarIcon.innerText = icon;
      }
    }

    if (typeof data.level === 'number' && this.profileLevelBadge) {
      this.profileLevelBadge.innerText = `LV ${data.level}`;
    }

    if (typeof data.hp === 'number' && this.profileHpFg && this.profileHpText) {
      const maxHp = data.maxHp ?? 100;
      const hp = Math.max(0, data.hp);
      const ratio = Math.min(1.0, hp / maxHp);
      this.profileHpFg.style.width = `${(ratio * 100).toFixed(1)}%`;
      this.profileHpText.innerText = `${Math.ceil(hp)} / ${maxHp}`;

      // Dynamic critical health glow (Red if <= 25%, Emerald otherwise)
      if (ratio <= 0.25) {
        this.profileHpFg.style.background = 'linear-gradient(90deg, #b91c1c 0%, #ef4444 50%, #f87171 100%)';
        this.profileHpFg.style.boxShadow = '0 0 10px #ef4444';
      } else {
        this.profileHpFg.style.background = 'linear-gradient(90deg, #10b981 0%, #34d399 50%, #6ee7b7 100%)';
        this.profileHpFg.style.boxShadow = '0 0 8px rgba(16, 185, 129, 0.6)';
      }
    }

    if (typeof data.mp === 'number' && this.profileMpFg && this.profileMpText) {
      const maxMp = data.maxMp ?? 100;
      const mp = Math.max(0, data.mp);
      const ratio = Math.min(1.0, mp / maxMp);
      this.profileMpFg.style.width = `${(ratio * 100).toFixed(1)}%`;
      this.profileMpText.innerText = `${Math.ceil(mp)} / ${maxMp}`;
    }

    if (typeof data.xp === 'number' && this.profileXpFg) {
      const maxXp = data.maxXp ?? 1000;
      const xpRatio = Math.min(1.0, Math.max(0, data.xp / maxXp));
      this.profileXpFg.style.width = `${(xpRatio * 100).toFixed(1)}%`;
    }
  }

  public static updateTimeLabel(period: string) {
    if (this.timeLabel) {
      this.timeLabel.innerText = `Waktu: ${period}`;
    }
  }

  public static updatePerformanceHUD(frameCount: number, pingStr: string, memoryInfo: any, renderInfo: any) {
    if (this.webglStatsEl) {
      this.webglStatsEl.innerHTML = `
        <b style="color:#ffffff;">PERFORMANCE HUD</b><br/>
        FPS: <span style="color:#00ffaa; font-weight:bold;">${frameCount}</span><br/>
        Ping: <span style="color:#3b82f6; font-weight:bold;">${pingStr} ms</span><br/>
        Geometries: ${memoryInfo.geometries}<br/>
        Textures: ${memoryInfo.textures}<br/>
        Draw Calls: ${renderInfo.calls}<br/>
        Triangles: ${renderInfo.triangles}
      `;
    }
  }

  public static updateBossHP(mainBoss: BaseEnemyController | null) {
    if (!this.bossUiContainer || !this.bossHpBarFg || !this.bossHpBarText) return;
    if (mainBoss) {
      this.bossUiContainer.style.display = 'block';
      const ratio = Math.max(0, mainBoss.hp / mainBoss.maxHp);
      this.bossHpBarFg.style.width    = `${ratio * 100}%`;
      this.bossHpBarText.innerText    = `${mainBoss.npcName}: ${mainBoss.hp} / ${mainBoss.maxHp}`;
      const nConfig = CHARACTER_CONFIG.npcs[mainBoss.npcType as 'mob' | 'raid_boss' | 'world_boss'] || CHARACTER_CONFIG.npcs.mob;
      this.bossHpBarFg.style.backgroundColor = nConfig.hudColor;
    } else {
      this.bossUiContainer.style.display = 'none';
    }
  }

  private static deathOverlay: HTMLDivElement | null = null;

  public static showDeathScreen(onRespawn: () => void) {
    if (!this.deathOverlay) {
      this.deathOverlay = document.createElement('div');
      this.deathOverlay.id = 'death-overlay';
      this.deathOverlay.style.cssText = `
        position: fixed; inset: 0; z-index: 99999;
        background: radial-gradient(circle, rgba(150, 0, 0, 0.4) 0%, rgba(10, 0, 0, 0.95) 100%);
        backdrop-filter: blur(8px);
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        animation: fadeIn 0.4s ease-out forwards;
        font-family: 'Outfit', sans-serif;
      `;
      this.deathOverlay.innerHTML = `
        <div style="font-size: 56px; font-weight: 900; color: #ef4444; letter-spacing: 4px; text-shadow: 0 0 24px rgba(239, 68, 68, 0.8); margin-bottom: 8px; font-family: 'Press Start 2P', monospace;">YOU DIED</div>
        <div style="font-size: 16px; color: #fca5a5; margin-bottom: 32px; letter-spacing: 1px;">Karakter Anda tumbang dalam pertempuran.</div>
        <button id="respawn-btn" style="
          background: linear-gradient(135deg, #ef4444, #b91c1c);
          color: white; border: 1px solid rgba(255, 255, 255, 0.3);
          padding: 14px 36px; border-radius: 8px; font-size: 16px; font-weight: 800;
          letter-spacing: 1px; cursor: pointer; transition: all 0.2s;
          box-shadow: 0 0 20px rgba(239, 68, 68, 0.5);
        ">RESPAWN</button>
      `;
      document.body.appendChild(this.deathOverlay);
    }
    this.deathOverlay.style.display = 'flex';
    const btn = document.getElementById('respawn-btn');
    if (btn) {
      btn.onclick = () => {
        onRespawn();
      };
      btn.onmouseover = () => {
        btn.style.transform = 'scale(1.06)';
        btn.style.boxShadow = '0 0 30px rgba(239, 68, 68, 0.8)';
      };
      btn.onmouseout = () => {
        btn.style.transform = 'scale(1.0)';
        btn.style.boxShadow = '0 0 20px rgba(239, 68, 68, 0.5)';
      };
    }
  }

  public static hideDeathScreen() {
    if (this.deathOverlay) {
      this.deathOverlay.style.display = 'none';
    }
  }

  public static showError(msg: string, type: "error"|"info" = "error") {
    if (!this.errorEl) return;
    this.errorEl.textContent = msg;
    this.errorEl.className = type;
    this.errorEl.style.display = "block";
  }

  public static hideError() {
    if (this.errorEl) this.errorEl.style.display = "none";
  }

  public static showGameUI() {
    const uiEl = document.getElementById("ui");
    const statsEl = document.getElementById("stats");
    const dpsEl = document.getElementById("dps-panel");
    if (uiEl) uiEl.style.display = "block";
    if (statsEl) statsEl.style.display = "block";
    if (dpsEl) dpsEl.style.display = "block";
  }
}
