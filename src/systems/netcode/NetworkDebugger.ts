import { NetworkManager } from '../../network/NetworkManager';

interface DiagnosticSample {
  t: number;          // timestamp ms since recording start
  ping: number;       // ms
  kbpsSent: number;
  kbpsReceived: number;
  ppsSent: number;
  ppsReceived: number;
  totalSentMB: number;
  totalRecvMB: number;
}

export class NetworkDebugger {
  private container: HTMLDivElement | null = null;
  private isVisible = false;
  private pingHistory: number[] = [];
  private maxHistory = 40;

  // Bandwidth measurement vars
  private lastBytesSent = 0;
  private lastBytesReceived = 0;
  private lastPacketsSent = 0;
  private lastPacketsReceived = 0;
  private lastUpdateTime = performance.now();

  private kbpsSent = 0;
  private kbpsReceived = 0;
  private ppsSent = 0;
  private ppsReceived = 0;

  // Diagnostic recording
  private isRecording = false;
  private recordingStart = 0;
  private samples: DiagnosticSample[] = [];

  constructor() {
    this.createUI();
    this.setupListeners();
  }

  private createUI() {
    this.container = document.createElement('div');
    this.container.id = 'network-debugger';
    this.container.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      width: 280px;
      background: rgba(13, 13, 21, 0.85);
      border: 1px solid rgba(59, 130, 246, 0.4);
      color: #f1f5f9;
      font-family: monospace;
      font-size: 11px;
      padding: 12px;
      border-radius: 8px;
      backdrop-filter: blur(8px);
      z-index: 10000;
      pointer-events: none;
      display: none;
      box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.37);
      line-height: 1.5;
    `;
    document.body.appendChild(this.container);
  }

  private setupListeners() {
    window.addEventListener('keydown', (e) => {
      if (e.key === 'F4') {
        this.toggle();
      }
      if (e.key === 'F5') {
        e.preventDefault();
        if (!this.isRecording) {
          this.startRecording();
        } else {
          this.downloadJSON();
        }
      }
    });
  }

  public toggle() {
    this.isVisible = !this.isVisible;
    if (this.container) {
      this.container.style.display = this.isVisible ? 'block' : 'none';
    }
  }

  private startRecording() {
    this.samples = [];
    this.recordingStart = performance.now();
    this.isRecording = true;
    console.log('[NetDebugger] Recording started — press F5 again to download JSON');
  }

  private downloadJSON() {
    this.isRecording = false;

    const report = {
      meta: {
        recordedAt: new Date().toISOString(),
        durationMs: performance.now() - this.recordingStart,
        totalSamples: this.samples.length,
        avgPing: +(this.samples.reduce((s, r) => s + r.ping, 0) / (this.samples.length || 1)).toFixed(2),
        maxPing: Math.max(...this.samples.map(r => r.ping)),
        minPing: Math.min(...this.samples.map(r => r.ping)),
        avgPpsSent: +(this.samples.reduce((s, r) => s + r.ppsSent, 0) / (this.samples.length || 1)).toFixed(1),
        avgPpsRecv: +(this.samples.reduce((s, r) => s + r.ppsReceived, 0) / (this.samples.length || 1)).toFixed(1),
      },
      samples: this.samples,
    };

    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `net-diag-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    console.log('[NetDebugger] JSON downloaded —', report.meta);
  }

  public update() {
    if (!this.isVisible || !this.container) return;

    if (document.hidden) {
      this.pingHistory = [];
      return;
    }

    const now = performance.now();
    const dt = (now - this.lastUpdateTime) / 1000;

    if (dt >= 1.0) {
      const currentBytesSent = NetworkManager.bytesSent;
      const currentBytesReceived = NetworkManager.bytesReceived;
      const currentPacketsSent = NetworkManager.packetsSent;
      const currentPacketsReceived = NetworkManager.packetsReceived;

      this.kbpsSent = ((currentBytesSent - this.lastBytesSent) / 1024) / dt;
      this.kbpsReceived = ((currentBytesReceived - this.lastBytesReceived) / 1024) / dt;
      this.ppsSent = (currentPacketsSent - this.lastPacketsSent) / dt;
      this.ppsReceived = (currentPacketsReceived - this.lastPacketsReceived) / dt;

      this.lastBytesSent = currentBytesSent;
      this.lastBytesReceived = currentBytesReceived;
      this.lastPacketsSent = currentPacketsSent;
      this.lastPacketsReceived = currentPacketsReceived;
      this.lastUpdateTime = now;

      // Ping history for sparkline
      this.pingHistory.push(NetworkManager.ping);
      if (this.pingHistory.length > this.maxHistory) this.pingHistory.shift();

      // Record sample if recording is active
      if (this.isRecording) {
        this.samples.push({
          t: +(now - this.recordingStart).toFixed(0),
          ping: +NetworkManager.ping.toFixed(2),
          kbpsSent: +this.kbpsSent.toFixed(2),
          kbpsReceived: +this.kbpsReceived.toFixed(2),
          ppsSent: +this.ppsSent.toFixed(1),
          ppsReceived: +this.ppsReceived.toFixed(1),
          totalSentMB: +(NetworkManager.bytesSent / 1024 / 1024).toFixed(3),
          totalRecvMB: +(NetworkManager.bytesReceived / 1024 / 1024).toFixed(3),
        });
      }
    }

    this.render();
  }

  private render() {
    if (!this.container) return;

    // SVG sparkline
    let svgPath = '';
    const width = 256;
    const height = 50;
    if (this.pingHistory.length > 1) {
      const maxPing = Math.max(100, ...this.pingHistory);
      const points = this.pingHistory.map((val, idx) => {
        const x = (idx / (this.maxHistory - 1)) * width;
        const y = height - (val / maxPing) * height * 0.8 - 5;
        return `${x},${y}`;
      });
      svgPath = `<path d="M ${points.join(' L ')}" fill="none" stroke="#3b82f6" stroke-width="1.5" />`;
    }

    const currentPing = NetworkManager.ping;
    let pingColor = '#22c55e';
    if (currentPing > 100) pingColor = '#eab308';
    if (currentPing > 200) pingColor = '#ef4444';
    const pingStr = currentPing < 1.0 ? "&lt;1" : Math.round(currentPing).toString();

    const recLabel = this.isRecording
      ? `<span style="color:#ef4444; animation: blink 1s step-start infinite;">⏺ REC ${this.samples.length}s</span>`
      : `<span style="color:rgba(255,255,255,0.3);">F5 Start Rec</span>`;

    this.container.innerHTML = `
      <div style="font-weight:bold; color:#3b82f6; margin-bottom: 6px; border-bottom: 1px solid rgba(59,130,246,0.2); padding-bottom: 4px; display:flex; justify-content:space-between;">
        <span>📡 NET DEBUGGER</span>
        <span style="font-size:9px; color:rgba(255,255,255,0.4);">[F4 Toggle]</span>
      </div>
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
        <span>Ping: <span style="color:${pingColor}; font-weight:bold;">${pingStr} ms</span></span>
        ${recLabel}
      </div>
      <div style="margin-top: 4px; background:rgba(0,0,0,0.3); border-radius:4px; padding:2px;">
        <svg width="${width}" height="${height}" style="display:block;">
          ${svgPath}
        </svg>
      </div>
      <div style="margin-top: 8px; display:grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size:10px;">
        <div>
          <span style="color:#10b981;">▲ Outbound</span><br/>
          Bandwidth: ${this.kbpsSent.toFixed(1)} KB/s<br/>
          Packets: ${Math.round(this.ppsSent)} PPS<br/>
          Total: ${(NetworkManager.bytesSent / 1024 / 1024).toFixed(2)} MB
        </div>
        <div>
          <span style="color:#ef4444;">▼ Inbound</span><br/>
          Bandwidth: ${this.kbpsReceived.toFixed(1)} KB/s<br/>
          Packets: ${Math.round(this.ppsReceived)} PPS<br/>
          Total: ${(NetworkManager.bytesReceived / 1024 / 1024).toFixed(2)} MB
        </div>
      </div>
      <div style="margin-top:6px; font-size:9px; color:rgba(255,255,255,0.3); text-align:center;">
        ${this.isRecording ? 'F5 → Stop &amp; Download JSON' : 'F5 → Start Recording'}
      </div>
    `;
  }
}

