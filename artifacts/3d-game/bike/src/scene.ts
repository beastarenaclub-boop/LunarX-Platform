import * as T from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { createBike, loadRider, type BikeModel } from './bike';
import { createWorld, loadWorldAssets } from './world';
import { RaceEngine, BIKES, type RaceSnapshot, type Settings } from './engine';
import { sampleTrack } from './track';
import { BikeAudio } from './audio';

export class GameScene {
  private static daylight:T.DataTexture;
  static async prepare() {
    await Promise.all([loadRider(),loadWorldAssets(),new HDRLoader().loadAsync(`${import.meta.env.BASE_URL}environment/daylight.hdr`).then(t=>{GameScene.daylight=t;})]);
  }
  readonly engine:RaceEngine;
  readonly audio=new BikeAudio();
  private renderer:T.WebGLRenderer;
  private scene=new T.Scene();
  private camera=new T.PerspectiveCamera(43,1,.05,3500);
  private player:BikeModel;
  private rivals:BikeModel[]=[];
  private sun=new T.DirectionalLight('#fff2d7',3.3);
  private world:ReturnType<typeof createWorld>;
  private frame=0;
  private lastTime=0;
  private uiElapsed=0;
  private orbit=0;
  private countdownSound=4;
  private observer:ResizeObserver;
  private stopped=false;
  private lastPhase='menu';
  private focus=new T.Vector3();
  private desiredCamera=new T.Vector3();
  private env:T.WebGLRenderTarget;
  private contactShadows:T.InstancedMesh;
  constructor(private canvas:HTMLCanvasElement,settings:Settings,private onUpdate:(state:RaceSnapshot)=>void,private onError:(message:string)=>void) {
    this.engine=new RaceEngine(settings);
    this.renderer=new T.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio,settings.quality==='high'?1.7:1));
    this.renderer.shadowMap.enabled=settings.quality==='high';this.renderer.shadowMap.type=T.PCFSoftShadowMap;
    this.renderer.toneMapping=T.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.10;
    this.scene.background=new T.Color('#b2d1e6');this.scene.fog=new T.Fog('#b2cbd3',280,1600);
    const pmrem=new T.PMREMGenerator(this.renderer);this.env=pmrem.fromEquirectangular(GameScene.daylight);this.scene.environment=this.env.texture;pmrem.dispose();
    this.scene.environmentIntensity=.65;GameScene.daylight.mapping=T.EquirectangularReflectionMapping;this.scene.background=GameScene.daylight;this.scene.backgroundIntensity=.75;this.scene.backgroundBlurriness=.035;
    this.scene.add(new T.HemisphereLight('#cce6ff','#5c6341',.55));this.sun.intensity=2.8;
    this.sun.position.set(-90,140,70);this.sun.castShadow=true;this.sun.shadow.mapSize.set(2048,2048);this.sun.shadow.camera.left=-40;this.sun.shadow.camera.right=40;this.sun.shadow.camera.top=40;this.sun.shadow.camera.bottom=-40;this.sun.shadow.camera.near=10;this.sun.shadow.camera.far=300;this.sun.shadow.bias=-.00025;this.sun.shadow.normalBias=.025;this.scene.add(this.sun,this.sun.target);
    this.world=createWorld(this.scene);
    const shadowCanvas=document.createElement('canvas');shadowCanvas.width=shadowCanvas.height=128;const shadowContext=shadowCanvas.getContext('2d')!;
    const gradient=shadowContext.createRadialGradient(64,64,8,64,64,64);gradient.addColorStop(0,'rgba(0,0,0,.58)');gradient.addColorStop(.4,'rgba(0,0,0,.35)');gradient.addColorStop(1,'rgba(0,0,0,0)');shadowContext.fillStyle=gradient;shadowContext.fillRect(0,0,128,128);
    const shadowGeo=new T.PlaneGeometry(1.6,3.4);shadowGeo.rotateX(-Math.PI/2);
    this.contactShadows=new T.InstancedMesh(shadowGeo,new T.MeshBasicMaterial({map:new T.CanvasTexture(shadowCanvas),transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2}),6);this.scene.add(this.contactShadows);
    const bike=BIKES.find(b=>b.id===settings.bike)!;
    this.player=createBike(bike.color,bike.accent);this.scene.add(this.player.root);
    this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(canvas.parentElement!);this.resize();
    canvas.addEventListener('webglcontextlost',this.contextLost);
    this.render(0);
  }
  private contextLost=(event:Event)=>{event.preventDefault();this.engine.pause();this.audio.update(0,0,false,false);this.onError('The 3D graphics connection was interrupted. Reload to return to the circuit.');};
  private resize() {const rect=this.canvas.parentElement!.getBoundingClientRect();this.renderer.setSize(Math.max(1,rect.width),Math.max(1,rect.height),false);this.camera.aspect=rect.width/Math.max(1,rect.height);this.camera.updateProjectionMatrix();}
  configure(settings:Settings) {
    if(settings.bike!==this.engine.settings.bike) {this.scene.remove(this.player.root);this.disposeObject(this.player.root);const b=BIKES.find(b=>b.id===settings.bike)!;this.player=createBike(b.color,b.accent);this.scene.add(this.player.root);}
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio,settings.quality==='high'?1.7:1));this.renderer.shadowMap.enabled=settings.quality==='high';
    this.engine.configure(settings);this.resize();
  }
  start() {
    this.engine.start();this.countdownSound=4;
    for(const model of this.rivals){this.scene.remove(model.root);this.disposeObject(model.root);}this.rivals=[];
    for(const r of this.engine.state.riders){const b=createBike(r.color,r.accent);this.scene.add(b.root);this.rivals.push(b);}
    void this.audio.start();this.emit();
  }
  menu() {this.engine.menu();for(const r of this.rivals)r.root.visible=false;this.emit();}
  pause() {this.engine.togglePause();if(this.engine.state.phase==='racing')void this.audio.start();this.emit();}
  recover(){this.engine.recover();this.emit();}
  private emit(){this.onUpdate({...this.engine.state,riders:this.engine.state.riders.map(r=>({...r})),lapTimes:[...this.engine.state.lapTimes],standings:[...this.engine.state.standings]});}
  private place(model:BikeModel,distance:number,offset:number,lean:number,speed:number,dt:number) {
    const p=sampleTrack(distance);model.root.position.set(p.x+p.nx*offset,.043,p.z+p.nz*offset);model.root.rotation.set(0,Math.atan2(p.tx,p.tz),lean,'YXZ');
    for(const w of model.wheels)w.rotation.x+=speed*dt/.365;
    return p;
  }
  private render=(now:number)=> {
    if(this.stopped)return;
    const dt=Math.min((now-this.lastTime)/1000||.016,.05);this.lastTime=now;
    try {
      this.engine.update(dt);const s=this.engine.state,settings=this.engine.settings,menu=s.phase==='menu';
      if(s.phase==='countdown') {const count=Math.ceil(s.countdown);if(count!==this.countdownSound){if(settings.sound&&count<=3)this.audio.beep();this.countdownSound=count;}}
      if(s.phase==='racing'&&this.lastPhase==='countdown'&&settings.sound)this.audio.beep(true);
      const changedPhase=this.lastPhase!==s.phase;this.lastPhase=s.phase;
      const p=this.place(this.player,menu?-12:s.distance,menu?0:s.offset,menu?-.07:s.lean,s.speed,s.phase==='paused'?0:dt);
      for(let i=0;i<this.rivals.length;i++) {const r=s.riders[i];if(r){this.rivals[i].root.visible=!menu;this.place(this.rivals[i],r.distance,r.offset,r.lean,r.speed,s.phase==='paused'?0:dt);}}
      const shadowPose=new T.Object3D(),shadowBikes=[this.player,...(menu?[]:this.rivals)];this.contactShadows.count=shadowBikes.length;
      shadowBikes.forEach((b,i)=>{shadowPose.position.copy(b.root.position);shadowPose.position.y=.06;shadowPose.rotation.set(0,b.root.rotation.y,0);shadowPose.updateMatrix();this.contactShadows.setMatrixAt(i,shadowPose.matrix);});this.contactShadows.instanceMatrix.needsUpdate=true;
      const pos=this.player.root.position;
      this.sun.position.set(pos.x-90,140,pos.z+70);this.sun.target.position.set(pos.x,0,pos.z);
      const forward=new T.Vector3(p.tx,0,p.tz),right=new T.Vector3(p.nx,0,p.nz);
      if(menu) {
        this.orbit+=dt*.075;
        const narrow=this.camera.aspect<.9;
        this.desiredCamera.copy(pos).addScaledVector(right,4.9+Math.sin(this.orbit)*.2).addScaledVector(forward,4.2);this.desiredCamera.y=2.05;
        this.focus.copy(pos).addScaledVector(right,narrow?-1.1:-1.55).addScaledVector(forward,.15);this.focus.y=narrow?1.0:.08;
        this.camera.fov=narrow?48:38;
      }else {
        if(settings.camera===1) {
          this.desiredCamera.copy(pos).addScaledVector(forward,.91).addScaledVector(right,-s.lean*.15);this.desiredCamera.y=1.47;
          this.focus.copy(pos).addScaledVector(forward,30);this.focus.y=1.1;this.camera.fov=77;
        }else if(settings.camera===2) {
          this.desiredCamera.copy(pos).addScaledVector(forward,-4.1).addScaledVector(right,3.2);this.desiredCamera.y=1.7;
          this.focus.copy(pos).addScaledVector(forward,3.2);this.focus.y=1.0;this.camera.fov=61;
        }else {
          this.desiredCamera.copy(pos).addScaledVector(forward,-5.3-s.speed*.009).addScaledVector(right,-s.lean*.6);this.desiredCamera.y=2.6;
          this.focus.copy(pos).addScaledVector(forward,7);this.focus.y=.8;this.camera.fov=58+s.speed*.12;
        }
      }
      if(changedPhase||now===0)this.camera.position.copy(this.desiredCamera);
      else this.camera.position.lerp(this.desiredCamera,1-Math.exp(-dt*(settings.camera===1&&!menu?22:7)));
      this.camera.up.set(!menu&&settings.camera===1?s.lean*.12:0,1,0);this.camera.lookAt(this.focus);this.camera.updateProjectionMatrix();
      for(let i=0;i<this.world.lights.children.length;i++){const light=this.world.lights.children[i] as T.Mesh<T.SphereGeometry,T.MeshStandardMaterial>;light.material.emissive.set(s.phase==='racing'?'#55ff45':'#9e1515');}
      this.audio.update(s.rpm,s.speed,settings.sound,s.phase==='racing'||s.phase==='countdown');
      this.renderer.render(this.scene,this.camera);
      this.uiElapsed+=dt;if(this.uiElapsed>.085||changedPhase){this.emit();this.uiElapsed=0;}
      this.frame=requestAnimationFrame(this.render);
    }catch(error){this.onError(error instanceof Error?error.message:'The 3D scene could not render.');this.engine.pause();this.audio.update(0,0,false,false);}
  };
  private disposeObject(object:T.Object3D) {
    const geometries=new Set<T.BufferGeometry>(),materials=new Set<T.Material>(),textures=new Set<T.Texture>();
    object.traverse(o=>{if(o instanceof T.Mesh||o instanceof T.Line){geometries.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material]){materials.add(m);for(const v of Object.values(m))if(v instanceof T.Texture)textures.add(v);}}});
    for(const g of geometries)g.dispose();for(const m of materials)m.dispose();for(const t of textures)t.dispose();
  }
  dispose(){this.stopped=true;cancelAnimationFrame(this.frame);this.observer.disconnect();this.canvas.removeEventListener('webglcontextlost',this.contextLost);this.audio.dispose();this.disposeObject(this.scene);this.env.dispose();this.renderer.dispose();}
}
