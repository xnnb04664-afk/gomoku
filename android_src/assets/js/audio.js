/**
 * 五子棋音频管理器 (Web Audio API 纯算法实时合成)
 * 无需外部音频资源，零延迟、零依赖、音质清脆自然
 */
class SoundEffects {
  constructor() {
    this.ctx = null;
    this.enabled = true;
  }

  init() {
    if (!this.ctx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) {
        this.ctx = new AudioContext();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  toggleSound(enable) {
    this.enabled = enable;
  }

  /**
   * 模拟落子木质敲击声（双层合成：高频瞬态点击 + 木质箱体低频共鸣）
   */
  playPieceSound() {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;

    // 1. 瞬态接触声 (Click/Snap)
    const snapOsc = this.ctx.createOscillator();
    const snapGain = this.ctx.createGain();
    snapOsc.type = 'triangle';
    snapOsc.frequency.setValueAtTime(800 + Math.random() * 200, t);
    snapOsc.frequency.exponentialRampToValueAtTime(120, t + 0.04);

    snapGain.gain.setValueAtTime(0.7, t);
    snapGain.gain.exponentialRampToValueAtTime(0.001, t + 0.045);

    snapOsc.connect(snapGain);
    snapGain.connect(this.ctx.destination);
    snapOsc.start(t);
    snapOsc.stop(t + 0.05);

    // 2. 棋盘木质共鸣声 (Wood Knock Resonance)
    const knockOsc = this.ctx.createOscillator();
    const knockGain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();

    knockOsc.type = 'sine';
    knockOsc.frequency.setValueAtTime(260 + Math.random() * 40, t);
    knockOsc.frequency.exponentialRampToValueAtTime(80, t + 0.12);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(600, t);

    knockGain.gain.setValueAtTime(0.5, t);
    knockGain.gain.exponentialRampToValueAtTime(0.001, t + 0.14);

    knockOsc.connect(filter);
    filter.connect(knockGain);
    knockGain.connect(this.ctx.destination);
    knockOsc.start(t);
    knockOsc.stop(t + 0.15);
  }

  /**
   * 悔棋音效（轻快的撤销滑音）
   */
  playUndoSound() {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(450, t);
    osc.frequency.exponentialRampToValueAtTime(220, t + 0.12);

    gain.gain.setValueAtTime(0.3, t);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.12);

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.13);
  }

  /**
   * 提示音效 (Hint)
   */
  playHintSound() {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, t); // D5
    osc.frequency.setValueAtTime(880, t + 0.08); // A5

    gain.gain.setValueAtTime(0.25, t);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.22);

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.23);
  }

  /**
   * 胜利华丽和弦 (C Major 琶音)
   */
  playWinSound() {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;

    const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
    const t = this.ctx.currentTime;

    notes.forEach((freq, idx) => {
      const noteTime = t + idx * 0.1;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, noteTime);

      gain.gain.setValueAtTime(0.35, noteTime);
      gain.gain.exponentialRampToValueAtTime(0.001, noteTime + 0.6);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(noteTime);
      osc.stop(noteTime + 0.62);
    });
  }

  /**
   * 失败/认输音效
   */
  playLoseSound() {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;

    const notes = [440, 415.3, 392, 349.23]; // A4, Ab4, G4, F4
    const t = this.ctx.currentTime;

    notes.forEach((freq, idx) => {
      const noteTime = t + idx * 0.14;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, noteTime);

      gain.gain.setValueAtTime(0.2, noteTime);
      gain.gain.exponentialRampToValueAtTime(0.001, noteTime + 0.4);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(noteTime);
      osc.stop(noteTime + 0.42);
    });
  }

  /**
   * 禁手 / 警报声
   */
  playAlertSound() {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'square';
    osc.frequency.setValueAtTime(220, t);
    osc.frequency.setValueAtTime(180, t + 0.08);

    gain.gain.setValueAtTime(0.25, t);
    gain.gain.exponentialRampToValueAtTime(0.01, t + 0.2);

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.22);
  }
}

// 导出单例
window.soundEffects = new SoundEffects();
