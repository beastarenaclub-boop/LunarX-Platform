export type EntryAudioScene =
  | "entrance"
  | "puzzle"
  | "gate"
  | "walk"
  | "chamber"
  | "unlock"
  | "login";
export type EntrySound =
  | "tap"
  | "rotate"
  | "aligned"
  | "gate"
  | "step"
  | "chamber"
  | "search"
  | "key"
  | "locked"
  | "unlock"
  | "click"
  | "success"
  | "error"
  | "login";
type AudioStatus = "ready" | "playing" | "muted" | "unavailable";
const MUTE_KEY = "syndicate-entry-muted";

// Synthesized locally: no media downloads, microphone, or audio permissions.
class EntryAudio {
  private context: AudioContext | null = null;
  private output: GainNode | null = null;
  private air: AudioBuffer | null = null;
  private drones: OscillatorNode[] = [];
  private voices = new Set<AudioScheduledSourceNode>();
  private listeners = new Set<() => void>();
  private scene: EntryAudioScene | null = null;
  private paused = false;
  private muted = false;
  private hydrated = false;
  private status: AudioStatus = "ready";
  private steps: ReturnType<typeof setInterval> | null = null;
  private nextFoot = false;
  private transition: EntrySound | null = null;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.status;
  private notify(status: AudioStatus) {
    if (this.status === status) return;
    this.status = status;
    this.listeners.forEach((listener) => listener());
  }
  private allowed() {
    return !!this.scene && !this.muted;
  }
  private idleStatus(): AudioStatus {
    if (this.status === "unavailable") return "unavailable";
    return this.muted ? "muted" : "ready";
  }
  private hydrate() {
    if (this.hydrated) return;
    this.hydrated = true;
    try {
      this.muted = localStorage.getItem(MUTE_KEY) === "1";
    } catch {
      /* Storage may be disabled. */
    }
    this.notify(this.muted ? "muted" : "ready");
  }
  setScene(scene: EntryAudioScene | null, paused = false) {
    this.hydrate();
    if (this.scene !== scene) {
      this.transition =
        scene === "gate" ||
        scene === "chamber" ||
        scene === "unlock" ||
        scene === "login"
          ? scene
          : null;
    }
    this.scene = scene;
    this.paused = paused;
    if (!this.allowed()) this.suspend();
    else if (this.context) void this.activate();
    this.updateSteps();
  }
  private createContext() {
    const Constructor =
      window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Constructor) throw Error("Web Audio unavailable");
    const ctx = new Constructor();
    this.context = ctx;
    const output = ctx.createGain();
    output.gain.value = 0.6;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -12;
    limiter.ratio.value = 6;
    output.connect(limiter);
    limiter.connect(ctx.destination);
    this.output = output;
    const ambient = ctx.createGain();
    ambient.gain.value = 0.13;
    ambient.connect(output);
    const swell = ctx.createOscillator();
    const swellDepth = ctx.createGain();
    swell.frequency.value = 0.14;
    swellDepth.gain.value = 0.035;
    swell.connect(swellDepth);
    swellDepth.connect(ambient.gain);
    swell.start();
    this.drones = [55, 82.41, 110.2, 220].map((frequency) => {
      const oscillator = ctx.createOscillator();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      oscillator.connect(ambient);
      oscillator.start();
      return oscillator;
    });
    this.air = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const channel = this.air.getChannelData(0);
    for (let i = 0; i < channel.length; i++) channel[i] = Math.random() * 2 - 1;
    ctx.onstatechange = () => {
      this.notify(
        ctx.state === "running" &&
          this.allowed() &&
          this.status !== "unavailable"
          ? "playing"
          : this.idleStatus(),
      );
    };
  }
  activate = async () => {
    this.hydrate();
    if (!this.allowed() || this.status === "unavailable") return;
    try {
      if (!this.context) this.createContext();
      const ctx = this.context!;
      if (ctx.state !== "running") await ctx.resume();
      // Explicit mute or leaving the entry experience can happen during resume.
      if (!this.allowed()) {
        this.suspend();
        return;
      }
      if (ctx.state !== "running") return;
      this.notify("playing");
      const base =
        this.scene === "chamber" || this.scene === "login" ? 65.41 : 55;
      this.drones.forEach((drone, i) =>
        drone.frequency.setTargetAtTime(
          base * [1, 1.4983, 2.004, 4][i],
          ctx.currentTime,
          0.7,
        ),
      );
      if (this.transition) {
        const sound = this.transition;
        this.transition = null;
        this.render(sound);
      }
      this.updateSteps();
    } catch {
      this.suspend();
      this.notify("unavailable");
    }
  };
  toggle = () => {
    this.hydrate();
    // A suspended/new page asks for activation first, rather than silently muting.
    if (this.status === "playing") this.muted = true;
    else this.muted = false;
    try {
      localStorage.setItem(MUTE_KEY, this.muted ? "1" : "0");
    } catch {
      /* Optional preference. */
    }
    if (this.muted) {
      this.suspend();
      this.notify("muted");
    } else {
      this.notify(this.idleStatus());
      void this.activate();
    }
  };
  visibility = () => {
    // Keep the ambient bed playing in background tabs too. A browser/OS may
    // interrupt audio itself; recover on focus/pageshow without creating a new context.
    if (this.context) void this.activate();
    this.updateSteps();
  };
  suspend = () => {
    if (this.steps) clearInterval(this.steps);
    this.steps = null;
    this.stopVoices();
    if (this.context && this.context.state !== "closed")
      void this.context.suspend().catch(() => {});
    this.notify(this.idleStatus());
  };
  private stopVoices() {
    this.voices.forEach((voice) => {
      try {
        voice.stop();
      } catch {
        /* Already ended. */
      }
    });
    this.voices.clear();
  }
  private updateSteps() {
    const walking =
      this.scene === "walk" &&
      !this.paused &&
      !document.hidden &&
      this.allowed() &&
      this.context?.state === "running";
    if (!walking && this.steps) {
      clearInterval(this.steps);
      this.steps = null;
    }
    if (walking && !this.steps) {
      this.render("step");
      this.steps = setInterval(() => {
        if (this.allowed()) this.render("step");
      }, 580);
    }
  }
  play(sound: EntrySound, step = 1) {
    if (!this.allowed()) return;
    const scene = this.scene;
    void this.activate().then(() => {
      if (
        this.allowed() &&
        this.scene === scene &&
        this.context?.state === "running"
      )
        this.render(sound, step);
    });
  }
  private voice(
    source: AudioScheduledSourceNode,
    nodes: AudioNode[],
    time: number,
    duration: number,
  ) {
    this.voices.add(source);
    source.onended = () => {
      this.voices.delete(source);
      source.disconnect();
      nodes.forEach((node) => node.disconnect());
    };
    source.start(time);
    source.stop(time + duration + 0.04);
  }
  private tone(
    frequency: number,
    duration: number,
    volume = 0.18,
    delay = 0,
    end = frequency,
  ) {
    const ctx = this.context!;
    const time = ctx.currentTime + delay;
    const oscillator = ctx.createOscillator();
    const envelope = ctx.createGain();
    oscillator.frequency.setValueAtTime(frequency, time);
    oscillator.frequency.exponentialRampToValueAtTime(end, time + duration);
    envelope.gain.setValueAtTime(0, time);
    envelope.gain.linearRampToValueAtTime(volume, time + 0.012);
    envelope.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    oscillator.connect(envelope);
    envelope.connect(this.output!);
    this.voice(oscillator, [envelope], time, duration);
  }
  private noise(duration: number, frequency: number, volume: number, pan = 0) {
    const ctx = this.context!;
    const time = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = this.air;
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = frequency;
    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(0, time);
    envelope.gain.linearRampToValueAtTime(
      volume,
      time + Math.min(0.08, duration / 4),
    );
    envelope.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    const stereo = ctx.createStereoPanner();
    stereo.pan.value = pan;
    source.connect(filter);
    filter.connect(envelope);
    envelope.connect(stereo);
    stereo.connect(this.output!);
    this.voice(source, [filter, envelope, stereo], time, duration);
  }
  private chime(notes: number[], duration = 0.7) {
    notes.forEach((note, i) => this.tone(note, duration, 0.14, i * 0.095));
  }
  private render(sound: EntrySound, step = 1) {
    switch (sound) {
      case "tap":
        this.tone(
          [220, 261.63, 293.66, 329.63, 392][
            Math.min(4, Math.max(0, step - 1))
          ],
          0.45,
        );
        break;
      case "rotate":
        this.noise(0.16, 1100, 0.24);
        this.tone(180, 0.12, 0.15, 0, 110);
        break;
      case "aligned":
        this.chime([523.25, 783.99], 0.4);
        break;
      case "gate":
        this.noise(2.2, 360, 0.65);
        this.tone(80, 2.2, 0.3, 0, 38);
        this.chime([130.81, 196, 261.63], 1.5);
        break;
      case "step":
        this.nextFoot = !this.nextFoot;
        this.noise(0.2, 650, 0.35, this.nextFoot ? -0.18 : 0.18);
        this.tone(85, 0.17, 0.22, 0, 42);
        break;
      case "chamber":
        this.chime([392, 587.33, 783.99], 1.2);
        break;
      case "search":
        this.noise(0.3, 1600, 0.24);
        break;
      case "key":
        this.chime([880, 1318.51, 1760], 0.65);
        break;
      case "locked":
        this.tone(130, 0.14, 0.26);
        this.tone(110, 0.14, 0.22, 0.15);
        break;
      case "unlock":
        this.noise(0.2, 1900, 0.3);
        this.chime([392, 493.88, 587.33, 783.99], 0.9);
        break;
      case "click":
        this.tone(392, 0.09, 0.1);
        break;
      case "success":
        this.chime([523.25, 659.25, 783.99]);
        break;
      case "error":
        this.tone(220, 0.23, 0.12, 0, 165);
        break;
      case "login":
        this.chime([261.63, 392, 523.25], 1);
        break;
    }
  }
}

export const entryAudio = new EntryAudio();
export const playEntrySound = (sound: EntrySound, step?: number) =>
  entryAudio.play(sound, step);
