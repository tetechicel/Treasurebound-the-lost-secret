/**
 * Lightweight Procedural Web Audio Synthesizer for TREASUREBOUND
 * Zero external audio files needed; unlocks cleanly on first user gesture.
 */
class SoundSystem {
  private ctx: AudioContext | null = null;
  private muted = false;

  setMuted(muted: boolean) {
    this.muted = muted;
  }

  isMuted(): boolean {
    return this.muted;
  }

  private ensureContext(): AudioContext | null {
    if (this.muted) return null;
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  private playTone(
    freq: number,
    endFreq: number,
    duration: number,
    type: OscillatorType = 'triangle',
    volume = 0.09,
    delay = 0
  ) {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (endFreq !== freq) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), now + duration);
    }

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(volume, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  playClick() {
    this.playTone(520, 680, 0.06, 'square', 0.04);
  }

  playCastOrb() {
    this.playTone(620, 240, 0.14, 'triangle', 0.08);
    this.playTone(920, 420, 0.1, 'sine', 0.05, 0.02);
  }

  playHit() {
    this.playTone(170, 65, 0.14, 'sawtooth', 0.11);
  }

  playApplePickup() {
    this.playTone(440, 660, 0.09, 'triangle', 0.07);
    this.playTone(660, 880, 0.11, 'triangle', 0.07, 0.07);
  }

  playHeal() {
    this.playTone(392, 523.25, 0.12, 'sine', 0.08);
    this.playTone(523.25, 783.99, 0.18, 'sine', 0.08, 0.09);
  }

  playChestOpen() {
    this.playTone(392, 392, 0.09, 'square', 0.05);
    this.playTone(523.25, 523.25, 0.09, 'square', 0.05, 0.08);
    this.playTone(659.25, 783.99, 0.18, 'triangle', 0.07, 0.16);
  }

  playQuizCorrect() {
    this.playTone(523.25, 523.25, 0.1, 'triangle', 0.08);
    this.playTone(659.25, 659.25, 0.1, 'triangle', 0.08, 0.09);
    this.playTone(783.99, 1046.5, 0.22, 'triangle', 0.09, 0.18);
  }

  playQuizWrong() {
    this.playTone(260, 180, 0.16, 'sawtooth', 0.07);
    this.playTone(190, 130, 0.22, 'sawtooth', 0.07, 0.14);
  }

  playVictory() {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((n, i) => {
      this.playTone(n, n * 1.01, 0.24, 'triangle', 0.09, i * 0.11);
    });
  }
}

export const soundSystem = new SoundSystem();
