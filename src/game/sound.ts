// Web Audio based sound system for the FPS game
// Uses procedurally generated sounds (no external files needed)

class SoundEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private initialized = false;

  init() {
    if (this.initialized) return;
    try {
      this.ctx = new AudioContext();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.3;
      this.masterGain.connect(this.ctx.destination);
      this.initialized = true;
    } catch {
      // Audio not available
    }
  }

  private ensureCtx() {
    if (!this.ctx || !this.masterGain) return null;
    if (this.ctx.state === "suspended") this.ctx.resume();
    return this.ctx;
  }

  // Gunshot: noise burst with bandpass filter
  playShot(weapon: string = "rifle") {
    const ctx = this.ensureCtx();
    if (!ctx || !this.masterGain) return;

    const duration = weapon === "sniper" ? 0.25 : weapon === "pistol" ? 0.08 : 0.12;
    const freq = weapon === "sniper" ? 200 : weapon === "pistol" ? 800 : weapon === "smg" ? 1200 : 500;

    const bufferSize = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      const env = Math.exp(-i / (bufferSize * 0.15));
      data[i] = (Math.random() * 2 - 1) * env;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = freq;
    filter.Q.value = 1.5;

    const gain = ctx.createGain();
    gain.gain.value = weapon === "sniper" ? 0.8 : 0.5;

    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    source.start();
  }

  // Explosion: low frequency noise burst
  playExplosion() {
    const ctx = this.ensureCtx();
    if (!ctx || !this.masterGain) return;

    const duration = 0.6;
    const bufferSize = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      const env = Math.exp(-i / (bufferSize * 0.2));
      data[i] = (Math.random() * 2 - 1) * env;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 150;
    filter.Q.value = 0.7;

    const gain = ctx.createGain();
    gain.gain.value = 1.0;

    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    source.start();
  }

  // Footstep: short low thud
  playFootstep() {
    const ctx = this.ensureCtx();
    if (!ctx || !this.masterGain) return;

    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = 80 + Math.random() * 40;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start();
    osc.stop(ctx.currentTime + 0.08);
  }

  // Hit marker sound
  playHitMarker() {
    const ctx = this.ensureCtx();
    if (!ctx || !this.masterGain) return;

    const osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.value = 1200;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.06);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start();
    osc.stop(ctx.currentTime + 0.06);
  }

  // Headshot ding
  playHeadshot() {
    const ctx = this.ensureCtx();
    if (!ctx || !this.masterGain) return;

    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(2000, ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(2800, ctx.currentTime + 0.1);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start();
    osc.stop(ctx.currentTime + 0.15);
  }

  // Reload click
  playReload() {
    const ctx = this.ensureCtx();
    if (!ctx || !this.masterGain) return;

    const bufferSize = Math.floor(ctx.sampleRate * 0.05);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.3));
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = 2000;

    const gain = ctx.createGain();
    gain.gain.value = 0.2;

    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    source.start();
  }

  // Capture point tick
  playCaptureBeep() {
    const ctx = this.ensureCtx();
    if (!ctx || !this.masterGain) return;

    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = 600;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start();
    osc.stop(ctx.currentTime + 0.1);
  }

  // Vehicle engine hum
  playVehicleEnter() {
    const ctx = this.ensureCtx();
    if (!ctx || !this.masterGain) return;

    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = 60;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.1, ctx.currentTime + 0.3);
    gain.gain.linearRampToValueAtTime(0.05, ctx.currentTime + 0.6);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.0);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start();
    osc.stop(ctx.currentTime + 1.0);
  }

  // Damage taken
  playDamage() {
    const ctx = this.ensureCtx();
    if (!ctx || !this.masterGain) return;

    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = 200;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start();
    osc.stop(ctx.currentTime + 0.12);
  }
}

export const soundEngine = new SoundEngine();
