using System;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

namespace HorseRacing
{
    [Serializable] public class RunnerFrame { public int id;public float x,z,heading,gait; }
    [Serializable] public class RaceFrame
    {
        public string venue="royal",camera="broadcast",round="";
        public bool running;public float elapsed;public int featured,winner;public RunnerFrame[] runners;
    }
    public sealed class HorseBridge : MonoBehaviour
    {
        [Serializable] class SponsorFrame { public string slot,image; }
        HorseWorld world;readonly HorseRunner[] runners=new HorseRunner[8];Camera cameraView;Light sun,fill;
        RaceFrame state,previous;bool external,paused;float received,frameInterval=.033f;string shot="",lighting="";Vector3 previousTarget;
        float performanceTime,performanceFrames;int slowWindows,fastWindows;
        HorseDust dust;DepthOfField depthOfField;
        void Start()
        {
            Application.targetFrameRate=60;QualitySettings.vSyncCount=0;
            RenderSettings.skybox=new Material(Resources.Load<Material>("HorseSky"));RenderSettings.ambientMode=AmbientMode.Trilight;
            RenderSettings.ambientSkyColor=new Color(.65f,.72f,.8f);RenderSettings.ambientEquatorColor=new Color(.49f,.53f,.48f);RenderSettings.ambientGroundColor=new Color(.25f,.25f,.2f);
            RenderSettings.fog=true;RenderSettings.fogMode=FogMode.ExponentialSquared;RenderSettings.fogDensity=.0016f;RenderSettings.fogColor=new Color(.67f,.75f,.79f);
            sun=new GameObject("Late afternoon sun").AddComponent<Light>();sun.type=LightType.Directional;sun.intensity=1.65f;sun.color=new Color(1,.94f,.84f);sun.shadows=LightShadows.Soft;
            sun.transform.rotation=Quaternion.Euler(36,-36,0);sun.shadowBias=.025f;sun.shadowNormalBias=.14f;sun.shadowStrength=.82f;
            fill=new GameObject("Diffuse sky fill").AddComponent<Light>();fill.type=LightType.Directional;fill.intensity=.9f;fill.color=new Color(.78f,.87f,1);fill.shadows=LightShadows.None;
            fill.transform.rotation=Quaternion.Euler(52,150,0);
            cameraView=new GameObject("Race broadcast camera").AddComponent<Camera>();cameraView.nearClipPlane=.2f;cameraView.farClipPlane=1000;cameraView.fieldOfView=42;
            cameraView.GetUniversalAdditionalCameraData().renderPostProcessing=true;
            cameraView.GetUniversalAdditionalCameraData().antialiasing=AntialiasingMode.FastApproximateAntialiasing;
            var volume=new GameObject("Broadcast color").AddComponent<Volume>();volume.isGlobal=true;volume.sharedProfile=Resources.Load<VolumeProfile>("HorsePost");
            volume.profile.TryGet(out depthOfField);
            world=new HorseWorld(transform);
            dust=new HorseDust(transform);
            for(int i=0;i<8;i++){runners[i]=new GameObject().AddComponent<HorseRunner>();runners[i].transform.SetParent(transform,false);runners[i].Initialize(i+1,world.Geometry);}
            Debug.Log("HORSE_SCENE_READY: 8 mounted runners, "+world.SpectatorCount+" scanned spectators with mesh/impostor LOD, hoof dust");
        }
        public void SetState(string json)
        {
            try
            {
                var next=JsonUtility.FromJson<RaceFrame>(json);
                if(next?.runners==null||next.runners.Length!=8)return;
                for(int i=0;i<8;i++)if(next.runners[i].id!=i+1||!float.IsFinite(next.runners[i].x)||!float.IsFinite(next.runners[i].z)||!float.IsFinite(next.runners[i].heading)||!float.IsFinite(next.runners[i].gait))return;
                bool continuous=state!=null&&state.round==next.round&&state.running==next.running&&state.winner==next.winner&&state.featured==next.featured&&next.elapsed>=state.elapsed&&next.elapsed-state.elapsed<.5f;
                previous=continuous?state:null;
                frameInterval=Mathf.Clamp(Time.unscaledTime-received,.016f,.1f);
                state=next;received=Time.unscaledTime;external=true;
            }
            catch(Exception e){Debug.LogWarning("Rejected race frame: "+e.Message);}
        }
        public void SetPaused(string value){paused=value=="true";}
        public void SetSponsor(string json)
        {
            try { var ad=JsonUtility.FromJson<SponsorFrame>(json);if(world!=null&&ad!=null)world.Sponsor(ad.slot,ad.image); }
            catch(Exception e){Debug.LogWarning("Sponsor artwork rejected: "+e.Message);}
        }
        void LateUpdate()
        {
            if(world==null||paused)return;
            if(!external)Demo();if(state==null)return;
            var s=state;float age=Mathf.Min(.1f,Time.unscaledTime-received);
            Vector3 center=Vector3.zero;Bounds bounds=new Bounds();bool first=true;
            for(int i=0;i<8;i++)
            {
                var f=s.runners[i];var p=new Vector3(f.x,0,f.z);float heading=f.heading,gait=f.gait;
                if(previous!=null)
                {
                    var old=previous.runners[i];float t=Mathf.Clamp01(age/frameInterval);
                    p=Vector3.Lerp(new Vector3(old.x,0,old.z),p,t);
                    heading=Mathf.LerpAngle(old.heading,heading,t);gait=Mathf.Lerp(old.gait,gait,t);
                }
                // Positions come only from the browser's revealed server plan.
                runners[i].Pose(p,heading,gait+(previous==null?(s.running?age*1.65f:age):0),s.running);
                bool visible=s.featured==0||s.featured==i+1;runners[i].gameObject.SetActive(visible);
                if(!visible)continue;center+=p;
                if(first){bounds=new Bounds(p+Vector3.up*1.5f,new Vector3(5,3.5f,5));first=false;}else bounds.Encapsulate(new Bounds(p+Vector3.up*1.5f,new Vector3(5,3.5f,5)));
            }
            center=bounds.center;
            string mode=s.winner>0?"winner":s.featured>0?"parade":s.camera;
            int focus=s.featured>0?s.featured-1:s.winner>0?s.winner-1:0;
            if(mode=="parade"||mode=="winner"||mode=="closeup")center=runners[focus].transform.position+Vector3.up*1.5f;
            Vector3 tangent=Quaternion.Euler(0,s.runners[focus].heading,0)*Vector3.forward;
            Vector3 outward=new Vector3(tangent.z,0,-tangent.x);
            float distance=mode=="grandstand"?66:mode=="rail"?24:mode=="closeup"?8.5f:mode=="parade"?8.3f:mode=="winner"?9:36;
            float height=mode=="grandstand"?36:mode=="broadcast"?11:mode=="rail"?3.2f:mode=="closeup"?1.8f:mode=="parade"?1.4f:mode=="winner"?2.8f:5.5f;
            cameraView.fieldOfView=mode=="parade"||mode=="winner"?37:mode=="closeup"?39:42;
            // A three-quarter tracking angle separates horses across the lanes.
            Vector3 offset=-outward*distance-tangent*(mode=="rail"||mode=="closeup"?distance*.55f:6)+Vector3.up*height;
            if(mode=="headon")offset=tangent*distance+Vector3.up*5;
            if(mode!="parade"&&mode!="winner"&&mode!="closeup")offset=FitField(center,offset,s);
            Vector3 desired=center+offset;
            string key=s.venue+mode+s.round;
            if(shot!=key){cameraView.transform.position=desired;shot=key;}
            else {cameraView.transform.position+=center-previousTarget;cameraView.transform.position=Vector3.Lerp(cameraView.transform.position,desired,1-Mathf.Exp(-Time.unscaledDeltaTime*8));}
            previousTarget=center;cameraView.transform.LookAt(center);
            if(depthOfField!=null)
            {
                float focusDistance=Vector3.Distance(cameraView.transform.position,center);
                depthOfField.gaussianStart.value=focusDistance+(mode=="parade"||mode=="winner"?5:Mathf.Max(20,bounds.extents.magnitude));
                depthOfField.gaussianEnd.value=depthOfField.gaussianStart.value+100;
            }
            world.DrawInstances(cameraView);dust.Tick(cameraView,s,Time.unscaledDeltaTime);
            AdaptResolution();
            world.Gates.gameObject.SetActive(s.featured==0&&s.elapsed<1.1f);
            for(int i=0;i<world.Doors.Count;i++)world.Doors[i].localRotation=Quaternion.Euler(0,(i%2==0?1:-1)*Mathf.Clamp01(s.elapsed*2)*100,0);
            if(lighting==s.venue)return;lighting=s.venue;
            bool night=s.venue=="night";sun.intensity=night?1.1f:2f;sun.color=night?new Color(.76f,.85f,1):new Color(1,.94f,.84f);fill.intensity=night?.5f:.65f;
            world.SetNight(night);
            // Runtime-built scenes have no baked sky probe. Supply ambient SH
            // explicitly so shadowed horses retain their coat/skin detail.
            RenderSettings.skybox.SetFloat("_Exposure",night?.08f:.85f);
            RenderSettings.skybox.SetColor("_Tint",night?new Color(.22f,.28f,.4f):new Color(.5f,.5f,.5f));
            RenderSettings.ambientSkyColor=night?new Color(.13f,.18f,.27f):new Color(.65f,.72f,.8f);
            RenderSettings.ambientEquatorColor=night?new Color(.12f,.16f,.21f):new Color(.49f,.53f,.48f);
            RenderSettings.fogColor=night?new Color(.13f,.18f,.26f):s.venue=="dubai"?new Color(.77f,.68f,.55f):new Color(.67f,.75f,.79f);
            RenderSettings.ambientMode=AmbientMode.Flat;RenderSettings.ambientLight=night?new Color(.18f,.23f,.3f):new Color(.32f,.36f,.4f);
            var probe=new SphericalHarmonicsL2();probe.AddAmbientLight(RenderSettings.ambientLight);RenderSettings.ambientProbe=probe;
        }
        void AdaptResolution()
        {
            performanceTime+=Time.unscaledDeltaTime;performanceFrames++;
            if(performanceTime<4)return;
            float fps=performanceFrames/performanceTime;performanceTime=performanceFrames=0;
            var pipeline=QualitySettings.renderPipeline as UniversalRenderPipelineAsset;
            if(!pipeline)return;
            slowWindows=fps<28?slowWindows+1:0;fastWindows=fps>52?fastWindows+1:0;
            if(slowWindows>=2){pipeline.renderScale=Mathf.Max(.7f,pipeline.renderScale-.1f);slowWindows=0;}
            if(fastWindows>=3){pipeline.renderScale=Mathf.Min(1,pipeline.renderScale+.1f);fastWindows=0;}
        }
        Vector3 FitField(Vector3 center,Vector3 offset,RaceFrame frame)
        {
            var forward=-offset.normalized;var right=Vector3.Cross(Vector3.up,forward).normalized;var up=Vector3.Cross(forward,right);
            float vertical=Mathf.Tan(cameraView.fieldOfView*.5f*Mathf.Deg2Rad)*.84f,horizontal=vertical*cameraView.aspect;
            float distance=offset.magnitude;
            foreach(var runner in frame.runners)
            {
                var delta=new Vector3(runner.x,1.3f,runner.z)-center;
                // A horse-size margin keeps tails, heads and helmets inside frame.
                float z=Vector3.Dot(delta,forward);
                distance=Mathf.Max(distance,(Mathf.Abs(Vector3.Dot(delta,right))+2.5f)/horizontal-z);
                distance=Mathf.Max(distance,(Mathf.Abs(Vector3.Dot(delta,up))+1.8f)/vertical-z);
            }
            return offset.normalized*distance;
        }
        void Demo()
        {
            float t=Mathf.Repeat(Time.time,40),elapsed=t-5;state=new RaceFrame{running=elapsed>=0,elapsed=elapsed,camera="broadcast",runners=new RunnerFrame[8]};
            for(int i=0;i<8;i++)
            {
                float p=elapsed<0?0:elapsed/(30+i*.23f);float radius=35+i*1.6f;
                var point=HorseWorld.Track(p,radius);var ahead=HorseWorld.Track(p+.0001f,radius);
                state.runners[i]=new RunnerFrame{id=i+1,x=point.x,z=point.z,heading=Quaternion.LookRotation(ahead-point).eulerAngles.y,gait=Time.time*1.65f+i*.18f};
            }
            received=Time.unscaledTime;
        }
    }
}
