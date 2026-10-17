using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Animations;
using UnityEngine.Playables;
using UnityEngine.Rendering;

namespace ArenaSports
{
    public sealed class ArenaAthlete : MonoBehaviour
    {
        PlayableGraph graph;
        AnimationMixerPlayable mixer;
        AnimationClipPlayable[] clips;
        readonly Dictionary<string,int> actions=new();
        readonly List<Material> ownedMaterials=new();
        Transform visual,rightHand,leftFoot,rightFoot,head,chest;
        FootballFootPlant leftPlant,rightPlant;
        public bool FootballMovement;
        Vector3 lookTarget;
        float strikeTime=-1;
        Transform shirtNumber,shirtCrest;
        Mesh numberMesh,crestMesh;
        Vector3 headScale;
        Material uniform;
        bool cricketWhites;
        public Transform LeftArm,RightArm;
        public int Team;
        public Vector3 Home;
        int previousAction=-1,walk=-1,jog=-1,sprint=-1;
        float animationDebt,grounding,bodyHeight;
        GameObject heldEquipment;
        Transform headwear;
        Vector3 equipmentOffset;
        Quaternion equipmentRotation;
        public void Initialize(string model,int team,Color color,int number)
        {
            Team=team;
            cricketWhites=model=="CricketPlayer";
            var prefab=Resources.Load<GameObject>("Sports/"+model);
            if(!prefab)throw new InvalidOperationException("Missing Unity athlete: "+model);
            visual=Instantiate(prefab,transform).transform;visual.name="Detailed human";
            var renderers=visual.GetComponentsInChildren<SkinnedMeshRenderer>();
            // Importer animation bounds include raised arms and follow-through.
            // Use bind-pose mesh bounds so adding a clip cannot shrink players.
            Bounds bounds=new(renderers[0].transform.TransformPoint(renderers[0].sharedMesh.bounds.center),Vector3.zero);
            foreach(var r in renderers)
            {
                var b=r.sharedMesh.bounds;
                for(int corner=0;corner<8;corner++)bounds.Encapsulate(r.transform.TransformPoint(b.center+Vector3.Scale(b.extents,new Vector3((corner&1)==0?-1:1,(corner&2)==0?-1:1,(corner&4)==0?-1:1))));
            }
            bodyHeight=1.78f+(number%7)*.018f;
            visual.localScale*=bodyHeight/bounds.size.y;
            // Animated bounds contain the stride. Moving by their minimum made
            // the old characters float. The authored rest soles are at zero.
            visual.localPosition=Vector3.zero;
            Material[] materials=null;
            var lods=new Renderer[3][];
            foreach(var r in renderers)
            {
                r.updateWhenOffscreen=false;r.receiveShadows=true;
                r.shadowCastingMode=ShadowCastingMode.On;r.skinnedMotionVectors=false;
                int level=r.name.Contains("LOD2")?2:r.name.Contains("LOD1")?1:0;
                r.quality=level==2?SkinQuality.Bone2:SkinQuality.Bone4;
                if(materials==null)
                {
                    materials=new Material[r.sharedMaterials.Length];
                    Color[] tones={new(1,.94f,.87f),new(.82f,.66f,.53f),new(.58f,.40f,.29f),new(.94f,.78f,.64f),new(.72f,.51f,.37f)};
                    for(int i=0;i<materials.Length;i++)
                    {
                        var m=materials[i]=new Material(r.sharedMaterials[i]);ownedMaterials.Add(m);
                        if(m.name.Contains("HumanSkin")||m.name.Contains("FootballFace"))
                        {
                            Color tint=tones[(number*3+team)%tones.Length];
                            if(model=="FootballPlayer")
                            {
                                tint=Color.Lerp(Color.white,tint,.65f);
                                tint*=m.name.Contains("FootballFace")?new Color(1.52f,1.46f,1.39f):new Color(.88f,.98f,1.06f);
                            }
                            m.SetColor("_BaseColor",tint);
                        }
                        if(m.name.Contains("HumanUniform")||m.name.Contains("FootballUniform")){uniform=m;m.SetColor("_BaseColor",color);}
                    }
                }
                r.sharedMaterials=materials;lods[level]=new Renderer[]{r};
            }
            foreach(var t in visual.GetComponentsInChildren<Transform>())
            {
                if(t.name=="Hand.R")rightHand=t;
                if(t.name=="Arm.L")LeftArm=t;
                if(t.name=="Arm.R")RightArm=t;
                if(t.name=="Foot.L")leftFoot=t;
                if(t.name=="Foot.R")rightFoot=t;
                if(t.name=="Head")head=t;
                if(t.name=="Chest")chest=t;
            }
            if(head)headScale=Vector3.Scale(head.localScale,new Vector3(.96f+(number%3)*.035f,1,.97f+(number%4)*.02f));
            Transform FindBone(string name)=>Array.Find(visual.GetComponentsInChildren<Transform>(),t=>t.name==name);
            leftPlant=new(FindBone("Thigh.L"),FindBone("Shin.L"),leftFoot,transform);
            rightPlant=new(FindBone("Thigh.R"),FindBone("Shin.R"),rightFoot,transform);
            var group=visual.GetComponent<LODGroup>();
            foreach(var importedGroup in visual.GetComponentsInChildren<LODGroup>())if(importedGroup!=group)importedGroup.enabled=false;
            if(!group)group=visual.gameObject.AddComponent<LODGroup>();group.enabled=true;
            group.fadeMode=LODFadeMode.None;
            group.SetLODs(new[]{new LOD(.20f,lods[0]),new LOD(.065f,lods[1]),new LOD(.003f,lods[2])});group.RecalculateBounds();
            var animator=visual.GetComponentInChildren<Animator>();if(!animator)animator=visual.gameObject.AddComponent<Animator>();
            animator.applyRootMotion=false;animator.cullingMode=AnimatorCullingMode.AlwaysAnimate;
            var usable=Array.FindAll(Resources.LoadAll<AnimationClip>("Sports/"+model),c=>!c.name.StartsWith("__preview__"));
            if(usable.Length==0)throw new InvalidOperationException("No human animation clips: "+model);
            graph=PlayableGraph.Create("Athlete "+number);graph.SetTimeUpdateMode(DirectorUpdateMode.Manual);
            mixer=AnimationMixerPlayable.Create(graph,usable.Length);
            var output=AnimationPlayableOutput.Create(graph,"Motion",animator);output.SetSourcePlayable(mixer);
            clips=new AnimationClipPlayable[usable.Length];
            for(int i=0;i<usable.Length;i++)
            {
                string name=usable[i].name;name=name.Substring(name.LastIndexOf('|')+1);actions[name]=i;
                clips[i]=AnimationClipPlayable.Create(graph,usable[i]);clips[i].SetApplyFootIK(false);
                clips[i].SetTime((number*.37)%Math.Max(.01,usable[i].length));clips[i].Pause();graph.Connect(clips[i],0,mixer,i);
            }
            walk=Action("Walk");jog=Action("Jog");sprint=Action("Sprint");graph.Play();Motion(0,false,false,0);graph.Evaluate(0);
            if(team<2)CreateShirtNumber(number%11+1);
        }
        void CreateShirtNumber(int number)
        {
            var go=new GameObject("Shirt number "+number);go.transform.SetParent(transform,false);shirtNumber=go.transform;
            float u=(number%4)*.25f,v=(number/4)*.25f;
            numberMesh=new Mesh { name="Jersey number",vertices=new[]{new Vector3(-.16f,-.19f,0),new Vector3(.16f,-.19f,0),new Vector3(.16f,.19f,0),new Vector3(-.16f,.19f,0)},uv=new[]{new Vector2(u,v),new Vector2(u+.25f,v),new Vector2(u+.25f,v+.25f),new Vector2(u,v+.25f)},triangles=new[]{0,2,1,0,3,2}};
            numberMesh.RecalculateNormals();numberMesh.RecalculateBounds();go.AddComponent<MeshFilter>().sharedMesh=numberMesh;
            var renderer=go.AddComponent<MeshRenderer>();renderer.sharedMaterial=Resources.Load<Material>("KitNumbers");renderer.shadowCastingMode=ShadowCastingMode.Off;
            var crest=new GameObject("Club crest");crest.transform.SetParent(transform,false);shirtCrest=crest.transform;
            crestMesh=new Mesh{name="Embroidered club shield",vertices=new[]{new Vector3(-.035f,-.045f,0),new Vector3(.035f,-.045f,0),new Vector3(.035f,.045f,0),new Vector3(-.035f,.045f,0)},uv=new[]{new Vector2(0,0),new Vector2(.25f,0),new Vector2(.25f,.25f),new Vector2(0,.25f)},triangles=new[]{0,2,1,0,3,2}};
            crestMesh.RecalculateNormals();crestMesh.RecalculateBounds();crest.AddComponent<MeshFilter>().sharedMesh=crestMesh;
            crest.AddComponent<MeshRenderer>().sharedMaterial=renderer.sharedMaterial;
        }
        int Action(string name)=>actions.TryGetValue(name,out int index)?index:name=="Kick"&&actions.TryGetValue("Pass",out int pass)?pass:0;
        public void LookAtBall(Vector3 target){lookTarget=target;}
        public void AttachHat(Transform hat){headwear=hat;}
        public void Attach(GameObject equipment,Vector3 position,Vector3 euler)
        {
            // Equipment stays in metres rather than inheriting FBX bone scale.
            heldEquipment=equipment;equipment.transform.SetParent(transform,false);
            equipmentOffset=new(0,-.025f,.015f);equipmentRotation=Quaternion.Euler(euler);
        }
        public void SetKit(Color color)
        {
            if(uniform)uniform.SetColor("_BaseColor",color);
            if(cricketWhites)GetComponent<CricketPlayerDetails>()?.SetTeamColor(color);
        }
        public void Motion(float speed,bool kick,bool celebrate,float dt,bool walkout=false,float footballStrike=-1)
        {
            strikeTime=footballStrike;
            int active=footballStrike>=0?Action("Pass"):celebrate?Action("Celebrate"):kick?Action("Kick"):walkout?(speed>.15f?walk:Action("Idle")):speed>4.1f?sprint:speed>1.9f?jog:speed>.15f?walk:Action("Idle");
            if(active!=previousAction){if(kick||celebrate)clips[active].SetTime(0);clips[active].Play();previousAction=active;}
            for(int i=0;i<clips.Length;i++)
            {
                float weight=Mathf.MoveTowards(mixer.GetInputWeight(i),i==active?1:0,dt<=0?1:dt*8);
                mixer.SetInputWeight(i,weight);if(weight<=0&&i!=active)clips[i].Pause();
            }
            if(active==walk)clips[active].SetSpeed(Mathf.Clamp(speed/1.4f,.65f,walkout?2.1f:1.5f));
            else if(active==jog)clips[active].SetSpeed(Mathf.Clamp(speed/3,.7f,1.45f));
            else if(active==sprint)clips[active].SetSpeed(Mathf.Clamp(speed/5.5f,.7f,1.35f));
            if(footballStrike>=0){clips[active].SetTime(footballStrike);clips[active].Pause();}
        }
        public void Animate(float dt,float distance,bool selected)
        {
            animationDebt+=dt;
            float interval=selected||distance<18?0:distance<45?1f/30:1f/20;
            if(animationDebt<interval)return;
            float evaluated=animationDebt;graph.Evaluate(animationDebt);animationDebt=0;
            if(head)head.localScale=headScale;
            if(leftFoot&&rightFoot)
            {
                float min=Mathf.Min(leftFoot.position.y,rightFoot.position.y);
                float correction=transform.position.y+.105f*(bodyHeight/1.84f)-min;
                grounding=Mathf.Clamp(grounding+correction,-.35f,.35f);
                visual.localPosition=new(0,grounding,0);
                if(FootballMovement)
                {
                    float floor=transform.position.y+.105f*(bodyHeight/1.84f);
                    leftPlant.Apply(evaluated,floor,strikeTime>=0||leftFoot.position.y<=rightFoot.position.y+.025f);
                    rightPlant.Apply(evaluated,floor,strikeTime<0&&rightFoot.position.y<=leftFoot.position.y+.025f);
                }
            }
            if(FootballMovement&&head)
            {
                Vector3 local=transform.InverseTransformDirection(lookTarget-head.position);
                float yaw=Mathf.Clamp(Mathf.Atan2(local.x,local.z)*Mathf.Rad2Deg,-32,32);
                head.rotation=Quaternion.AngleAxis(yaw*.38f,Vector3.up)*head.rotation;
            }
        }
        void LateUpdate()
        {
            if(headwear&&head){headwear.position=head.position+transform.up*.18f;headwear.rotation=transform.rotation;}
            if(shirtNumber&&chest)
            {
                // Follow the torso's bend as well as the player's root heading.
                Vector3 up=(head?head.position-chest.position:transform.up).normalized;
                Vector3 right=Vector3.Cross(up,transform.forward).normalized;
                Vector3 forward=Vector3.Cross(right,up).normalized;
                shirtNumber.position=chest.position+up*.035f-forward*.18f;
                shirtNumber.rotation=Quaternion.LookRotation(forward,up);
                if(shirtCrest)
                {
                    shirtCrest.gameObject.SetActive(FootballMovement);
                    shirtCrest.position=chest.position+up*.10f+forward*.15f-right*.085f;
                    shirtCrest.rotation=Quaternion.LookRotation(-forward,up);
                }
            }
            if(heldEquipment&&rightHand)
            {
                heldEquipment.transform.position=rightHand.position+transform.TransformDirection(equipmentOffset);
                heldEquipment.transform.rotation=transform.rotation*equipmentRotation;
            }
        }
        void OnDestroy(){if(graph.IsValid())graph.Destroy();foreach(var m in ownedMaterials)if(m)Destroy(m);if(numberMesh)Destroy(numberMesh);if(crestMesh)Destroy(crestMesh);}
    }
}

