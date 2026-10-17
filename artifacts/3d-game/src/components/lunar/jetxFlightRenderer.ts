import { store, type GameState } from "@/game/store";
import jetUrl from "@/assets/jetx/jet-v2.webp";
import airportUrl from "@/assets/jetx/airport-v2.webp";
import cloudUrl from "@/assets/jetx/clouds-v2.webp";
import parachuteUrl from "@/assets/jetx/parachute-v2.webp";
import { clamp01, jetxFlightMotion, smooth } from "./jetxFlightMotion";
import { jetxPlayers } from "./jetxPlayers";
import { getJetXPreferences } from "./jetxPreferences";

type Motion = ReturnType<typeof jetxFlightMotion>;
type Color = [number, number, number];
type Jumper = { id: string; born: number; payout: number; seed: number; x: number; y: number };
const mix = (a: Color, b: Color, t: number) => a.map((v, i) => Math.round(v + (b[i] - v) * t)) as Color;
const rgb = (c: Color) => `rgb(${c.join(",")})`;
const random = (n: number) => { const v = Math.sin(n * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
const wrap = (n: number, period: number) => ((n % period) + period) % period;
const rupees = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });

/** Independent moving scenery and actors, composited at the display refresh rate.
 * No timers or animation events can place, settle, or change the outcome of bets. */
