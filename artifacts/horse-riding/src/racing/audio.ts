// All sound is synthesized locally; no remote sound files or autoplay permission needed.
let context: AudioContext | null = null;
export function unlockAudio() {
  context ??= new AudioContext();
  void context.resume().catch(() => {});
}
export function hoofBeat() {
  if (!context || context.state !== "running") return;
  const now = context.currentTime;
  for (const offset of [0, 0.07, 0.16]) {
    const osc = context.createOscillator(),
      gain = context.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(145, now + offset);
    osc.frequency.exponentialRampToValueAtTime(42, now + offset + 0.08);
    gain.gain.setValueAtTime(0.055, now + offset);
    gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.1);
    osc.connect(gain).connect(context.destination);
    osc.start(now + offset);
    osc.stop(now + offset + 0.11);
  }
}
export function cheer() {
  if (!context || context.state !== "running") return;
  const length = context.sampleRate * 2,
    buffer = context.createBuffer(1, length, context.sampleRate),
    data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++)
    data[i] = (Math.random() * 2 - 1) * Math.sin((i / length) * Math.PI) * 0.13;
  const source = context.createBufferSource(),
    filter = context.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = 950;
  filter.Q.value = 0.6;
  source.buffer = buffer;
  source.connect(filter).connect(context.destination);
  source.start();
}
