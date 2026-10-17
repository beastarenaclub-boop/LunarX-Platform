using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

namespace ArenaSports
{
    public sealed class ArenaBridge : MonoBehaviour
    {
#if UNITY_WEBGL && !UNITY_EDITOR
        [DllImport("__Internal")] static extern void ArenaStatus(string json);
#endif
        ArenaState state=new();
        float receivedAt;
        ArenaGeometry geometry;
        readonly List<ArenaAthlete> athletes=new();
        readonly List<ArenaAthlete> officials=new();
        readonly List<CricketPlayerDetails> cricketDetails=new();
        readonly List<Transform> cars=new();
        Transform ball;
        Camera lens;
        Light sun,fill;
        string activeSport="",activeQuality="";
        Vector3 cameraVelocity,focusVelocity,focus;
        bool firstCamera=true;
        float performanceStarted;
        int performanceFrames;
        string kitSignature="";
        string activeVenue="",presentationStage="";
        float footballClock;
        int venueStyle;
        [Serializable] class Pointer {public float x;public float y;}
        public static readonly string[] Sports={"football","cricket","basketball","tennis","formula"};

        void Start()
        {
            gameObject.name="ArenaBridge";
#if UNITY_WEBGL && !UNITY_EDITOR
            WebGLInput.captureAllKeyboardInput=false;
#endif
            Application.targetFrameRate=60;
            QualitySettings.vSyncCount=0;
            lens=Camera.main;
            if(!lens) { var obj=new GameObject("Broadcast camera");obj.tag="MainCamera";lens=obj.AddComponent<Camera>(); }
            lens.nearClipPlane=.15f;lens.farClipPlane=500;
            lens.allowHDR=true;lens.usePhysicalProperties=true;lens.sensorSize=new(36,20.25f);
            var additional=lens.GetUniversalAdditionalCameraData();additional.renderPostProcessing=true;
            additional.antialiasing=AntialiasingMode.FastApproximateAntialiasing;
            var lightObject=new GameObject("Stadium key light");sun=lightObject.AddComponent<Light>();
            sun.type=LightType.Directional;sun.color=new Color(1,.98f,.94f);sun.intensity=1.65f;
            sun.shadows=LightShadows.Soft;sun.shadowBias=.012f;sun.shadowNormalBias=.045f;
            lightObject.transform.rotation=Quaternion.Euler(48,-32,0);
            RenderSettings.ambientMode=AmbientMode.Trilight;
            RenderSettings.ambientSkyColor=new(.38f,.46f,.57f);
            RenderSettings.ambientEquatorColor=new(.28f,.32f,.35f);
            RenderSettings.ambientGroundColor=new(.15f,.19f,.14f);
            // Runtime-generated venues do not have baked light probes. Assign
            // explicit diffuse ambient SH; WebGL cannot bake a new sky probe.
            var ambient=new SphericalHarmonicsL2();
            ambient.AddAmbientLight(new Color(.68f,.72f,.78f));
            RenderSettings.ambientProbe=ambient;
            var fillObject=new GameObject("Stadium fill light");fill=fillObject.AddComponent<Light>();
            fill.type=LightType.Directional;fill.color=new(.9f,.94f,1);fill.intensity=1.0f;fill.shadows=LightShadows.None;
            fillObject.transform.rotation=Quaternion.Euler(55,145,0);
            RenderSettings.fog=true;RenderSettings.fogMode=FogMode.Linear;
            RenderSettings.fogColor=new(.38f,.46f,.54f);RenderSettings.fogStartDistance=130;RenderSettings.fogEndDistance=450;
            lens.backgroundColor=RenderSettings.fogColor;lens.clearFlags=CameraClearFlags.Skybox;
            var profile=Resources.Load<VolumeProfile>("ArenaPost");
            if(profile) { var volume=new GameObject("Broadcast grading").AddComponent<Volume>();volume.isGlobal=true;volume.sharedProfile=profile; }
            SetState(JsonUtility.ToJson(state));
        }
        public void SetState(string json)
        {
            ArenaState next;
            try { next=JsonUtility.FromJson<ArenaState>(json); } catch { return; }
            if(next==null || Array.IndexOf(Sports,next.sport)<0 || !float.IsFinite(next.elapsed)) return;
            next.elapsed=Mathf.Clamp(next.elapsed,-20,45);next.duration=45;
            if(!float.IsFinite(next.zoom)||next.zoom<=0)next.zoom=1;
            next.zoom=Mathf.Clamp(next.zoom,.75f,1.6f);
            if(!float.IsFinite(next.orbit))next.orbit=35;
            state=next;receivedAt=Time.realtimeSinceStartup;
            if(!lens)return; // A queued browser message can precede Start().
            if(activeSport!=state.sport || state.sport=="football"&&activeVenue!=state.venue) Rebuild();
            if(activeQuality!=state.quality) SetQuality();
            string kits=string.Join(",",state.colors??Array.Empty<string>());
            if(kits!=kitSignature)
            {
                kitSignature=kits;
                for(int i=0;i<athletes.Count;i++)athletes[i].SetKit(activeSport=="football"&&i%11==0?new Color(.98f,.55f,.13f):TeamColor(athletes[i].Team));
                for(int i=0;i<cars.Count;i++)foreach(var r in cars[i].GetComponentsInChildren<MeshRenderer>())if(r.sharedMaterial.name.StartsWith("Car livery"))r.sharedMaterial.SetColor("_BaseColor",TeamColor(i));
            }
        }
        public void PickPlayer(string json)
        {
            if(!lens||athletes.Count==0)return;
            Pointer p;try{p=JsonUtility.FromJson<Pointer>(json);}catch{return;}
            if(p==null||!float.IsFinite(p.x)||!float.IsFinite(p.y))return;
            int selected=-1;float distance=.085f;
            for(int i=0;i<athletes.Count;i++)
            {
                var screen=lens.WorldToViewportPoint(athletes[i].transform.position+Vector3.up*.95f);
                float d=new Vector2((screen.x-p.x)*lens.aspect,screen.y-p.y).magnitude;
                if(screen.z>0&&d<distance){distance=d;selected=i;}
            }
            if(selected>=0)Report("{\"type\":\"arena-player-selected\",\"index\":"+selected+"}");
        }
        public void SetPaused(string paused)
        {
            bool hidden=paused=="true";Time.timeScale=hidden?0:1;
            performanceStarted=Time.realtimeSinceStartup;performanceFrames=0;
            if(lens)lens.enabled=!hidden;
            Application.targetFrameRate=hidden?4:activeQuality=="balanced"?30:-1;
        }
        void SetQuality()
        {
            activeQuality=state.quality;
            bool high=activeQuality=="high";
            QualitySettings.shadows=high ? UnityEngine.ShadowQuality.All:UnityEngine.ShadowQuality.HardOnly;
            var pipeline=GraphicsSettings.currentRenderPipeline as UniversalRenderPipelineAsset;
            if(pipeline)
            {
                pipeline.renderScale=1;pipeline.shadowDistance=high?100:65;
                pipeline.shadowCascadeCount=1;pipeline.mainLightShadowmapResolution=high?4096:2048;
                pipeline.msaaSampleCount=high?4:2;
            }
            if(lens){var data=lens.GetUniversalAdditionalCameraData();data.renderPostProcessing=activeQuality!="balanced";data.antialiasing=activeQuality=="balanced"?AntialiasingMode.None:AntialiasingMode.FastApproximateAntialiasing;}
            if(sun)sun.shadows=activeQuality=="balanced"?LightShadows.Hard:LightShadows.Soft;
            Application.targetFrameRate=activeQuality=="balanced"?30:-1;
        }
        Color TeamColor(int team)
        {
            if(state.colors!=null && state.colors.Length>team && ColorUtility.TryParseHtmlString(state.colors[team],out Color c))return c;
            return team==0 ? new(.55f,.85f,.22f):new(.35f,.4f,.85f);
        }
        ArenaAthlete Athlete(int team,int number,Vector3 position,bool cricket=false)
        {
            var go=new GameObject("Player "+number);go.transform.SetParent(geometry.Root,false);
            // Initialize at origin so skinned-mesh normalization is independent of field position.
            var a=go.AddComponent<ArenaAthlete>();
            Color color=TeamColor(team);
            if(state.sport=="football" && number%11==0)color=new(.98f,.55f,.13f);
            a.Initialize(cricket ? "CricketPlayer":"FootballPlayer",team,color,number);
            a.FootballMovement=state.sport=="football";
            go.transform.localPosition=position;a.Home=position;athletes.Add(a);return a;
        }
        void Rebuild()
        {
            if(geometry!=null) {geometry.Root.gameObject.SetActive(false);geometry.Dispose();}
            athletes.Clear();officials.Clear();cricketDetails.Clear();cars.Clear();ball=null;
            activeSport=state.sport;firstCamera=true;
            activeVenue=state.venue;presentationStage="";kitSignature="";
            geometry=new ArenaGeometry(new GameObject("Venue - "+activeSport).transform);
            if(activeSport=="football") BuildFootball();
            else if(activeSport=="cricket") BuildCricket();
            else if(activeSport=="basketball") BuildBasketball();
            else if(activeSport=="tennis") BuildTennis();
            else BuildFormula();
            geometry.Batch();
            ConfigureLighting();
            Report("{\"type\":\"arena-ready\",\"sport\":\""+activeSport+"\",\"athletes\":"+athletes.Count+",\"vehicles\":"+cars.Count+"}");
        }
        void BuildFootball()
        {
            venueStyle=state.venue=="Grand Stade"?2:state.venue=="Crown Stadium"?3:state.venue=="Estadio Arena"?1:0;
            geometry.Pitch();geometry.FootballStadium(venueStyle);
            for(int i=0;i<22;i++)Athlete(i/11,i,FootballMotion.Position(i,0,false));
            for(int i=0;i<3;i++)
            {
                var go=new GameObject(i==0?"Referee":"Assistant referee");go.transform.SetParent(geometry.Root,false);
                var official=go.AddComponent<ArenaAthlete>();official.Initialize("FootballPlayer",2,new(.96f,.20f,.42f),30+i);officials.Add(official);
                if(i>0)
                {
                    var flag=new GameObject("Assistant flag");
                    geometry.Rod(new(0,0,0),new(0,-.45f,0),.012f,geometry.Dark,flag.transform,false);
                    geometry.Box(new(.12f,-.31f,0),new(.24f,.25f,.015f),geometry.Accent,flag.transform,false);
                    official.Attach(flag,Vector3.zero,Vector3.zero);
                }
            }
            ball=geometry.Sphere(new(0,.112f,0),.112f,Resources.Load<Material>("FootballBall"),null,false).transform;
        }
        void ConfigureLighting()
        {
            RenderSettings.skybox=Resources.Load<Material>(activeSport=="cricket"?"CricketSky":"ArenaSky");
            // Preserve depth precision for thin pitch markings from the aerial camera.
            lens.nearClipPlane=activeSport=="cricket"?.35f:.15f;
            bool night=activeSport=="football";
            sun.intensity=night?1.75f:activeSport=="basketball"?1.2f:1.65f;
            sun.color=night?new(.9f,.94f,1):new(1,.98f,.94f);
            sun.transform.rotation=Quaternion.Euler(night?62:48,-32,0);
            fill.intensity=night?1.15f:1;fill.color=new(.9f,.94f,1);
            var ambient=new SphericalHarmonicsL2();ambient.AddAmbientLight(night?new(.50f,.54f,.62f):new(.68f,.72f,.78f));RenderSettings.ambientProbe=ambient;
            RenderSettings.fogColor=night?new(.045f,.065f,.10f):new(.38f,.46f,.54f);
            RenderSettings.fogStartDistance=night?105:130;RenderSettings.fogEndDistance=night?320:450;
            lens.backgroundColor=RenderSettings.fogColor;lens.clearFlags=night?CameraClearFlags.SolidColor:CameraClearFlags.Skybox;
            if(night&&venueStyle==1){lens.backgroundColor=new(.08f,.105f,.16f);sun.color=new(.98f,.95f,.88f);}
            if(activeSport=="cricket")
            {
                sun.intensity=2.05f;sun.color=new(1,.97f,.91f);sun.transform.rotation=Quaternion.Euler(43,-48,0);
                fill.intensity=.65f;fill.color=new(.84f,.90f,1);
                ambient=new SphericalHarmonicsL2();ambient.AddAmbientLight(new Color(.53f,.59f,.65f));RenderSettings.ambientProbe=ambient;
                RenderSettings.fogColor=new(.67f,.75f,.80f);RenderSettings.fogStartDistance=155;RenderSettings.fogEndDistance=460;
            }
            if(activeSport=="basketball")
            {
                lens.clearFlags=CameraClearFlags.SolidColor;lens.backgroundColor=new(.018f,.025f,.045f);
                sun.intensity=1.65f;sun.color=new(.94f,.97f,1);sun.transform.rotation=Quaternion.Euler(68,-25,0);
                fill.intensity=.65f;RenderSettings.fogColor=lens.backgroundColor;RenderSettings.fogStartDistance=45;RenderSettings.fogEndDistance=145;
                ambient=new SphericalHarmonicsL2();ambient.AddAmbientLight(new Color(.42f,.46f,.53f));RenderSettings.ambientProbe=ambient;
            }
        }
        void BuildCricket()
        {
            geometry.CricketGround();geometry.CricketStadium();
            for(int side=-1;side<=1;side+=2)
            {
                geometry.Line(new(side*8.84f,.032f,-1.83f),new(side*8.84f,.032f,1.83f),.055f);
                geometry.Line(new(side*10.06f,.032f,-1.32f),new(side*10.06f,.032f,1.32f),.055f);
                foreach(int edge in new[]{-1,1})geometry.Line(new(side*8.84f,.032f,edge*1.32f),new(side*11.2f,.032f,edge*1.32f),.055f);
                var stump=geometry.Material("Tournament blue stumps",new(.035f,.13f,.48f),.26f);
                for(int i=-1;i<=1;i++)geometry.Rod(new(side*10.06f,.02f,i*.11f),new(side*10.06f,.73f,i*.11f),.018f,stump);
                for(int i=0;i<2;i++)geometry.Rod(new(side*10.06f,.74f,-.13f+i*.13f),new(side*10.06f,.74f,i*.13f),.014f,geometry.White);
            }
            Athlete(0,0,new(8.9f,0,.5f),true);Athlete(0,1,new(-8.7f,0,1.4f),true);
            Athlete(1,2,new(-18,0,0),true);Athlete(1,3,new(14,0,0),true);
            for(int i=0;i<9;i++)
            {
                float a=i*Mathf.PI*2/9;Athlete(1,i+4,new(Mathf.Cos(a)*(i%2==0 ? 30:48),0,Mathf.Sin(a)*(i%2==0 ? 25:40)),true);
            }
            for(int i=0;i<athletes.Count;i++)
            {
                var details=athletes[i].gameObject.AddComponent<CricketPlayerDetails>();
                details.Initialize(geometry,i,TeamColor(athletes[i].Team));cricketDetails.Add(details);
            }
            var umpireObject=new GameObject("Bowler end umpire");umpireObject.transform.SetParent(geometry.Root,false);
            var umpire=umpireObject.AddComponent<ArenaAthlete>();umpire.Initialize("FootballPlayer",2,new(.85f,.035f,.055f),35);
            umpireObject.transform.position=new(-12.7f,0,-.9f);umpireObject.transform.rotation=Quaternion.LookRotation(Vector3.right);officials.Add(umpire);
            umpire.AttachHat(geometry.CricketUmpireHat(umpireObject.transform));
            ball=geometry.Sphere(new(-10,.5f,0),.038f,geometry.Material("White cricket leather",new(.97f,.98f,.94f),.38f),null,false).transform;
            var seam=geometry.Material("Cricket ball seam",new(.48f,.54f,.60f));
            // Sphere geometry uses unit local radius .5; seam follows its spin.
            for(int i=0;i<24;i++)
            {
                float a=i*Mathf.PI/12,b=a+.065f;
                geometry.Rod(new(.065f,Mathf.Cos(a)*.496f,Mathf.Sin(a)*.496f),new(.065f,Mathf.Cos(b)*.496f,Mathf.Sin(b)*.496f),.016f,seam,ball,false);
            }
            geometry.BatchEquipment(ball);
        }
        void BuildBasketball()
        {
            var wood=geometry.Material("Maple court",Color.white,.42f);
            wood.SetTexture("_BaseMap",Resources.Load<Texture2D>("MapleSurface"));
            wood.SetTextureScale("_BaseMap",new(4,3));
            geometry.Surface(40,26,wood);geometry.Stadium(27,21,true);
            geometry.Rectangle(-14,-7.5f,14,7.5f);geometry.Line(new(0,.02f,-7.5f),new(0,.02f,7.5f));
            geometry.Circle(new(0,.02f,0),1.8f,1.8f);
            geometry.BroadcastCourtDetails();
            for(int i=-1;i<=1;i+=2)
            {
                geometry.Rectangle(i*14,-2.45f,i*8.2f,2.45f);
                geometry.Rod(new(i*15.5f,0,0),new(i*15.5f,4.1f,0),.14f,geometry.Steel);
                geometry.Rod(new(i*15.5f,4.1f,0),new(i*12.7f,3.9f,0),.12f,geometry.Steel);
                geometry.Box(new(i*12.7f,3.65f,0),new(.08f,1.05f,1.8f),geometry.White);
                geometry.Circle(new(i*12.25f,3.05f,0),.23f,.23f,.04f,geometry.Material("Orange hoop",new(.95f,.2f,.02f)),32);
                for(int j=0;j<12;j++)
                {
                    float a=j*Mathf.PI/6;
                    geometry.Rod(new(i*12.25f+Mathf.Cos(a)*.23f,3.05f,Mathf.Sin(a)*.23f),new(i*12.25f+Mathf.Cos(a)*.13f,2.65f,Mathf.Sin(a)*.13f),.008f,geometry.White);
                }
            }
            for(int i=0;i<10;i++)Athlete(i/5,i,new((i<5?-1:1)*(3+(i%5)*1.3f),0,(i%5-2)*2.5f));
            ball=geometry.Sphere(new(0,.13f,0),.12f,geometry.Material("Basketball leather",new(.7f,.21f,.035f),.15f),null,false).transform;
        }
        void BuildTennis()
        {
            var outer=geometry.Material("Court apron",new(.035f,.23f,.21f));
            var court=geometry.Material("Tournament hardcourt",new(.025f,.15f,.34f));
            geometry.Surface(40,28,outer);geometry.Surface(23.77f,10.97f,court,0);
            geometry.Stadium(29,21);geometry.Rectangle(-11.885f,-5.485f,11.885f,5.485f);
            geometry.TennisVenueDetails();
            geometry.Rectangle(-11.885f,-4.115f,11.885f,4.115f);geometry.Rectangle(-6.4f,-4.115f,6.4f,4.115f);
            geometry.Line(new(-6.4f,.02f,0),new(6.4f,.02f,0));
            foreach(int side in new[]{-1,1})geometry.Rod(new(0,0,side*6),new(0,1.07f,side*6),.04f,geometry.Steel);
            for(float z=-6;z<=6;z+=.15f)geometry.Rod(new(0,.12f,z),new(0,1.02f,z),.006f,geometry.Dark);
            for(float y=.15f;y<1;y+=.15f)geometry.Rod(new(0,y,-6),new(0,y,6),.006f,geometry.Dark);
            geometry.Rod(new(0,1.02f,-6),new(0,1.02f,6),.025f,geometry.White);
            for(int i=0;i<2;i++)
            {
                var a=Athlete(i,i,new(i==0?-12.7f:12.7f,0,0));
                var racket=new GameObject("Racket");
                geometry.Rod(Vector3.zero,new(0,-.3f,0),.018f,geometry.Dark,racket.transform,false);
                for(int j=0;j<32;j++)
                {
                    float angle=j*Mathf.PI/16,next=(j+1)*Mathf.PI/16;
                    geometry.Rod(new(Mathf.Cos(angle)*.14f,-.48f+Mathf.Sin(angle)*.19f,0),new(Mathf.Cos(next)*.14f,-.48f+Mathf.Sin(next)*.19f,0),.012f,geometry.Accent,racket.transform,false);
                }
                for(float x=-.09f;x<=.1f;x+=.03f)geometry.Rod(new(x,-.62f,0),new(x,-.34f,0),.002f,geometry.White,racket.transform,false);
                a.Attach(racket,new(0,-.07f,0),Vector3.zero);
            }
            ball=geometry.Sphere(new(0,1.2f,0),.034f,geometry.Material("Tennis felt",new(.72f,.92f,.05f)),null,false).transform;
        }
        Vector3 Track(float a,float lane=0)=>new(Mathf.Cos(a)*(53+lane),.13f,Mathf.Sin(a)*(30+lane));
        void BuildFormula()
        {
            geometry.Surface(200,140,geometry.Grass);geometry.Stadium(78,53,false,false);
            var road=geometry.Material("Race asphalt",new(.075f,.083f,.09f));
            var curb=geometry.Material("Red kerb",new(.73f,.07f,.05f));
            geometry.RaceSurface(road,curb);
            geometry.RaceVenueDetails();
            for(int i=0;i<4;i++)
            {
                var root=new GameObject("Formula car "+i).transform;root.SetParent(geometry.Root,false);cars.Add(root);
                var paint=geometry.Material("Car livery "+i,TeamColor(i),.42f,.2f);
                geometry.Box(new(0,.35f,0),new(1.2f,.28f,3.5f),paint,root,false);
                var nose=geometry.Box(new(0,.28f,1.8f),new(.4f,.22f,1.2f),paint,root,false);nose.transform.localRotation=Quaternion.Euler(4,0,0);
                geometry.Box(new(0,.24f,2.22f),new(1.9f,.09f,.5f),geometry.Dark,root,false);
                geometry.Box(new(0,.85f,-1.65f),new(1.8f,.1f,.5f),paint,root,false);
                foreach(int side in new[]{-1,1})
                {
                    geometry.Box(new(side*.8f,.52f,-1.65f),new(.05f,.65f,.3f),geometry.Dark,root,false);
                    for(int axle=-1;axle<=1;axle+=2)
                    {
                        var tire=geometry.Primitive(PrimitiveType.Cylinder,new(side*.94f,.35f,axle*1.25f),new(.7f,.19f,.7f),geometry.Dark,root,false);
                        tire.transform.localRotation=Quaternion.Euler(0,0,90);
                        geometry.Rod(new(side*.35f,.3f,axle*.7f),new(side*.93f,.35f,axle*1.25f),.035f,geometry.Steel,root,false);
                    }
                }
                geometry.Sphere(new(0,.66f,-.25f),.23f,geometry.Dark,root,false);
                geometry.Sphere(new(0,.79f,-.2f),.17f,paint,root,false);
                geometry.Rod(new(-.27f,.7f,.25f),new(0,.9f,-.5f),.025f,geometry.Dark,root,false);
                geometry.Rod(new(.27f,.7f,.25f),new(0,.9f,-.5f),.025f,geometry.Dark,root,false);
                geometry.FormulaCarDetails(root,paint);
                geometry.BatchEquipment(root);
            }
        }
        void Update()
        {
            if(geometry==null || !lens || Time.timeScale==0)return;
            performanceFrames++;
            float span=Time.realtimeSinceStartup-performanceStarted;
            if(span>=2)
            {
                Report("{\"type\":\"arena-performance\",\"fps\":"+Mathf.RoundToInt(performanceFrames/span)+"}");
                performanceStarted=Time.realtimeSinceStartup;performanceFrames=0;
            }
            float dt=Mathf.Min(Time.deltaTime,.05f);
            bool live=state.phase=="live";
            float t=Mathf.Clamp(state.elapsed+(live ? Time.realtimeSinceStartup-receivedAt:0),0,state.duration);
            Vector3 target=Vector3.zero;
            if(activeSport=="football")target=UpdateFootball(t,live,dt);
            else if(activeSport=="cricket")target=UpdateCricket(t,live,dt);
            else if(activeSport=="basketball")target=UpdateBasketball(t,live,dt);
            else if(activeSport=="tennis")target=UpdateTennis(t,live,dt);
            else target=UpdateFormula(t,live,dt);
            UpdateCamera(target,t,dt);
            for(int i=0;i<athletes.Count;i++)athletes[i].Animate(Time.deltaTime,Vector3.Distance(lens.transform.position,athletes[i].transform.position),state.camera=="player"&&i==state.followPlayer);
            foreach(var official in officials)official.Animate(Time.deltaTime,Vector3.Distance(lens.transform.position,official.transform.position),false);
        }
        void Move(ArenaAthlete a,Vector3 p,Vector3 facing,float dt,bool kick=false,bool celebrate=false,bool walkout=false,float strike=-1,float motionSpeed=-1)
        {
            Vector3 delta=p-a.transform.localPosition;
            float speed=dt>0 ? delta.magnitude/dt:0;
            a.transform.localPosition=p;
            if(facing.sqrMagnitude>.001f)a.transform.rotation=Quaternion.Slerp(a.transform.rotation,Quaternion.LookRotation(facing.normalized),dt*8);
            a.Motion(motionSpeed>=0?motionSpeed:speed,kick,celebrate,dt,walkout,strike);
        }
        Vector3 UpdateFootball(float t,bool live,float dt)
        {
            bool preMatch=state.phase=="betting";
            footballClock=Mathf.Clamp(state.elapsed+(state.phase!="result"?Time.realtimeSinceStartup-receivedAt:0),-20,45);
            string stage=FootballPresentation.Stage(footballClock,state.phase);
            bool finished=state.phase=="result";
            Vector3 p=FootballMotion.Ball(t,live||finished,out int carrier,out int receiver,out bool kick);
            ArenaEvent goal=null;
            if(live&&state.events!=null)foreach(var e in state.events)if(e.kind=="goal" && t-e.at/1000>=0 && t-e.at/1000<3.5f)goal=e;
            if(goal!=null){p=FootballMotion.Goal(goal.team,t-goal.at/1000);stage="goal-replay";}
            if(stage!=presentationStage)
            {
                presentationStage=stage;
                Report("{\"type\":\"arena-presentation\",\"stage\":\""+stage+"\",\"venue\":\""+activeVenue+"\",\"officials\":"+officials.Count+"}");
            }
            for(int i=0;i<athletes.Count;i++)
            {
                var a=athletes[i];Vector3 next=preMatch?FootballPresentation.Entrance(i,footballClock):FootballMotion.Position(i,t,live||finished);
                Vector3 delta=preMatch?FootballPresentation.Entrance(i,footballClock+.05f)-next:FootballMotion.Position(i,t+.05f,live||finished)-next;
                float speed=delta.magnitude/.05f;
                if(!preMatch&&!finished)delta=FootballMotion.Facing(i,t);
                if(delta.sqrMagnitude<.0001f)delta=preMatch&&footballClock<-8?Vector3.forward:p-next;
                Move(a,next,delta,dt,false,goal!=null && i/11==goal.team && i%11>7,preMatch&&footballClock<-8,live&&goal==null?FootballMotion.StrikeTime(t,i):-1,finished?0:speed);
                a.LookAtBall(preMatch?next+Vector3.forward*8:p);
            }
            for(int i=0;i<officials.Count;i++)
            {
                Vector3 next=FootballPresentation.Official(i,preMatch?footballClock:t,preMatch);
                Vector3 ahead=FootballPresentation.Official(i,(preMatch?footballClock:t)+.05f,preMatch)-next;
                Move(officials[i],next,ahead.sqrMagnitude>.0001f?ahead:preMatch?Vector3.forward:p-next,dt,false,false,preMatch&&footballClock<-8);
            }
            Vector3 travel=p-ball.position;travel.y=0;
            if(live&&travel.sqrMagnitude>.000001f&&travel.sqrMagnitude<16)
                ball.Rotate(Vector3.Cross(Vector3.up,travel).normalized,travel.magnitude/.112f*Mathf.Rad2Deg,Space.World);
            ball.position=p;return p;
        }
        Vector3 UpdateCricket(float t,bool live,float dt)
        {
            // The server publishes twelve deliveries across 43 seconds.
            // Swap batting and fielding kits at the innings break as well.
            const float ballSeconds=43f/12f;
            float cycle=live?t%ballSeconds:0;
            int delivery=Mathf.FloorToInt(t/ballSeconds);
            int batting=state.events!=null&&state.events.Length>=6?1:0;
            float flight=Mathf.Clamp01((cycle-1.05f)/.85f);
            Vector3 p=new(Mathf.Lerp(-9.5f,9.1f,flight),Mathf.Lerp(1.9f,.6f,flight)-Mathf.Sin(flight*Mathf.PI)*1.1f,0);
            if(cycle>1.9f)
            {
                float u=(cycle-1.9f)/1.85f;float angle=delivery*2.4f;
                p=new(9.1f+Mathf.Cos(angle)*u*38,.6f+Mathf.Sin(u*Mathf.PI)*8,Mathf.Sin(angle)*u*32);
            }
            if(!live)p=new(-17,1.3f,0);
            for(int i=0;i<athletes.Count;i++)
            {
                var a=athletes[i];Vector3 pos=a.Home;
                int team=i<2?batting:1-batting;
                if(a.Team!=team){a.Team=team;a.SetKit(TeamColor(team));}
                if(i==2 && live)pos.x=-18+Mathf.Clamp01(cycle/1.15f)*8;
                else if(i>=4 && live)pos+=new Vector3(Mathf.Sin(t*.8f+i)*1.5f,0,Mathf.Cos(t*.6f+i)*1.5f);
                Vector3 facing=i<2?new Vector3(-.2f,0,-1):i==2?Vector3.right:p-pos;facing.y=0;
                Move(a,pos,facing,dt);
                cricketDetails[i].SetDelivery(cycle,live);
            }
            ball.position=p;if(live)ball.Rotate(0,0,dt*650,Space.Self);return p;
        }
        Vector3 UpdateBasketball(float t,bool live,float dt)
        {
            float cycle=t%4;int carrier=Mathf.FloorToInt(t/4)%10;
            for(int i=0;i<athletes.Count;i++)
            {
                var a=athletes[i];Vector3 p=a.Home;
                if(live)p+=new Vector3(Mathf.Sin(t*.65f+i)*2.2f,0,Mathf.Sin(t*.8f+i*2)*.8f);
                Move(a,p,new((i<5?1:-1),0,Mathf.Sin(t)),dt);
            }
            Vector3 start=athletes[carrier].transform.position+new Vector3(.45f,1,0);
            Vector3 hoop=new(carrier<5 ? 12.25f:-12.25f,3.05f,0);
            if(live&&cycle>2.6f)
            {
                float u=(cycle-2.6f)/1.4f;ball.position=Vector3.Lerp(start,hoop,u)+Vector3.up*Mathf.Sin(u*Mathf.PI)*3.3f;
            }
            else ball.position=start+Vector3.up*(live ? -Mathf.Abs(Mathf.Sin(t*9))*.8f:0);
            return ball.position;
        }
        Vector3 UpdateTennis(float t,bool live,float dt)
        {
            float f=live?Mathf.PingPong(t/1.35f,1):0;
            Vector3 p=new(Mathf.Lerp(-12.2f,12.2f,f),.2f+Mathf.Sin(f*Mathf.PI)*2.2f,Mathf.Sin(t*.72f)*2.8f);
            for(int i=0;i<2;i++)
            {
                var a=athletes[i];Vector3 pos=a.Home;pos.z=live?Mathf.Sin((t+(i==0?.3f:-.3f))*.72f)*2.8f:0;
                Move(a,pos,p-pos,dt,live&&(i==0?f<.1f:f>.9f));
            }
            ball.position=p;return p;
        }
        Vector3 UpdateFormula(float t,bool live,float dt)
        {
            for(int i=0;i<cars.Count;i++)
            {
                int place=i;if(state.order!=null&&state.order.Length==4)place=Array.IndexOf(state.order,i);
                float a=(live?t/45*Mathf.PI*6:0)-place*.09f;
                float lane=(i-1.5f)*1.3f;
                cars[i].position=Track(a,lane);
                cars[i].rotation=Quaternion.LookRotation(Track(a+.01f,lane)-Track(a,lane));
            }
            return cars[0].position;
        }
        void UpdateCamera(Vector3 target,float t,float dt)
        {
            bool small=activeSport=="tennis"||activeSport=="basketball";
            float scale=small?.45f:1;
            Vector3 desiredFocus=target+Vector3.up*.7f;
            Vector3 position;float focal;
            if(activeSport=="football" && state.phase=="betting" && (state.camera=="broadcast"||state.camera=="cinematic"))
            {
                float age=footballClock+20;
                if(age<9.5f)
                {
                    Vector3 lead=athletes[9].transform.position;
                    desiredFocus=new(0,1.15f,lead.z-1.5f);position=new(6.8f,2.1f,lead.z+8);focal=28;
                }
                else if(age<12){desiredFocus=new(0,1.1f,-29.7f);position=new(0,2.4f,-8);focal=24;}
                else {desiredFocus=new(0,.9f,-8);position=new(20,19,39);focal=30;}
            }
            else if(state.camera=="player")
            {
                float angle=state.orbit*Mathf.Deg2Rad;
                if(athletes.Count>0)desiredFocus=athletes[Mathf.Clamp(state.followPlayer,0,athletes.Count-1)].transform.position+Vector3.up*1.02f;
                else if(cars.Count>0)desiredFocus=cars[Mathf.Clamp(state.followPlayer,0,cars.Count-1)].position+Vector3.up*.65f;
                position=desiredFocus+new Vector3(Mathf.Cos(angle)*5, .65f,Mathf.Sin(angle)*5);focal=42;
            }
            else if(state.camera=="stadium")
            {
                float a=(state.orbit+t*.12f)*Mathf.Deg2Rad;float venueScale=small?.68f:1;
                desiredFocus=new(0,5,0);position=new(Mathf.Cos(a)*185*venueScale,105*venueScale,Mathf.Sin(a)*175*venueScale);focal=25;
            }
            else if(state.camera=="sideline")
            {
                desiredFocus=target+Vector3.up*.9f;position=new(target.x*.8f,4,small?16:36);focal=28;
                if(activeSport=="cricket"){desiredFocus=new(7.5f,1,0);position=new(0,1.65f,-16);focal=42;}
            }
            else if(state.camera=="overhead") {desiredFocus=Vector3.zero;position=new(0,small?42:112,.1f);focal=32;}
            else if(state.camera=="cinematic")
            {
                if(athletes.Count>0)
                {
                    ArenaAthlete nearest=athletes[0];float distance=float.MaxValue;
                    foreach(var athlete in athletes)
                    {
                        float d=(athlete.transform.position-target).sqrMagnitude;
                        if(d<distance) {distance=d;nearest=athlete;}
                    }
                    desiredFocus=nearest.transform.position+Vector3.up*1.05f;
                }
                Vector3 side=activeSport=="football"?new(5.5f,1.1f,7.5f):new(8,3.8f,12);
                if(activeSport=="cricket") {desiredFocus=new(8.9f,1.02f,.35f);side=new(-4.2f,.45f,-6.5f);}
                if(activeSport=="formula")side=new(12,4,14);
                position=desiredFocus+side;focal=44;
            }
            else
            {
                position=new(target.x*.68f,18*scale,target.z*.18f+40*scale);focal=32;
                if(activeSport=="cricket") {position=new(-50,10.5f,.7f);desiredFocus=new(0,.8f,0);focal=160;}
                if(activeSport=="tennis") {position=new(-28,17,0);desiredFocus=new(0,.7f,0);focal=22;}
                if(activeSport=="basketball") {position=new(target.x*.25f,11,26);desiredFocus=new(target.x*.2f,.8f,0);focal=28;}
                if(activeSport=="formula")
                {
                    desiredFocus=Vector3.zero;foreach(var car in cars)desiredFocus+=car.position;
                    desiredFocus/=Mathf.Max(1,cars.Count);desiredFocus.y=.7f;
                    position=desiredFocus+new Vector3(18,18,26);focal=28;
                }
            }
            if(firstCamera) {lens.transform.position=position;focus=desiredFocus;firstCamera=false;}
            else
            {
                lens.transform.position=Vector3.SmoothDamp(lens.transform.position,position,ref cameraVelocity,state.camera=="player"?.16f:.5f,150,dt);
                focus=Vector3.SmoothDamp(focus,desiredFocus,ref focusVelocity,.3f,130,dt);
            }
            lens.focalLength=Mathf.Lerp(lens.focalLength,focal*state.zoom,dt*5);
            lens.transform.LookAt(focus);
        }
        static void Report(string json)
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            ArenaStatus(json);
#else
            Debug.Log(json);
#endif
        }
        void OnDestroy() {geometry?.Dispose();}
    }
}
