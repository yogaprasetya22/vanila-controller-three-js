import { CHARACTER_CONFIG } from '../entities/player/PlayerConfig.ts';
import { BaseEnemyController } from '../entities/enemy/BaseEnemyController.ts';

export class UIManager {
  private static timeLabel: HTMLDivElement | null = null;
  private static webglStatsEl: HTMLDivElement | null = null;
  private static bossUiContainer: HTMLDivElement | null = null;
  private static bossHpBarFg: HTMLDivElement | null = null;
  private static bossHpBarText: HTMLDivElement | null = null;
  private static errorEl: HTMLDivElement | null = null;

  public static init() {
    // ── Time of Day HUD ──
    this.timeLabel = document.createElement('div');
    this.timeLabel.style.cssText = 'position:absolute;top:20px;left:450px;background:rgba(10,10,15,0.75);color:#00ffaa;border:1px solid rgba(0,255,170,0.3);padding:10px 15px;border-radius:5px;font-family:sans-serif;font-weight:bold;z-index:9999;backdrop-filter:blur(5px);pointer-events:none;transition:all 0.3s;';
    this.timeLabel.innerText = 'Waktu: Pagi';
    document.body.appendChild(this.timeLabel);

    // ── WebGL Profiler HUD ──
    this.webglStatsEl = document.createElement('div');
    this.webglStatsEl.id = 'webgl-stats';
    this.webglStatsEl.style.cssText = `
      position: fixed;
      top: 60px;
      left: 20px;
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
