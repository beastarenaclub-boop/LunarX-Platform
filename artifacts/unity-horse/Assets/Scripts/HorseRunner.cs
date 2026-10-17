using System;
using System.Linq;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Animations;
using UnityEngine.Playables;

namespace HorseRacing
{
    public sealed class HorseRunner : MonoBehaviour
    {
        public int Id;
        Transform rider, visual, mounted, saddleBone;
        Vector3 saddleRest;
        Quaternion saddleRotation;
        static readonly Vector3 EquipmentOffset=new Vector3(0,-.04f,-.12f);
        PlayableGraph graph;
        AnimationMixerPlayable mixer;
        AnimationClipPlayable gallop, idle;
        float gallopLength, idleLength;
        static readonly string[] Silks={"#4379ed","#f2c74b","#ec4c46","#d8e2ec","#32b878","#eb73af","#3bcbd9","#a980f2"};
        static readonly Color[] Coats={Color.white,new Color(.73f,.63f,.57f),new Color(1.1f,.77f,.58f),new Color(3.1f,3f,2.85f),new Color(.23f,.25f,.27f),new Color(.63f,.42f,.33f),new Color(1.65f,1.45f,1.12f),new Color(.49f,.49f,.47f)};
        public void Initialize(int id, ArenaSports.ArenaGeometry geometry)
        {
            Id=id;name="Runner "+id;
            visual=new GameObject("Mounted thoroughbred").transform;visual.SetParent(transform,false);
            var horse=Instantiate(Resources.Load<GameObject>("Horse/Thoroughbred"),visual);
            horse.transform.localScale=Vector3.one*1.18f;
            horse.transform.localPosition=Vector3.down*.025f;
            mounted=new GameObject("Jockey and fitted tack").transform;mounted.SetParent(visual,false);mounted.localScale=Vector3.one*.70f;mounted.localPosition=EquipmentOffset;
            rider=Instantiate(Resources.Load<GameObject>("Horse/JockeyScan"),mounted).transform;
            ColorUtility.TryParseHtmlString(Silks[id-1],out var silk);var coat=Coats[id-1];
            var copies=new Dictionary<Material,Material>();
            foreach(var r in visual.GetComponentsInChildren<Renderer>())
            {
                var mats=r.sharedMaterials.Select(m=>{if(!copies.ContainsKey(m))copies[m]=new Material(m);return copies[m];}).ToArray();
                foreach(var m in mats)
                {
                    string n=m.name;
                    if(n.Contains("BayHorseCoat")){m.SetColor("_BaseColor",coat);m.SetFloat("_CoatSaturation",id==4||id==5||id==8?0:1);}
                    if(n.Contains("RaceSilk"))m.SetColor("_BaseColor",silk);
                    if(n.Contains("VitSkin"))m.SetColor("_BaseColor",Color.Lerp(Color.white,new Color(.78f,.64f,.51f),(id%4)*.12f));
                }
                r.sharedMaterials=mats;r.shadowCastingMode=UnityEngine.Rendering.ShadowCastingMode.On;
                if(r is SkinnedMeshRenderer skinned)skinned.updateWhenOffscreen=false;
            }
            var animator=horse.GetComponentInChildren<Animator>();if(!animator)animator=horse.AddComponent<Animator>();
            animator.applyRootMotion=false;animator.cullingMode=AnimatorCullingMode.AlwaysAnimate;
            graph=PlayableGraph.Create("Horse gait "+id);graph.SetTimeUpdateMode(DirectorUpdateMode.Manual);
            mixer=AnimationMixerPlayable.Create(graph,2);
            var gallopClip=Resources.Load<AnimationClip>("Horse/Clips/Gallop");var idleClip=Resources.Load<AnimationClip>("Horse/Clips/Idle");
            if(!gallopClip||!idleClip)throw new InvalidOperationException("Horse gait clips missing");
            gallopLength=gallopClip.length;idleLength=idleClip.length;
            gallop=AnimationClipPlayable.Create(graph,gallopClip);idle=AnimationClipPlayable.Create(graph,idleClip);
            graph.Connect(idle,0,mixer,0);graph.Connect(gallop,0,mixer,1);
            AnimationPlayableOutput.Create(graph,"Horse skeleton",animator).SetSourcePlayable(mixer);graph.Play();
            mixer.SetInputWeight(0,1);mixer.SetInputWeight(1,0);idle.SetTime(0);graph.Evaluate(0);
            saddleBone=horse.GetComponentsInChildren<Transform>().FirstOrDefault(t=>t.name=="spine_2");
            if(saddleBone){saddleRest=visual.InverseTransformPoint(saddleBone.position);saddleRotation=Quaternion.Inverse(visual.rotation)*saddleBone.rotation;}
            var g=geometry;var fabric=g.Material("Runner "+id+" silk",silk,.27f);var leather=g.Material("Runner "+id+" leather",new Color(.055f,.035f,.027f),.35f);
            var head=rider.GetComponentsInChildren<Transform>().FirstOrDefault(t=>t.name.Replace(":","")=="mixamorigHead");
            Vector3 hp=head?mounted.InverseTransformPoint(head.position):new Vector3(0,2.95f,.78f);
            var tack=new GameObject("Fitted racing tack").transform;tack.SetParent(mounted,false);
            g.Primitive(PrimitiveType.Sphere,hp+new Vector3(0,.27f,.02f),new Vector3(.35f,.32f,.4f),fabric,tack,false);
            g.Primitive(PrimitiveType.Sphere,hp+new Vector3(0,.22f,.15f),new Vector3(.36f,.025f,.26f),leather,tack,false);
            CurvedCloth(tack,fabric,1.18f,.49f,1.97f,.43f,102);
            CurvedCloth(tack,leather,.88f,.41f,2.07f,.36f,67);
            foreach(int side in new[]{-1,1})
            {
                HorseWorld.Label(id.ToString(),new Vector3(side*.49f,2.08f,-.12f),Quaternion.Euler(0,side==-1?90:-90,0),.52f,Color.white,mounted);
                // Reins sag between the rider's gloves and the bit.
                var a=new Vector3(side*.24f,2.54f,.91f);var b=new Vector3(side*.18f,2.55f,2.08f);
                for(int j=0;j<8;j++)
                {
                    float t=j/8f,u=(j+1)/8f;
                    g.Rod(Vector3.Lerp(a,b,t)-Vector3.up*Mathf.Sin(t*Mathf.PI)*.12f,Vector3.Lerp(a,b,u)-Vector3.up*Mathf.Sin(u*Mathf.PI)*.12f,.009f,leather,tack,false);
                }
                var boot=new Vector3(side*.58f,1.72f,-.06f);
                g.Rod(boot+Vector3.up*.4f,boot,.014f,leather,tack,false);
                var iron=g.Material("Stirrup iron "+id+" "+side,new Color(.42f,.43f,.41f),.7f,.75f);
                for(int j=0;j<12;j++)
                {
                    float a0=j*Mathf.PI*2/12,a1=(j+1)*Mathf.PI*2/12;
                    g.Rod(boot+new Vector3(0,Mathf.Cos(a0)*.11f,Mathf.Sin(a0)*.1f),boot+new Vector3(0,Mathf.Cos(a1)*.11f,Mathf.Sin(a1)*.1f),.013f,iron,tack,false);
                }
            }
            CombineStatic(tack);CombineStatic(rider);
        }
        static void CombineStatic(Transform root)
        {
            var groups=new Dictionary<Material,List<CombineInstance>>();
            var filters=root.GetComponentsInChildren<MeshFilter>();
            foreach(var filter in filters)
            {
                var renderer=filter.GetComponent<MeshRenderer>();if(!renderer)continue;
                for(int i=0;i<filter.sharedMesh.subMeshCount;i++)
                {
                    var mat=renderer.sharedMaterials[i];if(!groups.ContainsKey(mat))groups[mat]=new();
                    groups[mat].Add(new CombineInstance{mesh=filter.sharedMesh,subMeshIndex=i,transform=root.worldToLocalMatrix*filter.transform.localToWorldMatrix});
                }
            }
            foreach(var group in groups)
            {
                var mesh=new Mesh{name="Mounted equipment "+group.Key.name,indexFormat=UnityEngine.Rendering.IndexFormat.UInt32};mesh.CombineMeshes(group.Value.ToArray());
                var go=new GameObject(mesh.name);go.transform.SetParent(root,false);go.AddComponent<MeshFilter>().sharedMesh=mesh;go.AddComponent<MeshRenderer>().sharedMaterial=group.Key;
            }
            foreach(var filter in filters)Destroy(filter.GetComponent<MeshRenderer>());
        }
        static void CurvedCloth(Transform parent,Material material,float length,float width,float baseY,float rise,float degrees)
        {
            const int steps=20;var v=new Vector3[(steps+1)*2];var uv=new Vector2[v.Length];var tris=new int[steps*6];
            for(int i=0;i<=steps;i++)
            {
                float a=Mathf.Lerp(-degrees,degrees,i/(float)steps)*Mathf.Deg2Rad;
                for(int j=0;j<2;j++){int k=i*2+j;v[k]=new Vector3(Mathf.Sin(a)*width,baseY+Mathf.Cos(a)*rise,-.13f+(j-.5f)*length);uv[k]=new Vector2(i/(float)steps,j);}
                if(i<steps){int k=i*2,t=i*6;tris[t]=k;tris[t+1]=k+1;tris[t+2]=k+2;tris[t+3]=k+1;tris[t+4]=k+3;tris[t+5]=k+2;}
            }
            var mesh=new Mesh{name="Contoured saddle cloth",vertices=v,uv=uv,triangles=tris};mesh.RecalculateNormals();mesh.RecalculateBounds();
            var go=new GameObject(mesh.name);go.transform.SetParent(parent,false);go.AddComponent<MeshFilter>().sharedMesh=mesh;go.AddComponent<MeshRenderer>().sharedMaterial=material;
        }
        public void Pose(Vector3 position,float heading,float gait,bool running)
        {
            transform.position=position;transform.rotation=Quaternion.Euler(0,heading,0);
            mixer.SetInputWeight(0,running?0:1);mixer.SetInputWeight(1,running?1:0);
            gallop.SetTime(Mathf.Repeat(gait,gallopLength));idle.SetTime(Mathf.Repeat(gait*.25f,idleLength));graph.Evaluate(0);
            if(saddleBone)
            {
                var delta=Quaternion.Inverse(visual.rotation)*saddleBone.rotation*Quaternion.Inverse(saddleRotation);
                mounted.localRotation=delta;
                mounted.localPosition=visual.InverseTransformPoint(saddleBone.position)-delta*(saddleRest-EquipmentOffset);
            }
            rider.localPosition=new Vector3(0,running?Mathf.Sin(gait*6.283f)*.035f:0,0);
        }
        void OnDestroy(){if(graph.IsValid())graph.Destroy();}
    }
}
