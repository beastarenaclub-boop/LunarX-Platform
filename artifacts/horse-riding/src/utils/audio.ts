let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;

export function initAudio() {
  if (!ctx) {
    ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    masterGain = ctx.createGain();
    masterGain.gain.value = 0.5;
    masterGain.connect(ctx.destination);
    startWind();
  }
}

export function setMasterMute(muted: boolean) {
  if (masterGain) {
    masterGain.gain.linearRampToValueAtTime(muted ? 0 : 0.5, ctx!.currentTime + 0.1);
  }
}

export function playHoofbeat(intensity: number) {
  if (!ctx || !masterGain || masterGain.gain.value === 0) return;
  
  const t = ctx.currentTime;
  
  // Thud sound (low frequency sine sweeping down)
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  
  osc.type = 'sine';
  osc.frequency.setValueAtTime(100 + intensity * 50, t);
  osc.frequency.exponentialRampToValueAtTime(40, t + 0.1);
  
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(0.3 * intensity, t + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.01, t + 0.15);
  
  osc.connect(gain);
  gain.connect(masterGain);
  
  osc.start(t);
  osc.stop(t + 0.16);
  
  // Dust/gravel sound (noise)
  const bufferSize = ctx.sampleRate * 0.1; // 100ms
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  
  const noiseSource = ctx.createBufferSource();
  noiseSource.buffer = buffer;
  
  const noiseFilter = ctx.createBiquadFilter();
  noiseFilter.type = 'bandpass';
  noiseFilter.frequency.value = 800 + intensity * 400;
  noiseFilter.Q.value = 1;
  
  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0, t);
  noiseGain.gain.linearRampToValueAtTime(0.15 * intensity, t + 0.01);
  noiseGain.gain.exponentialRampToValueAtTime(0.01, t + 0.1);
  
  noiseSource.connect(noiseFilter);
  noiseFilter.connect(noiseGain);
  noiseGain.connect(masterGain);
  
  noiseSource.start(t);
}

export function playChime() {
  if (!ctx || !masterGain || masterGain.gain.value === 0) return;
  
  const t = ctx.currentTime;
  
  // Bright chime using FM synthesis-like approach
  const osc1 = ctx.createOscillator();
  const osc2 = ctx.createOscillator();
  const gain1 = ctx.createGain();
  const gain2 = ctx.createGain();
  
  osc1.type = 'sine';
  osc1.frequency.setValueAtTime(880, t); // A5
  osc1.frequency.exponentialRampToValueAtTime(880, t + 1);
  
  osc2.type = 'sine';
  osc2.frequency.setValueAtTime(1760, t); // A6
  osc2.frequency.exponentialRampToValueAtTime(1760, t + 1);
  
  gain1.gain.setValueAtTime(0, t);
  gain1.gain.linearRampToValueAtTime(0.2, t + 0.05);
  gain1.gain.exponentialRampToValueAtTime(0.01, t + 1);
  
  gain2.gain.setValueAtTime(0, t);
  gain2.gain.linearRampToValueAtTime(0.1, t + 0.05);
  gain2.gain.exponentialRampToValueAtTime(0.01, t + 0.8);
  
  osc1.connect(gain1);
  osc2.connect(gain2);
  gain1.connect(masterGain);
  gain2.connect(masterGain);
  
  osc1.start(t);
  osc2.start(t);
  osc1.stop(t + 1.1);
  osc2.stop(t + 1.1);
}

let windGain: GainNode | null = null;
let lastOut = 0;

function startWind() {
  if (!ctx || !masterGain) return;
  
  const bufferSize = ctx.sampleRate * 2; // 2 seconds loop
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    // Pink noise approximation
    const white = Math.random() * 2 - 1;
    data[i] = (lastOut + (0.02 * white)) / 1.02;
    lastOut = data[i];
    data[i] *= 3.5; 
  }
  
  const windSource = ctx.createBufferSource();
  windSource.buffer = buffer;
  windSource.loop = true;
  
  const windFilter = ctx.createBiquadFilter();
  windFilter.type = 'lowpass';
  windFilter.frequency.value = 400; // Deep wind
  windFilter.Q.value = 0.5;
  
  windGain = ctx.createGain();
  windGain.gain.value = 0.2; // Constant low volume
  
  windSource.connect(windFilter);
  windFilter.connect(windGain);
  windGain.connect(masterGain);
  
  windSource.start();
  
  // Slowly modulate filter for howling effect
  setInterval(() => {
    if (ctx && windFilter) {
      const t = ctx.currentTime;
      const targetFreq = 300 + Math.random() * 400;
      windFilter.frequency.linearRampToValueAtTime(targetFreq, t + 2 + Math.random() * 2);
    }
  }, 3000);
}
