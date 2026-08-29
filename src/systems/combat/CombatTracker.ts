export class CombatTracker {
  public static totalDamageDealt = 0;
  public static totalAttacksCount = 0;
  public static combatStartTime = 0;
  public static damageTimestamps: { time: number; amount: number }[] = [];
  public static attackTimestamps: number[] = [];

  private static dpsValEl: HTMLSpanElement | null = null;
  private static dpsAvgEl: HTMLSpanElement | null = null;
  private static apsValEl: HTMLSpanElement | null = null;
  private static apsAvgEl: HTMLSpanElement | null = null;
  private static dpsTotalEl: HTMLSpanElement | null = null;
  private static dpsTimeEl: HTMLSpanElement | null = null;
  private static dpsResetBtn: HTMLButtonElement | null = null;

  public static init() {
    this.dpsValEl   = document.getElementById('dps-val') as HTMLSpanElement;
    this.dpsAvgEl   = document.getElementById('dps-avg') as HTMLSpanElement;
    this.apsValEl   = document.getElementById('aps-val') as HTMLSpanElement;
    this.apsAvgEl   = document.getElementById('aps-avg') as HTMLSpanElement;
    this.dpsTotalEl = document.getElementById('dps-total') as HTMLSpanElement;
    this.dpsTimeEl  = document.getElementById('dps-time') as HTMLSpanElement;
    this.dpsResetBtn = document.getElementById('dps-reset') as HTMLButtonElement;

    if (this.dpsResetBtn) {
      this.dpsResetBtn.addEventListener('click', () => this.reset());
    }
  }

  public static reset() {
    this.totalDamageDealt = 0;
    this.totalAttacksCount = 0;
    this.combatStartTime = 0;
    this.damageTimestamps.length = 0;
    this.attackTimestamps.length = 0;
    if (this.dpsValEl) this.dpsValEl.innerText = '0';
    if (this.dpsAvgEl) this.dpsAvgEl.innerText = '0';
    if (this.apsValEl) this.apsValEl.innerText = '0';
    if (this.apsAvgEl) this.apsAvgEl.innerText = '0';
    if (this.dpsTotalEl) this.dpsTotalEl.innerText = '0';
    if (this.dpsTimeEl) this.dpsTimeEl.innerText = '0s';
  }

  public static recordAttack() {
    const nowSec = performance.now() / 1000;
    if (this.totalDamageDealt === 0 && this.totalAttacksCount === 0) {
      this.combatStartTime = nowSec;
    }
    this.totalAttacksCount++;
    this.attackTimestamps.push(nowSec);
  }

  public static recordDamage(amount: number) {
    const nowSec = performance.now() / 1000;
    if (this.totalDamageDealt === 0 && this.totalAttacksCount === 0) {
      this.combatStartTime = nowSec;
    }
    this.totalDamageDealt += amount;
    this.damageTimestamps.push({ time: nowSec, amount });
  }

  public static update() {
    const nowSec = performance.now() / 1000;
    const threeSecAgo = nowSec - 3.0;
    let rollingSum = 0;
    
    for (let i = this.damageTimestamps.length - 1; i >= 0; i--) {
      if (this.damageTimestamps[i].time < threeSecAgo) {
        this.damageTimestamps.splice(0, i + 1);
        break;
      }
    }
    for (let i = 0; i < this.damageTimestamps.length; i++) {
      rollingSum += this.damageTimestamps[i].amount;
    }

    for (let i = this.attackTimestamps.length - 1; i >= 0; i--) {
      if (this.attackTimestamps[i] < threeSecAgo) {
        this.attackTimestamps.splice(0, i + 1);
        break;
      }
    }

    if (this.totalDamageDealt > 0 || this.totalAttacksCount > 0) {
      const duration = nowSec - this.combatStartTime;
      const currentDps = rollingSum / Math.max(1, Math.min(duration, 3.0));
      const averageDps = this.totalDamageDealt / Math.max(0.1, duration);
      const currentAps = this.attackTimestamps.length / Math.max(1, Math.min(duration, 3.0));
      const averageAps = this.totalAttacksCount / Math.max(0.1, duration);

      if (this.dpsValEl) this.dpsValEl.innerText = Math.round(currentDps).toLocaleString();
      if (this.dpsAvgEl) this.dpsAvgEl.innerText = Math.round(averageDps).toLocaleString();
      if (this.apsValEl) this.apsValEl.innerText = currentAps.toFixed(1);
      if (this.apsAvgEl) this.apsAvgEl.innerText = averageAps.toFixed(1);
      if (this.dpsTotalEl) this.dpsTotalEl.innerText = this.totalDamageDealt.toLocaleString();
      if (this.dpsTimeEl) this.dpsTimeEl.innerText = `${Math.round(duration)}s`;
    } else {
      if (this.dpsValEl) this.dpsValEl.innerText = '0';
      if (this.dpsAvgEl) this.dpsAvgEl.innerText = '0';
      if (this.apsValEl) this.apsValEl.innerText = '0';
      if (this.apsAvgEl) this.apsAvgEl.innerText = '0';
      if (this.dpsTotalEl) this.dpsTotalEl.innerText = '0';
      if (this.dpsTimeEl) this.dpsTimeEl.innerText = '0s';
    }
  }
}
