using UnityEngine;
using UnityEngine.Rendering;

namespace HorseRacing
{
    public sealed class HorseDust
    {
        const int Count=192;
        struct Puff { public Vector3 position,velocity; public float life,initial,size; }
        readonly Puff[] puffs=new Puff[Count];
        readonly Vector3[] vertices=new Vector3[Count*4];
        readonly Color[] colors=new Color[Count*4];
        readonly Vector3[] previous=new Vector3[8];
        readonly float[] timers=new float[8];
        readonly Mesh mesh;int cursor;string round="";bool initial=true;
        public HorseDust(Transform parent)
        {
            var obj=new GameObject("Hoof dust");obj.transform.SetParent(parent,false);
            mesh=new Mesh{name="Transient hoof spray"};mesh.MarkDynamic();
            var uv=new Vector2[Count*4];var triangles=new int[Count*6];
            for(int i=0;i<Count;i++)
            {
                int k=i*4,j=i*6;uv[k]=Vector2.zero;uv[k+1]=Vector2.right;uv[k+2]=Vector2.one;uv[k+3]=Vector2.up;
                triangles[j]=k;triangles[j+1]=k+1;triangles[j+2]=k+2;triangles[j+3]=k;triangles[j+4]=k+2;triangles[j+5]=k+3;
            }
            mesh.vertices=vertices;mesh.uv=uv;mesh.triangles=triangles;
            mesh.bounds=new Bounds(Vector3.zero,new Vector3(450,20,300));
            obj.AddComponent<MeshFilter>().sharedMesh=mesh;
            var renderer=obj.AddComponent<MeshRenderer>();renderer.sharedMaterial=Resources.Load<Material>("HorseDust");renderer.shadowCastingMode=ShadowCastingMode.Off;
        }
        public void Tick(Camera camera, RaceFrame state, float dt)
        {
            dt=Mathf.Min(dt,.05f);
            if(round!=state.round || state.elapsed<0) { for(int i=0;i<Count;i++)puffs[i].life=0;initial=true;round=state.round; }
            for(int i=0;i<8;i++)
            {
                var runner=state.runners[i];var position=new Vector3(runner.x,0,runner.z);
                float travelled=Vector3.Distance(position,previous[i]);
                if(!initial&&state.running&&state.featured==0&&travelled>.015f&&travelled<4)
                {
                    timers[i]+=dt;
                    if(timers[i]>.065f)
                    {
                        timers[i]=0;var heading=Quaternion.Euler(0,runner.heading,0);
                        var offset=heading*new Vector3((cursor%2==0?1:-1)*.28f,.12f,-.6f);
                        float variation=Mathf.Repeat(cursor*.618f,1);
                        puffs[cursor%Count]=new Puff{position=position+offset,velocity=heading*new Vector3((variation-.5f)*.7f,.5f,-1.1f),life=.65f+variation*.3f,initial=.65f+variation*.3f,size=.18f+variation*.15f};cursor++;
                    }
                }
                previous[i]=position;
            }
            initial=false;Vector3 right=camera.transform.right,up=camera.transform.up;
            for(int i=0;i<Count;i++)
            {
                var puff=puffs[i];puff.life=Mathf.Max(0,puff.life-dt);puff.position+=puff.velocity*dt;
                float age=puff.initial-puff.life,size=puff.size+age*.45f;
                float opacity=puff.life<=0?0:Mathf.Sin(Mathf.Clamp01(puff.life/puff.initial)*Mathf.PI)*.65f;
                int k=i*4;vertices[k]=puff.position+(-right-up)*size;vertices[k+1]=puff.position+(right-up)*size;vertices[k+2]=puff.position+(right+up)*size;vertices[k+3]=puff.position+(-right+up)*size;
                for(int j=0;j<4;j++)colors[k+j]=new Color(1,1,1,opacity);puffs[i]=puff;
            }
            mesh.vertices=vertices;mesh.colors=colors;
        }
    }
}
