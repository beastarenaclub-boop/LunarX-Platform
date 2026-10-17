export class BikeAudio {
  private context:AudioContext|null=null;
  private engine:OscillatorNode|null=null;
  private harmonic:OscillatorNode|null=null;
  private gain:GainNode|null=null;
  private wind:GainNode|null=null;
  async start() {
    try {
      if(!this.context) {
        const ctx=new AudioContext();this.context=ctx;
        this.engine=ctx.createOscillator();this.engine.type='sawtooth';
        this.harmonic=ctx.createOscillator();this.harmonic.type='triangle';
        const filter=ctx.createBiquadFilter();filter.type='lowpass';filter.frequency.value=650;
        this.gain=ctx.createGain();this.gain.gain.value=0;
        this.engine.connect(filter);this.harmonic.connect(filter);filter.connect(this.gain);this.gain.connect(ctx.destination);
        this.engine.start();this.harmonic.start();
        const buffer=ctx.createBuffer(1,ctx.sampleRate*2,ctx.sampleRate),data=buffer.getChannelData(0);
        for(let i=0;i<data.length;i++)data[i]=(Math.random()*2-1)*.18;
        const noise=ctx.createBufferSource();noise.buffer=buffer;noise.loop=true;
        const windFilter=ctx.createBiquadFilter();windFilter.type='lowpass';windFilter.frequency.value=1100;
        this.wind=ctx.createGain();this.wind.gain.value=0;noise.connect(windFilter);windFilter.connect(this.wind);this.wind.connect(ctx.destination);noise.start();
      }
      await this.context.resume();
    }catch{/* The game remains playable when browser audio is unavailable. */}
  }
  update(rpm:number,speed:number,enabled:boolean,active:boolean) {
    if(!this.context||!this.engine||!this.harmonic||!this.gain||!this.wind)return;
    const t=this.context.currentTime;
    this.engine.frequency.setTargetAtTime(35+rpm/65,t,.08);
    this.harmonic.frequency.setTargetAtTime(70+rpm/32.5,t,.08);
    this.gain.gain.setTargetAtTime(enabled&&active?.027+speed*.00035:0,t,.12);
    this.wind.gain.setTargetAtTime(enabled&&active?speed*.008:0,t,.2);
  }
  beep(final=false) {
    if(!this.context)return;
    const ctx=this.context,osc=ctx.createOscillator(),gain=ctx.createGain();osc.frequency.value=final?1100:700;
    gain.gain.setValueAtTime(.055,ctx.currentTime);gain.gain.exponentialRampToValueAtTime(.001,ctx.currentTime+.18);
    osc.connect(gain);gain.connect(ctx.destination);osc.start();osc.stop(ctx.currentTime+.2);
  }
  dispose() {void this.context?.close();this.context=null;}
}