export class JetXFlightRenderer {
  private ctx: CanvasRenderingContext2D;
  private frame = 0;
  private disposed = false;
  private observer: ResizeObserver;
  private reduced = matchMedia("(prefers-reduced-motion: reduce)");
  private jet = new Image();
  private airport = new Image();
  private cloudArt = new Image();
  private parachute = new Image();
  private airportTile: HTMLCanvasElement | null = null;
  private clouds: HTMLCanvasElement[];
  private width = 1;
  private height = 1;
  private pixelRatio = 1;
  private planeWidth = 185;
  private planeX = 0;
  private ground = 0;
  private readoutTop = 0;
  private headerBottom = 90;
  private textBounds = { x: 0, y: 0, width: 0, height: 0 };
  private round = "";
  private lastPhase = "";
  private crashTime = 0;
  private lastTime = 0;
  private idleDistance = 0;
  private telemetryAt = 0;
  private jumpers: Jumper[] = [];
  private seen = new Set<string>();
  private motionTime = 0;
  private layoutKey = "";
  private labels: { x: number; y: number; width: number; height: number; text: string; alpha: number }[] = [];
  private motionReduced = () => this.reduced.matches || !getJetXPreferences().animations;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d", { alpha: false })!;
    this.clouds = [this.cloudTexture(0), this.cloudTexture(1), this.cloudTexture(2)];
    this.airport.onload = () => { if (!this.disposed) this.airportTile = this.makeAirportTile(); };
    this.airport.src = airportUrl;
    this.jet.src = jetUrl;
    this.parachute.src = parachuteUrl;
    this.cloudArt.onload = () => { if (!this.disposed) this.clouds = [0, 1, 2].map(theme => this.cloudArtTexture(theme)); };
    this.cloudArt.src = cloudUrl;
    this.observer = new ResizeObserver(this.resize);
    const scene = canvas.parentElement!;
    for (const node of [scene, scene.querySelector(".jetx-aircraft"), scene.querySelector(".jetx-readout"), scene.parentElement?.querySelector(".jetx-round-toolbar")]) {
      if (node) this.observer.observe(node);
    }
    this.reduced.addEventListener("change", this.resize);
    document.addEventListener("visibilitychange", this.visibility);
    this.resize();
    this.frame = requestAnimationFrame(this.render);
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    this.reduced.removeEventListener("change", this.resize);
    document.removeEventListener("visibilitychange", this.visibility);
    this.airport.onload = null;
    this.cloudArt.onload = null;
  }

  private visibility = () => {
    cancelAnimationFrame(this.frame);
    this.lastTime = 0;
    if (!document.hidden && !this.disposed) this.frame = requestAnimationFrame(this.render);
  };

  private resize = () => {
    const scene = this.canvas.parentElement!;
    const bounds = scene.getBoundingClientRect();
    const anchor = scene.querySelector(".jetx-aircraft")?.getBoundingClientRect();
    const readout = scene.querySelector(".jetx-readout")?.getBoundingClientRect();
    const toolbar = scene.parentElement?.querySelector(".jetx-round-toolbar")?.getBoundingClientRect();
    if (!anchor || !readout || !bounds.width || !bounds.height) return;
    this.width = bounds.width;
    this.height = bounds.height;
    this.pixelRatio = Math.min(devicePixelRatio || 1, store.getState().settings.quality === "low" ? 1 : 2);
    this.canvas.width = Math.round(this.width * this.pixelRatio);
    this.canvas.height = Math.round(this.height * this.pixelRatio);
    this.ctx.imageSmoothingQuality = "high";
    this.planeWidth = anchor.width;
    this.planeX = anchor.left - bounds.left + anchor.width / 2;
    this.readoutTop = readout.top - bounds.top;
    // Switching the shorter betting dock must not pull the airport/plane up
    // with its readout; the reference keeps the runway at the same height.
    this.ground = this.readoutTop - 3 + (getJetXPreferences().panelCount < 4 ? 26 : 0);
    this.headerBottom = toolbar ? toolbar.bottom - bounds.top : 90;
    // Keep actors out of the live multiplier/countdown without clipping the scenery.
    this.textBounds = { x: readout.left - bounds.left + 20, y: this.readoutTop, width: Math.max(0, readout.width - 40), height: readout.height + 38 };
    this.canvas.dataset.reducedMotion = String(this.motionReduced());
  };

  private cloudTexture(theme: number) {
    const surface = document.createElement("canvas");
    surface.width = 512; surface.height = 210;
    const ctx = surface.getContext("2d")!;
    const colors = [["#ffd0bc", "#db93af", "#775f93"], ["#d5c4e6", "#a39dc7", "#676b9d"], ["#9eacd2", "#616d9d", "#353e68"]][theme];
    // Shade one joined silhouette: individual outlined circles look like beads.
    const shape = new Path2D();
    const lobes = [[48,126,34],[103,110,49],[151,114,38],[205,77,62],[256,100,51],[305,111,45],[357,87,56],[407,121,46],[458,131,31]];
    for (const [x,y,r] of lobes) { shape.moveTo(x+r,y); shape.arc(x,y,r,0,Math.PI*2); }
    const gradient = ctx.createLinearGradient(0, 24, 0, 186);
    gradient.addColorStop(0, colors[0]); gradient.addColorStop(.45, colors[1]); gradient.addColorStop(1, colors[2]);
    ctx.fillStyle=gradient;ctx.shadowColor=colors[1];ctx.shadowBlur=9;ctx.fill(shape);ctx.shadowBlur=0;
    ctx.save();ctx.clip(shape);
    for (const [x,y,r] of lobes) {
      const light=ctx.createRadialGradient(x-r*.2,y-r*.65,0,x,y-r*.3,r*1.2);
      light.addColorStop(0,colors[0]+"50");light.addColorStop(1,colors[0]+"00");
      ctx.fillStyle=light;ctx.fillRect(x-r*1.5,y-r*1.5,r*3,r*3);
    }
    ctx.restore();
    ctx.globalCompositeOperation = "destination-in";
    const fade = ctx.createLinearGradient(0, 100, 0, 204);
    fade.addColorStop(0, "#fff"); fade.addColorStop(.45, "#ffffffc0"); fade.addColorStop(1, "#ffffff00");
    ctx.fillStyle = fade; ctx.fillRect(0, 0, 512, 210);
    return surface;
  }

  private makeAirportTile() {
    // The reference artwork supplies the distant buildings only. Sky, runway,
    // lighting, camera movement and every flying actor are rendered separately.
    const tile = document.createElement("canvas"); tile.width = 1600; tile.height = 310;
    const ctx = tile.getContext("2d")!;
    ctx.drawImage(this.airport, 0, this.airport.naturalHeight * .205, this.airport.naturalWidth, this.airport.naturalHeight * .357, 0, 0, 1600, 310);
    ctx.globalCompositeOperation = "destination-in";
    const fade = ctx.createLinearGradient(0, 0, 0, 310);
    fade.addColorStop(0, "#fff0"); fade.addColorStop(.22, "#fff"); fade.addColorStop(.98, "#fff"); fade.addColorStop(1, "#ffffffc0");
    ctx.fillStyle = fade; ctx.fillRect(0, 0, 1600, 310);
    const sides = ctx.createLinearGradient(0, 0, 1600, 0);
    sides.addColorStop(0,"#fff0");sides.addColorStop(.08,"#fff");sides.addColorStop(.92,"#fff");sides.addColorStop(1,"#fff0");
    ctx.fillStyle=sides;ctx.fillRect(0,0,1600,310);
    return tile;
  }

  private cloudArtTexture(theme: number) {
    const texture = document.createElement("canvas"); texture.width = 768; texture.height = 320;
    const ctx = texture.getContext("2d")!;
    ctx.drawImage(this.cloudArt, 0, 0, this.cloudArt.naturalWidth, this.cloudArt.naturalHeight * .77, 0, 0, 768, 320);
    const pixels = ctx.getImageData(0, 0, 768, 320);
    // Turn the painted warm cloud volumes into reusable translucent sprites.
    // The lavender sky is transparent, so the live sky gradient shows through.
    for (let y = 0; y < 320; y++) for (let x = 0; x < 768; x++) {
      const i = (y * 768 + x) * 4, r = pixels.data[i], g = pixels.data[i + 1], b = pixels.data[i + 2];
      const edge = 1 - smooth(.4, 1, Math.hypot((x - 384) / 384, (y - 135) / 180));
      const mask = smooth(12, 58, r - b) * smooth(18, 48, r - g) * smooth(0, 110, x) * smooth(0, 110, 767-x) * edge;
      const tint = theme === 2 ? mix([r,g,b],[72,82,131],.62) : theme === 1 ? mix([r,g,b],[162,153,195],.38) : [r,g,b];
      pixels.data[i] = tint[0]; pixels.data[i+1] = tint[1]; pixels.data[i+2] = tint[2]; pixels.data[i+3] = Math.round(mask * 255);
    }
    ctx.putImageData(pixels, 0, 0);
    return texture;
  }

  private render = (now: number) => {
    if (this.disposed || document.hidden) return;
    this.frame = requestAnimationFrame(this.render);
    const state = store.getState();
    const layoutKey = `${getJetXPreferences().panelCount}:${state.panels.filter(p => p.activeBetId || p.pendingBet).length}`;
    if (layoutKey !== this.layoutKey) { this.layoutKey = layoutKey; this.resize(); }
    const frameInterval = this.motionReduced() || state.settings.quality === "low" ? 1000 / 30 : 1000 / 60;
    if (this.lastTime && now - this.lastTime < frameInterval - 1) return;
    const dt = this.lastTime ? Math.min(.1, (now - this.lastTime) / 1000) : 0;
    this.lastTime = now;
    if (this.round !== state.roundId) {
      this.round = state.roundId; this.jumpers = []; this.seen.clear(); this.idleDistance = 0;
      this.lastPhase = state.phase; this.crashTime = now;
    }
    if (state.phase !== this.lastPhase) {
      this.lastPhase = state.phase;
      if (state.phase === "crashed") this.crashTime = now;
    }
    if (!this.motionReduced()) this.motionTime += dt;
    if (state.phase === "betting" && !this.motionReduced()) this.idleDistance += dt * 4;
    const motion = jetxFlightMotion(state.phase, state.flyMs, state.multiplier);
    const t = this.motionTime;
    const distance = this.motionReduced() ? 0 : motion.distance + this.idleDistance;
    const planeHeight = this.planeWidth / 3;
    const rise = Math.min(22, Math.max(8, (this.ground - this.headerBottom) * .08));
    const planeY = this.ground - planeHeight * .31 - 6 - rise * motion.lift;
    const planeX = this.planeX - 6 + smooth(0, 2.2, motion.seconds) * 12 - motion.lift * 6;
    const runwayY = this.ground + motion.climb * this.height * 1.15;
    this.ctx.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    this.drawSky(motion, t);
    this.drawClouds(motion, distance, t, false);
    if (runwayY < this.height + 200) this.drawRunway(runwayY, distance, planeX, planeY, motion);
    this.drawClouds(motion, distance, t, true);
    this.drawWind(planeX, planeY, motion, t);
    this.collectCashouts(state, now, planeX, planeY);
    let decorative = 0;
    this.labels = [];
    this.ctx.save();
    const safe = this.textBounds;
    this.ctx.beginPath(); this.ctx.rect(0, 0, this.width, this.height);
    this.ctx.rect(safe.x, safe.y, safe.width, safe.height); this.ctx.clip("evenodd");
    // Unlabelled skydivers are scenery, never fake player bets or winnings.
    if (state.phase !== "betting" && motion.seconds > 2.5) {
      const latest = Math.floor((motion.seconds - 2.5) / .28);
      const elapsedAfterCrash = state.phase === "crashed" ? (now - this.crashTime) / 1000 : 0;
      for (let i = Math.max(0, latest - 29); i <= latest; i++) {
        const age = motion.seconds - 2.5 - i * .28 + elapsedAfterCrash;
        if (age < 10) {
          this.drawJumper(planeX - this.planeWidth * (.35 + random(i + 9) * .55), planeY - random(i + 31) * 45, this.motionReduced() ? 3 + i % 3 : age, random(i + 4), undefined, t);
          decorative++;
        }
      }
    }
    this.jumpers = this.jumpers.filter(j => now - j.born < 12000);
    for (const jumper of this.jumpers) {
      this.drawJumper(jumper.x * this.width, jumper.y * this.height, this.motionReduced() ? 3 : (now - jumper.born) / 1000, jumper.seed, jumper.payout, t);
    }
    this.ctx.restore();
    // A separate pass keeps later canopies from painting over payout text.
    this.ctx.save(); this.ctx.font = "bold 13px Arial"; this.ctx.textAlign = "center";
    for (const label of this.labels) {
      this.ctx.globalAlpha = label.alpha;
      this.ctx.fillStyle = "#f8fff0"; this.ctx.beginPath(); this.ctx.roundRect(label.x, label.y, label.width, 21, 10.5); this.ctx.fill();
      this.ctx.fillStyle = "#448e3c"; this.ctx.fillText(label.text, label.x + label.width / 2, label.y + 15);
    }
    this.ctx.restore();
    const exit = state.phase === "crashed" ? clamp01((now - this.crashTime) / 700) : 0;
    if (state.roundId !== "connecting" && exit < 1) this.drawPlane(planeX, planeY, motion, t, exit);
    this.drawShade(state.phase);
    if (now - this.telemetryAt > 100) {
      this.telemetryAt = now;
      Object.assign(this.canvas.dataset, {
        flightStage: motion.stage, planeY: planeY.toFixed(1), runwayY: runwayY.toFixed(1), runwayOffset: distance.toFixed(1),
        pitch: motion.pitch.toFixed(2), gear: motion.gear.toFixed(2),
        jumpers: String(decorative + this.jumpers.length), cashoutJumpers: String(this.jumpers.length),
        cashoutIds: this.jumpers.map(j => j.id).join(","), assetsReady: String(this.jet.complete && this.jet.naturalWidth > 0 && !!this.airportTile),
        reducedMotion: String(this.motionReduced()),
      });
    }
  };

  private drawSky(m: Motion, t: number) {
    const ctx = this.ctx;
    const top = mix(mix([84, 61, 72], [64, 59, 89], m.dusk), [9, 17, 45], m.night);
    const middle = mix(mix([193, 136, 151], [99, 107, 150], m.dusk), [37, 51, 96], m.night);
    const bottom = mix(mix([221, 159, 160], [118, 112, 151], m.dusk), [68, 64, 107], m.night);
    const sky = ctx.createLinearGradient(0, 0, 0, this.height);
    sky.addColorStop(0, rgb(top)); sky.addColorStop(.29, rgb(middle)); sky.addColorStop(.57, rgb(bottom)); sky.addColorStop(1, "#211d34");
    ctx.fillStyle = sky; ctx.fillRect(0, 0, this.width, this.height);
    if (m.night > .1) {
      const alpha = smooth(.1, .7, m.night);
      ctx.save(); ctx.globalAlpha = alpha;
      for (let i = 0; i < 65; i++) {
        ctx.fillStyle = `rgba(212,223,255,${(.16 + random(i + 2) * .6) * m.night})`;
        ctx.beginPath(); ctx.arc(random(i + 5) * this.width, this.headerBottom + random(i + 300) * this.height * .5, .5 + random(i + 34), 0, Math.PI * 2); ctx.fill();
      }
      const radius = Math.max(26, Math.min(62, this.width * .055));
      const x = this.width * .79, y = this.headerBottom + radius + 24;
      const glow = ctx.createRadialGradient(x, y, radius * .7, x, y, radius * 1.45);
      glow.addColorStop(0, "#ecaed43f"); glow.addColorStop(1, "#ecaed400");
      ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(x, y, radius * 1.45, 0, Math.PI * 2); ctx.fill();
      const moon = ctx.createRadialGradient(x - radius * .6, y + radius * .3, 0, x + radius * .5, y - radius * .2, radius * 1.7);
      moon.addColorStop(0, "#ffd6d1"); moon.addColorStop(.45, "#bc8fbb"); moon.addColorStop(1, "#675c91");
      ctx.fillStyle = moon; ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill(); ctx.clip();
      for (let i = 0; i < 25; i++) {
        ctx.fillStyle = i % 2 ? "#6b568c25" : "#e8c4d225";
        ctx.beginPath(); ctx.ellipse(x + (random(i + 24) - .5) * radius * 1.8, y + (random(i + 74) - .5) * radius * 1.8, radius * (.04 + random(i + 12) * .15), radius * (.04 + random(i + 82) * .12), t * 0, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }
  }

  private drawClouds(m: Motion, distance: number, t: number, foreground: boolean) {
    const ctx = this.ctx, count = foreground ? 6 : 10;
    ctx.save();
    for (let i = 0; i < count; i++) {
      const seed = i + (foreground ? 60 : 0);
      const width = (foreground ? .65 : .46) * Math.max(620, this.width) * (.6 + random(seed + 21));
      const speed = foreground ? .48 : .095;
      const x = wrap(random(seed + 14) * (this.width + width * 2) - distance * speed - t * (foreground ? 8 : 2), this.width + width * 2) - width;
      const y = foreground
        ? this.height * (.58 + random(seed + 22) * .18) + (1 - m.climb) * this.height * .26
        : this.height * (.08 + random(seed + 46) * .27) + m.climb * this.height * .05;
      const alpha = foreground ? .62 * smooth(.05, .8, m.climb) : (.08 + .55 * m.climb) + random(seed + 91) * .08;
      ctx.globalAlpha = alpha * (1-m.dusk);
      ctx.drawImage(this.clouds[0], x, y, width, width * 210 / 512);
      if (m.dusk > 0) { ctx.globalAlpha = alpha * m.dusk * (1-m.night); ctx.drawImage(this.clouds[1], x, y, width, width * 210 / 512); }
      if (m.night > 0) { ctx.globalAlpha = alpha * m.night; ctx.drawImage(this.clouds[2], x, y, width, width * 210 / 512); }
    }
    ctx.restore();
  }

  private drawRunway(y: number, distance: number, planeX: number, planeY: number, m: Motion) {
    const ctx = this.ctx;
    const horizon = y - Math.max(25, this.planeWidth * .13);
    const skylineWidth = Math.max(710, this.width * 1.2);
    const skylineHeight = skylineWidth * 310 / 1600;
    if (this.airportTile) {
      const step = skylineWidth * .92, shift = wrap(this.width * .13 + distance * .14, step);
      for (let x = -shift; x < this.width; x += step) ctx.drawImage(this.airportTile, x, horizon - skylineHeight, skylineWidth, skylineHeight);
    }
    const floor = ctx.createLinearGradient(0, horizon, 0, Math.max(horizon + 1, this.height));
    floor.addColorStop(0, "#34324c"); floor.addColorStop(.22, "#181828"); floor.addColorStop(.62, "#080911"); floor.addColorStop(1, "#050609");
    ctx.fillStyle = floor; ctx.fillRect(0, horizon, this.width, Math.max(0, this.height - horizon));
    ctx.fillStyle = "#b7a7c325"; ctx.fillRect(0, horizon, this.width, 1);
    ctx.fillStyle = "#a9a0785c";
    const dash = Math.max(54, this.width * .078), offset = wrap(distance, dash * 2.5);
    for (let x = -offset; x < this.width; x += dash * 2.5) ctx.fillRect(x, y + 4, dash, 2);
    const spacing = Math.max(110, this.width / 4), lights = wrap(distance * .75, spacing);
    for (let x = -lights; x < this.width + spacing; x += spacing) {
      const glow = ctx.createRadialGradient(x, y + 60, 0, x, y + 60, 15);
      glow.addColorStop(0, "#e4cd78aa"); glow.addColorStop(.15, "#bf982b66"); glow.addColorStop(1, "#af893300");
      ctx.save(); ctx.translate(x, y + 60); ctx.scale(1, .4); ctx.translate(-x, -y - 60);
      ctx.fillStyle = glow; ctx.fillRect(x - 15, y + 45, 30, 30); ctx.restore();
    }
    if (m.climb < .5) {
      ctx.save(); ctx.globalAlpha = .28 * (1 - m.climb * 2);
      ctx.translate(planeX, y + 7); ctx.scale(1, .1 + (y - planeY) / 800);
      const shadow = ctx.createRadialGradient(0, 0, 0, 0, 0, this.planeWidth * .6);
      shadow.addColorStop(0, "#02030c"); shadow.addColorStop(1, "#02030c00");
      ctx.fillStyle = shadow; ctx.fillRect(-this.planeWidth, -this.planeWidth, this.planeWidth * 2, this.planeWidth * 2); ctx.restore();
    }
  }

  private drawWind(x: number, y: number, m: Motion, t: number) {
    if (!m.lift || this.motionReduced()) return;
    const ctx = this.ctx; ctx.save(); ctx.globalAlpha = m.lift * .13;
    ctx.strokeStyle = "#ded7ef"; ctx.lineWidth = 1;
    for (let i = 0; i < 8; i++) {
      const dx = wrap(t * 115 + i * 63, this.width + 120);
      const dy = y + (random(i + 170) - .5) * 170;
      ctx.beginPath(); ctx.moveTo(this.width - dx, dy); ctx.lineTo(this.width - dx + 12 + random(i) * 24, dy - 1); ctx.stroke();
    }
    ctx.restore();
  }

  private drawPlane(x: number, y: number, m: Motion, t: number, exit: number) {
    const ctx = this.ctx, w = this.planeWidth, h = w / 3;
    const vibration = this.motionReduced() ? 0 : Math.sin(t * (m.lift ? 2.4 : 48)) * (m.lift ? 2.6 : .4);
    ctx.save(); ctx.globalAlpha = 1 - smooth(.7, 1, exit);
    ctx.translate(x + exit * (this.width * .8 + w), y + vibration - exit * this.height * .4);
    ctx.rotate((m.pitch - exit * 8) * Math.PI / 180);
    const thrust = (m.seconds ? .33 : .14) * w * (this.motionReduced() ? 1 : 1 + Math.sin(t * 65) * .12);
    const exhaust = ctx.createLinearGradient(-w * .41 - thrust, 0, -w * .4, 0);
    exhaust.addColorStop(0, "#a4b8ff00"); exhaust.addColorStop(.35, "#b9c7ff60"); exhaust.addColorStop(.7, "#ffb541cc"); exhaust.addColorStop(1, "#fff8d9");
    ctx.fillStyle = exhaust; ctx.beginPath(); ctx.moveTo(-w * .4, -3); ctx.quadraticCurveTo(-w * .54, -6, -w * .41 - thrust, 0); ctx.quadraticCurveTo(-w * .54, 6, -w * .4, 3); ctx.fill();
    if (m.gear > 0) {
      ctx.save(); ctx.globalAlpha *= m.gear;
      for (const wx of [-w * .15, w * .27]) {
        const foot = h * .31 + 3;
        ctx.strokeStyle = "#b5b6bd"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(wx - 3, h * .09); ctx.lineTo(wx, foot * m.gear); ctx.stroke();
        ctx.fillStyle = "#12141e"; ctx.beginPath(); ctx.arc(wx, foot * m.gear, 3.2, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#8b90a0"; ctx.beginPath(); ctx.arc(wx, foot * m.gear, 1.2, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }
    if (this.jet.complete && this.jet.naturalWidth) ctx.drawImage(this.jet, -w / 2, -h / 2, w, h);
    ctx.restore();
  }

  private collectCashouts(state: GameState, now: number, x: number, y: number) {
    if (state.phase !== "flying") return;
    const bets = jetxPlayers(state.roundId, state.liveBets, state.realLiveBetsActive, state.myBets);
    for (const bet of bets) {
      if (bet.roundId !== state.roundId || bet.cashedOutAt == null || bet.payout <= 0 || this.seen.has(bet.id)) continue;
      this.seen.add(bet.id);
      this.jumpers.push({ id: bet.id, born: now, payout: bet.payout, seed: random(this.seen.size + 64), x: (x - this.planeWidth * .38) / this.width, y: y / this.height });
    }
    this.jumpers = this.jumpers.slice(-12);
  }

  private drawJumper(originX: number, originY: number, age: number, seed: number, payout: number | undefined, t: number) {
    const ctx = this.ctx;
    const size = Math.max(34, Math.min(76, this.width * .076)) * (.85 + seed * .36);
    const open = smooth(.22, .9, age);
    const sway = this.motionReduced() ? 0 : Math.sin(age * 2.5 + seed * 8) * .1;
    const spread = smooth(.15, 1.6, age);
    const x = originX - age * Math.max(24, this.width * (.026 + seed * .044)) - spread * seed * this.width * .17 - Math.sin(age * 1.5) * 5;
    const y = originY + 14 * open - spread * seed * 18 + Math.min(age, .7) * 12 + Math.max(0, age - .7) * 9;
    ctx.save(); ctx.globalAlpha = smooth(0, .12, age) * (1 - smooth(9, 12, age)) * (.7 + seed * .25);
    ctx.translate(x, y); ctx.scale(size / 64, size / 64); ctx.rotate(sway);
    // Canopy inflates above the falling pilot; its suspension lines stretch taut.
    const canopyY = -56 * open;
    if (open > 0 && this.parachute.complete && this.parachute.naturalWidth) {
      ctx.save(); ctx.translate(0, -10); ctx.scale(open, .15 + open * .85);
      ctx.drawImage(this.parachute, 0, 100, 1024, 950, -32, -61, 64, 59.375);
      ctx.restore();
    } else if (open > 0) {
      ctx.save(); ctx.translate(0, canopyY); ctx.scale(open, .55 + open * .45);
      ctx.strokeStyle = "#d4cde4b0"; ctx.lineWidth = .65;
      for (let i = 0; i < 7; i++) { const lineX = -31 + i * 10.33; ctx.beginPath(); ctx.moveTo(lineX, -5 + Math.abs(i - 3) * 1.5); ctx.lineTo(i < 3 ? -5 : 5, 46); ctx.stroke(); }
      for (let i = 0; i < 6; i++) {
        const left = -32 + i * 10.67, right = left + 10.67;
        const crown = -28 - (1 - Math.abs(i - 2.5) / 3) * 8;
        const gradient = ctx.createLinearGradient(left, -35, right + 5, 2);
        gradient.addColorStop(0, i % 2 ? "#d3c5ec" : "#bfb0e4"); gradient.addColorStop(.45, "#a397d1"); gradient.addColorStop(1, "#625e98");
        ctx.fillStyle = gradient; ctx.strokeStyle = "#e2d6f366"; ctx.lineWidth = .7;
        ctx.beginPath(); ctx.moveTo(left, -3 + Math.abs(i - 2.5) * 1.2); ctx.bezierCurveTo(left - 2, crown, right - 2, crown, right, -3 + Math.abs(i - 1.5)); ctx.quadraticCurveTo((left + right) / 2, -7, left, -3 + Math.abs(i - 2.5) * 1.2); ctx.fill(); ctx.stroke();
      }
      ctx.restore();
    }
    if (!(this.parachute.complete && this.parachute.naturalWidth)) {
    // Fallback pilot while the sprite is loading.
    const kick = this.motionReduced() ? .7 : Math.sin(t * 3.2 + seed * 8) * 2;
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.strokeStyle = "#443e6c"; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(-2, 9); ctx.lineTo(-5 - kick, 18); ctx.lineTo(-3 - kick, 24); ctx.moveTo(2, 9); ctx.lineTo(5 + kick, 17); ctx.lineTo(7 + kick, 22); ctx.stroke();
    ctx.strokeStyle = "#29293e"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(-4 - kick, 24); ctx.lineTo(-1 - kick, 25); ctx.moveTo(6 + kick, 22); ctx.lineTo(10 + kick, 22); ctx.stroke();
    const suit = ctx.createLinearGradient(-6, 0, 5, 13); suit.addColorStop(0, "#aca4d4"); suit.addColorStop(1, "#514b78");
    ctx.fillStyle = suit; ctx.beginPath(); ctx.roundRect(-5, -2, 10, 15, 3); ctx.fill();
    ctx.strokeStyle = "#928ab8"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(-4, 1); ctx.lineTo(-9, -3); ctx.lineTo(-7, -12 * open - 2); ctx.moveTo(4, 1); ctx.lineTo(9, -3); ctx.lineTo(7, -12 * open - 2); ctx.stroke();
    ctx.fillStyle = "#e0b8a3"; ctx.beginPath(); ctx.arc(0, -7, 3.7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#9184bd"; ctx.beginPath(); ctx.arc(0, -8, 4.2, Math.PI, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#45435f"; ctx.fillRect(-4, 1, 8, 3); ctx.strokeStyle = "#d6cdeb"; ctx.lineWidth = .8; ctx.strokeRect(-3, 0, 6, 9);
    } else {
      const kick = this.motionReduced() ? 0 : Math.sin(t * 2.6 + seed * 8) * .025;
      ctx.save(); ctx.translate(0, -10); ctx.rotate(kick);
      ctx.drawImage(this.parachute, 420, 1020, 150, 320, -6, 0, 12, 25.6);
      ctx.restore();
    }
    ctx.restore();
    if (payout !== undefined && age > .5 && this.labels.length < 6) {
      // Payout pills yield to the header, history and multiplier and to each
      // other. Canopies still drift as a crowd behind the plane.
      ctx.save(); ctx.font = "bold 13px Arial";
      const label = `₹ ${rupees.format(payout)}`, width = ctx.measureText(label).width + 18;
      const labelX = Math.max(6, Math.min(this.width - width - 6, x - width / 2));
      const preferredY = y - 86 * open * size / 64 - 22;
      const reserved = [{ x: 0, y: 0, width: 110, height: this.headerBottom }, { x: this.width - 235, y: 0, width: 235, height: this.headerBottom }, { x: 0, y: this.headerBottom - 38, width: this.width, height: 38 }, this.textBounds];
      for (const delta of [0, -26, 26, -52, 52, 78]) {
        const box = { x: labelX, y: Math.max(8, preferredY + delta), width, height: 21 };
        if (box.y + 21 > this.readoutTop + 22 || [...reserved, ...this.labels].some(r => box.x < r.x + r.width + 4 && box.x + width + 4 > r.x && box.y < r.y + r.height + 3 && box.y + 24 > r.y)) continue;
        this.labels.push({ ...box, text: label, alpha: smooth(.5, .9, age) * (1 - smooth(9, 12, age)) });
        break;
      }
      ctx.restore();
    }
  }

  private drawShade(phase: GameState["phase"]) {
    const ctx = this.ctx, shade = ctx.createLinearGradient(0, 0, 0, this.height);
    shade.addColorStop(0, "#070507c9"); shade.addColorStop(.21, phase === "betting" ? "#09091255" : "#09071400"); shade.addColorStop(.45, phase === "betting" ? "#05050960" : "#100a1018"); shade.addColorStop(.66, "#030204e8"); shade.addColorStop(1, "#030305");
    ctx.fillStyle = shade; ctx.fillRect(0, 0, this.width, this.height);
  }
}
