/**
 * 五子棋音频管理器 (Web Audio API 纯算法治愈系音效生成器)
 * 采用清脆水滴泡泡声 (Bubble Pop)、童话八音盒 (Music Box)、Q弹软糖滑音
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
   * 可爱治愈水滴泡泡落子声 (Cute Bubble Pop / Waterdrop)
   */
  playPieceSound() {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;

    // 1. 水滴泡泡音 (快速频率上滑后瞬降，形成清脆的“啵”声)
    const popOsc = this.ctx.createOscillator();
    const popGain = this.ctx.createGain();

    popOsc.type = 'sine';
    const baseFreq = 480 + Math.random() * 120; // 稍带随机音调更生动
    popOsc.frequency.setValueAtTime(baseFreq * 0.7, t);
    popOsc.frequency.exponentialRampToValueAtTime(baseFreq * 2.2, t + 0.035);
    popOsc.frequency.exponentialRampToValueAtTime(baseFreq, t + 0.08);

    popGain.gain.setValueAtTime(0.6, t);
    popGain.gain.exponentialRampToValueAtTime(0.001, t + 0.09);

    popOsc.connect(popGain);
    popGain.connect(this.ctx.destination);
    popOsc.start(t);
    popOsc.stop(t + 0.1);

    // 2. 泛音软糖弹性微音
    const jellyOsc = this.ctx.createOscillator();
    const jellyGain = this.ctx.createGain();

    jellyOsc.type = 'triangle';
    jellyOsc.frequency.setValueAtTime(baseFreq * 1.5, t);
    jellyOsc.frequency.exponentialRampToValueAtTime(baseFreq * 0.9, t + 0.06);

    jellyGain.gain.setValueAtTime(0.2, t);
    jellyGain.gain.exponentialRampToValueAtTime(0.001, t + 0.07);

    jellyOsc.connect(jellyGain);
    jellyGain.connect(this.ctx.destination);
    jellyOsc.start(t);
    jellyOsc.stop(t + 0.08);
  }

  /**
   * Q弹软糖悔棋滑音 (Cute Undo "Boing")
   */
  playUndoSound() {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(320, t);
    osc.frequency.exponentialRampToValueAtTime(580, t + 0.06);
    osc.frequency.exponentialRampToValueAtTime(260, t + 0.14);

    gain.gain.setValueAtTime(0.4, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.16);
  }

  /**
   * 小风铃提示音效 (Cute Hint Chime)
   */
  playHintSound() {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;

    const notes = [659.25, 880, 1174.66]; // E5, A5, D6
    const t = this.ctx.currentTime;

    notes.forEach((freq, idx) => {
      const noteTime = t + idx * 0.06;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, noteTime);

      gain.gain.setValueAtTime(0.3, noteTime);
      gain.gain.exponentialRampToValueAtTime(0.001, noteTime + 0.35);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(noteTime);
      osc.stop(noteTime + 0.36);
    });
  }

  /**
   * 童话八音盒胜利旋律 (Cute Music Box Win)
   */
  playWinSound() {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;

    // 欢快治愈大调音阶: G5, B5, D6, G6
    const notes = [783.99, 987.77, 1174.66, 1567.98];
    const t = this.ctx.currentTime;

    notes.forEach((freq, idx) => {
      const noteTime = t + idx * 0.12;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, noteTime);

      gain.gain.setValueAtTime(0.4, noteTime);
      gain.gain.exponentialRampToValueAtTime(0.001, noteTime + 0.7);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(noteTime);
      osc.stop(noteTime + 0.72);
    });
  }

  /**
   * 呆萌认输/平局音
   */
  playLoseSound() {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;

    const notes = [523.25, 493.88, 440]; // C5, B4, A4
    const t = this.ctx.currentTime;

    notes.forEach((freq, idx) => {
      const noteTime = t + idx * 0.14;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, noteTime);

      gain.gain.setValueAtTime(0.25, noteTime);
      gain.gain.exponentialRampToValueAtTime(0.001, noteTime + 0.35);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(noteTime);
      osc.stop(noteTime + 0.36);
    });
  }

  /**
   * 禁手/萌系警告声 (Pew Pew)
   */
  playAlertSound() {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(600, t);
    osc.frequency.exponentialRampToValueAtTime(200, t + 0.15);

    gain.gain.setValueAtTime(0.3, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.16);

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.18);
  }
  /**
   * 爆炸音效：直接播放内嵌的樱桃炸弹音频
   */
  playExplosionSound() {
    if (!this.enabled) return;
    if (!window.CHERRY_BOMB_AUDIO_DATA) {
      console.warn('Embedded explosion audio is unavailable.');
      return;
    }
    const audio = new Audio(window.CHERRY_BOMB_AUDIO_DATA);
    audio.preload = 'auto';
    audio.play().catch(err => console.warn('Audio playback failed:', err));
  }

}
window.soundEffects = new SoundEffects();

// Global helper to play skill sounds
function playSkillSound(name) {
  switch(name) {
    case 'bomb':
      window.soundEffects.playExplosionSound();
      break;
    case 'magic':
      window.soundEffects.playAlertSound();
      break;
    default:
      console.warn('Unknown skill sound:', name);
  }
}
