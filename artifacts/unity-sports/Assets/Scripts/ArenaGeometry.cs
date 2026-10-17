using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

namespace ArenaSports
{
    /// <summary>Locally authored stadium geometry, batched by material for WebGL.</summary>
    public sealed partial class ArenaGeometry : System.IDisposable
    {
        public Transform Root { get; }
        readonly List<Material> materials = new();
        readonly List<Mesh> meshes = new();
        readonly List<MeshFilter> pending = new();
        public Material White, Dark, Steel, Concrete, Grass, Accent, LightPanel;
        Material pitchInk;
        public ArenaGeometry(Transform root)
        {
            Root=root;
            White=Material("Pitch white",new Color(.89f,.92f,.86f));
            Dark=Material("Anthracite",new Color(.028f,.043f,.052f));
            Steel=Material("Brushed steel",new Color(.4f,.46f,.49f),.65f,.65f);
            Concrete=Material("Concrete",new Color(.27f,.3f,.31f));
            Accent=Material("Arena mint",new Color(.22f,.72f,.51f));
            LightPanel=Material("Floodlight diffuser",new Color(.8f,.88f,1),0,0);
            LightPanel.EnableKeyword("_EMISSION");LightPanel.SetColor("_EmissionColor",new Color(3,3.5f,4));
            Grass=Material("Cut grass",new Color(.49f,1.04f,.48f),.12f);
            var color=Resources.Load<Texture2D>("Sports/Textures/grass-color");
            var normal=Resources.Load<Texture2D>("Sports/Textures/grass-normal");
            Grass.SetTexture("_BaseMap",color);Grass.SetTextureScale("_BaseMap",new(46,30));
            Grass.SetTexture("_BumpMap",normal);Grass.SetTextureScale("_BumpMap",new(46,30));
            Grass.SetFloat("_BumpScale",.65f);Grass.EnableKeyword("_NORMALMAP");
        }
        public Material Material(string name,Color color,float smooth=.12f,float metallic=0)
        {
            var m=new Material(Resources.Load<Material>("ArenaLit")) {name=name};
            m.SetColor("_BaseColor",color);m.SetFloat("_Smoothness",smooth);m.SetFloat("_Metallic",metallic);
            materials.Add(m);return m;
        }
        public GameObject Primitive(PrimitiveType type, Vector3 pos, Vector3 scale,Material mat,Transform parent=null,bool batch=true)
        {
            // Mesh-only resources avoid creating then destroying thousands of
            // colliders, and keep WebGL's native component stripping correct.
            var obj=new GameObject(mat.name);
            var filter=obj.AddComponent<MeshFilter>();
            filter.sharedMesh=Resources.Load<Mesh>("Primitives/"+type);
            if(!filter.sharedMesh)throw new System.InvalidOperationException("Missing primitive mesh: "+type);
            obj.transform.SetParent(parent ? parent:Root,false);
            obj.transform.localPosition=pos;obj.transform.localScale=scale;
            var r=obj.AddComponent<MeshRenderer>();r.sharedMaterial=mat;
            if(batch)pending.Add(filter);
            return obj;
        }
        public GameObject Box(Vector3 pos,Vector3 size,Material mat,Transform parent=null,bool batch=true)
            => Primitive(PrimitiveType.Cube,pos,size,mat,parent,batch);
        public GameObject Sphere(Vector3 pos,float r,Material mat,Transform parent=null,bool batch=true)
            => Primitive(PrimitiveType.Sphere,pos,Vector3.one*r*2,mat,parent,batch);
        public GameObject Rod(Vector3 a,Vector3 b,float radius,Material mat,Transform parent=null,bool batch=true)
        {
            var obj=Primitive(PrimitiveType.Cylinder,(a+b)*.5f,new(radius*2,(b-a).magnitude*.5f,radius*2),mat,parent,batch);
            obj.transform.localRotation=Quaternion.FromToRotation(Vector3.up,(b-a).normalized);return obj;
        }
        public void Line(Vector3 a,Vector3 b,float width=.1f,Material mat=null)
        {
            if(pitchInk&&!mat){a.y=Mathf.Max(a.y,.045f);b.y=Mathf.Max(b.y,.045f);width=Mathf.Max(width,.12f);}
            var obj=Box((a+b)*.5f,new(width,.008f,(b-a).magnitude),mat ? mat:pitchInk?pitchInk:White);
            obj.transform.rotation=Quaternion.LookRotation((b-a).normalized);
        }
        public void Circle(Vector3 center,float rx,float rz,float width=.1f,Material mat=null,int steps=128)
        {
            Vector3 last=center+new Vector3(rx,0,0);
            for(int i=1;i<=steps;i++)
            {
                float a=i*Mathf.PI*2/steps;Vector3 next=center+new Vector3(Mathf.Cos(a)*rx,0,Mathf.Sin(a)*rz);
                Line(last,next,width,mat);last=next;
            }
        }
        public void Rectangle(float x1,float z1,float x2,float z2,float y=.016f)
        {
            Line(new(x1,y,z1),new(x2,y,z1));Line(new(x2,y,z1),new(x2,y,z2));
            Line(new(x2,y,z2),new(x1,y,z2));Line(new(x1,y,z2),new(x1,y,z1));
        }
        public void Surface(float x,float z,Material mat,float y=-.012f)
            => Primitive(PrimitiveType.Plane,new(0,y,0),new(x/10,1,z/10),mat);
        public void Pitch()
        {
            pitchInk=new Material(Resources.Load<Material>("ArenaLED")){name="Pitch markings"};materials.Add(pitchInk);
            pitchInk.SetTexture("_BaseMap",Texture2D.whiteTexture);pitchInk.SetColor("_BaseColor",new(.82f,.85f,.81f));
            Surface(145,106,Grass);
            var stripe=Material("Mowing stripes",new Color(.29f,.48f,.23f),.16f);
            stripe.CopyPropertiesFromMaterial(Grass);stripe.SetColor("_BaseColor",new Color(.44f,.94f,.43f));
            for(int i=0;i<14;i+=2)
            {
                var patch=Primitive(PrimitiveType.Plane,new(-48.75f+i*7.5f,-.008f,0),new(.75f,1,6.8f),stripe);
                // Mesh UVs cover the same world-space grass density in each stripe.
                var filter=patch.GetComponent<MeshFilter>();var mesh=Object.Instantiate(filter.sharedMesh);
                var uv=mesh.uv;for(int j=0;j<uv.Length;j++)uv[j]=new(uv[j].x*7.5f/145,uv[j].y*68/106);
                mesh.uv=uv;filter.sharedMesh=mesh;meshes.Add(mesh);
            }
            Rectangle(-52.5f,-34,52.5f,34);Line(new(0,.02f,-34),new(0,.02f,34));
            Circle(new(0,.02f,0),9.15f,9.15f);
            Primitive(PrimitiveType.Cylinder,new(0,.003f,0),new(.26f,.003f,.26f),White);
            foreach(int sign in new[]{-1,1})
            {
                Rectangle(sign*52.5f,-20.16f,sign*36,20.16f);
                Rectangle(sign*52.5f,-9.16f,sign*47,9.16f);
                Primitive(PrimitiveType.Cylinder,new(sign*41.5f,.003f,0),new(.26f,.003f,.26f),White);
                // Only the arc outside the penalty area is marked.
                Vector3 last=new(sign*36,.02f,-7.31f);
                for(int j=1;j<=40;j++)
                {
                    float angle=Mathf.Lerp(-.927f,.927f,j/40f);
                    Vector3 next=new(sign*(41.5f-9.15f*Mathf.Cos(angle)),.02f,9.15f*Mathf.Sin(angle));
                    Line(last,next);last=next;
                }
                Goal(sign);
                foreach(int side in new[]{-1,1})
                {
                    Rod(new(sign*52.6f,0,side*34.1f),new(sign*52.6f,1.6f,side*34.1f),.025f,White);
                    Box(new(sign*52.6f,1.4f,side*34.1f),new(.02f,.3f,.35f),Accent);
                }
            }
        }
        void Goal(int sign)
        {
            float x=52.6f*sign,back=55.1f*sign;
            foreach(float z in new[]{-3.66f,3.66f})
            {
                Rod(new(x,.02f,z),new(x,2.44f,z),.06f,White);
                Rod(new(x,2.44f,z),new(back,2.2f,z),.025f,Steel);
                Rod(new(back,0,z),new(back,2.2f,z),.025f,Steel);
            }
            Rod(new(x,2.44f,-3.66f),new(x,2.44f,3.66f),.06f,White);
            for(float z=-3.66f;z<=3.67f;z+=.21f)
            {
                Rod(new(back,0,z),new(back,2.2f,z),.008f,White);
                Rod(new(back,2.2f,z),new(x,2.44f,z),.008f,White);
            }
            for(float y=.08f;y<=2.2f;y+=.21f)
            {
                Rod(new(back,y,-3.66f),new(back,y,3.66f),.008f,White);
                foreach(float z in new[]{-3.66f,3.66f})Rod(new(x,y,z),new(back,y,z),.008f,White);
            }
        }
        static Vector3 StadiumPoint(float a,float rx,float rz,float y,bool rectangular)
        {
            float x=Mathf.Cos(a),z=Mathf.Sin(a);
            if(rectangular){x=Mathf.Sign(x)*Mathf.Pow(Mathf.Abs(x),.55f);z=Mathf.Sign(z)*Mathf.Pow(Mathf.Abs(z),.55f);}
            return new(x*rx,y,z*rz);
        }
        Material PhotographicSurface(string name,string source,Color tint,Vector2 repeat,float smooth=.15f,float metal=0)
        {
            var mat=Material(name,tint,smooth,metal);
            mat.SetTexture("_BaseMap",Resources.Load<Texture2D>("Sports/Textures/"+source+"-color"));
            mat.SetTexture("_BumpMap",Resources.Load<Texture2D>("Sports/Textures/"+source+"-normal"));
            mat.SetTextureScale("_BaseMap",repeat);mat.SetTextureScale("_BumpMap",repeat);
            mat.SetFloat("_BumpScale",.35f);mat.EnableKeyword("_NORMALMAP");return mat;
        }
        public void FootballStadium(int style)
        {
            const float rx=64,rz=42;
            Color[] colors={new(.035f,.19f,.14f),new(.035f,.12f,.24f),new(.13f,.055f,.10f),new(.18f,.025f,.035f)};
            var club=Material("Venue seating",colors[Mathf.Clamp(style,0,3)]);
            var concrete=PhotographicSurface("Stadium concrete","stadium-concrete",new(.6f,.63f,.65f),new(90,2));
            concrete.SetFloat("_Cull",0);
            var tunnel=PhotographicSurface("Tunnel concrete","stadium-concrete",new(.65f,.68f,.71f),new(3,2));
            var roof=PhotographicSurface("Canopy panels","stadium-metal",new(.50f,.57f,.65f),new(140,16),.35f,.35f);
            // The stadium canopy is seen from above AND from the pitch.
            roof.SetFloat("_Cull",0);
            var fascia=Material("Stadium fascia",new(.055f,.07f,.095f),.25f);
            var glass=Material("Hospitality glazing",new(.09f,.16f,.21f),.8f,.25f);
            var led=new Material(Resources.Load<Material>("ArenaLED"));materials.Add(led);
            Surface(230,190,Dark,-.08f);
            for(int tier=0;tier<3;tier++)
            {
                float offset=tier*14.5f,floor=1.5f+tier*9.8f;
                for(int row=0;row<14;row++)
                {
                    float x=rx+3+offset+row*.91f,z=rz+3+offset+row*.91f,y=floor+row*.58f;
                    Ring(x,z,y,x+.91f,z+.91f,y,club,true,1,tier==0&&row<4);
                    Ring(x,z,y-.58f,x,z,y,concrete,true,1,tier==0&&row<4);
                }
                Ring(rx+16+offset,rz+16+offset,floor+7.6f,rx+16+offset,rz+16+offset,floor+8.8f,fascia,true);
                Ring(rx+16+offset,rz+16+offset,floor+8.15f,rx+16+offset,rz+16+offset,floor+8.65f,led,true,72);
                // Hospitality boxes and a dark concourse between tiers.
                if(tier<2)Ring(rx+16+offset,rz+16+offset,floor+8.8f,rx+16+offset,rz+16+offset,floor+9.65f,glass,true);
            }
            Crowd(rx,rz,true,14,14.5f,9.8f,.91f,.58f,1.5f);
            Ring(rx+1,rz+1,32,rx+46,rz+46,36.5f,roof,true);
            Ring(rx+1,rz+1,31.4f,rx+1,rz+1,32.3f,fascia,true);
            Ring(rx+1,rz+1,31.4f,rx+1,rz+1,31.85f,led,true,72);
            Ring(rx+46,rz+46,0,rx+46,rz+46,36.5f,concrete,true);
            for(int i=0;i<48;i++)
            {
                float a=(i+.5f)*Mathf.PI*2/48;
                Vector3 outer=StadiumPoint(a,rx+45,rz+45,36,true),inner=StadiumPoint(a,rx+1,rz+1,31.1f,true);
                Rod(outer,inner,.12f,Steel);Rod(outer-Vector3.up*1.5f,inner-Vector3.up*1.2f,.09f,Steel);
                Rod(new(outer.x,0,outer.z),outer,.22f,Steel);
                for(int j=0;j<8;j++)Rod(Vector3.Lerp(outer,inner,j/8f),Vector3.Lerp(outer,inner,(j+1)/8f)-Vector3.up*1.2f,.045f,Steel);
                var lamp=Box(inner-Vector3.up*.7f,new(3.2f,.16f,.75f),LightPanel);
                lamp.transform.rotation=Quaternion.Euler(25,-a*Mathf.Rad2Deg,0);
            }
            // Touchline boards leave an actual opening for the entrance.
            foreach(int side in new[]{-1,1})
            {
                for(int i=-7;i<=7;i++)
                {
                    if(side==-1&&i==0)continue;
                    Box(new(i*7.6f,.48f,side*39),new(7.45f,.92f,.14f),led);
                }
                for(int i=-4;i<=4;i++)
                {
                    var board=Box(new(side*59,.48f,i*8),new(7.8f,.92f,.14f),led);board.transform.rotation=Quaternion.Euler(0,90,0);
                }
            }
            // Hollow walkout tunnel: two walls, ceiling and a recessed entrance.
            Box(new(-3.1f,1.65f,-44.5f),new(.35f,3.3f,13),tunnel);
            Box(new(3.1f,1.65f,-44.5f),new(.35f,3.3f,13),tunnel);
            Box(new(0,3.3f,-44.5f),new(6.55f,.3f,13),tunnel);
            Box(new(0,-.005f,-44.5f),new(6,.02f,13),Dark);
            Box(new(0,1.5f,-50.9f),new(6,3,.16f),Dark);
            Box(new(0,3.05f,-38),new(6.5f,.32f,.24f),led);
            for(int j=0;j<5;j++)Box(new(0,3.12f,-39-j*2.6f),new(3.8f,.04f,.2f),LightPanel);
            foreach(int side in new[]{-1,1})
            {
                // Dugouts, technical area, padded seats, camera rigs.
                float x=side*15;
                Box(new(x,2.15f,-40),new(13,.12f,2.5f),roof);
                Box(new(x,1.1f,-41.2f),new(13,2.2f,.12f),glass);
                foreach(float dx in new[]{-6.4f,6.4f})Rod(new(x+dx,0,-40.8f),new(x+dx,2.2f,-40.8f),.045f,Steel);
                for(int j=0;j<11;j++)
                {
                    Box(new(x-5.5f+j*1.1f,.52f,-40.1f),new(.7f,.12f,.65f),club);
                    Box(new(x-5.5f+j*1.1f,.9f,-40.5f),new(.7f,.8f,.12f),club);
                }
                Rectangle(x-6,-37.8f,x+6,-35.5f);
                Vector3 cam=new(side*28,1.65f,-37.8f);
                Box(cam,new(.48f,.32f,.7f),Dark);Rod(cam,cam+Vector3.forward*.65f,.1f,Dark);
                for(int j=0;j<3;j++)Rod(cam-Vector3.up*.2f,cam+new Vector3(Mathf.Cos(j*2.094f)*.6f,-1.65f,Mathf.Sin(j*2.094f)*.6f),.025f,Steel);
                // Large replay screen above each end stand.
                var screen=Box(new(side*86,25,0),new(.5f,6.2f,12),led);
                Box(new(side*86.3f,25,0),new(.6f,6.8f,12.6f),Dark);
            }
        }
        public void Stadium(float rx,float rz,bool indoor=false,bool rectangular=true)
        {
            Surface(rx*3,rz*3,Dark,-.08f);
            var seat=Material("Navy seating",new Color(.035f,.11f,.16f));
            var fascia=Material("Stadium fascia",new Color(.07f,.12f,.15f),.3f);
            var advertising=Material("Perimeter LED",new Color(.05f,.23f,.19f),.25f);
            advertising.EnableKeyword("_EMISSION");advertising.SetColor("_EmissionColor",new Color(.015f,.08f,.055f));
            Ring(rx,rz,0,rx+1.2f,rz+1.2f,1,advertising,rectangular);
            for(int tier=0;tier<3;tier++)
            {
                float offset=tier*13, floor=2+tier*8;
                for(int row=0;row<10;row++)
                    Ring(rx+3+offset+row*.95f,rz+3+offset+row*.95f,floor+row*.63f,
                        rx+4+offset+row*.95f,rz+4+offset+row*.95f,floor+row*.63f,seat,rectangular);
                Ring(rx+13+offset,rz+13+offset,floor+6.2f,rx+13+offset,rz+13+offset,floor+7.25f,fascia,rectangular);
            }
            Crowd(rx,rz,rectangular);
            float roof=29;
            Ring(rx+1,rz+1,roof-2,rx+43,rz+43,roof+4,Steel,rectangular);
            Ring(rx+1,rz+1,roof-2.35f,rx+43,rz+43,roof+3.65f,fascia,rectangular);
            if(indoor) Box(new(0,roof+2,0),new(rx*2,1,rz*2),Dark);
            for(int i=0;i<32;i++)
            {
                float a=i*Mathf.PI*2/32;Vector3 edge=StadiumPoint(a,rx+40,rz+40,0,rectangular);
                Rod(edge,edge+Vector3.up*(roof+3),.3f,Steel);
                Vector3 inner=StadiumPoint(a,rx+2,rz+2,roof-3,rectangular);
                Rod(edge+Vector3.up*(roof+3),inner,.17f,Steel);
                var panel=Box(inner,new(4.2f,.16f,1),LightPanel);
                panel.transform.rotation=Quaternion.Euler(20,-a*Mathf.Rad2Deg,0);
                // Roof trusses and cross braces make the canopy read as steelwork.
                var lower=inner-Vector3.up*1.2f;
                Rod(edge+Vector3.up*(roof+1.5f),lower,.11f,Steel);
                for(int j=1;j<7;j++)
                {
                    var a0=Vector3.Lerp(edge+Vector3.up*(roof+3),inner,j/7f);
                    var a1=Vector3.Lerp(edge+Vector3.up*(roof+1.5f),lower,(j+.7f)/7f);
                    Rod(a0,a1,.055f,Steel);
                }
            }
            var led=new Material(Resources.Load<Material>("ArenaLED"));materials.Add(led);
            for(int i=0;i<48;i++)
            {
                float a=(i+.5f)*Mathf.PI*2/48;
                Vector3 p=StadiumPoint(a,rx-.12f,rz-.12f,.65f,rectangular);
                Vector3 tangent=StadiumPoint(a+.005f,rx,rz,.65f,rectangular)-p;tangent.y=0;
                var board=Box(p,new(7.5f,.82f,.14f),led);
                board.transform.rotation=Quaternion.LookRotation(new Vector3(-tangent.z,0,tangent.x));
            }
            foreach(int side in new[]{-1,1})
            {
                Box(new(side*(rx+20),19,0),new(.5f,7,13),led);
                foreach(int z in new[]{-5,5})Rod(new(side*(rx+20),0,z),new(side*(rx+20),22,z),.22f,Steel);
            }
            // Ground-level camera platforms and player tunnels provide scale.
            foreach(int side in new[]{-1,1})
            {
                Box(new(0,1.4f,side*(rz+3)),new(6,2.8f,5),Dark);
                Box(new(-13,1.25f,side*(rz-1)),new(10,.1f,2.3f),Steel);
                for(int j=0;j<8;j++)Box(new(-17+j*1.1f,.5f,side*(rz-1)),new(.75f,.7f,.75f),seat);
            }
        }
        void Ring(float rx,float rz,float y,float rx2,float rz2,float y2,Material mat,bool rectangular=false,float repeat=1,bool tunnelOpening=false)
        {
            int steps=tunnelOpening?2048:192;
            var verts=new Vector3[(steps+1)*2];var uv=new Vector2[verts.Length];var triangles=new int[steps*6];
            for(int i=0;i<=steps;i++)
            {
                float a=i*Mathf.PI*2/steps;
                verts[i*2]=StadiumPoint(a,rx,rz,y,rectangular);
                verts[i*2+1]=StadiumPoint(a,rx2,rz2,y2,rectangular);
                uv[i*2]=new(i/(float)steps*repeat,0);uv[i*2+1]=new(i/(float)steps*repeat,1);
                if(i==steps)continue;
                if(tunnelOpening)
                {
                    var midpoint=StadiumPoint((i+.5f)*Mathf.PI*2/steps,rx,rz,y,rectangular);
                    if(midpoint.z<0&&Mathf.Abs(midpoint.x)<4)continue;
                }
                int p=i*6,v=i*2;triangles[p]=v;triangles[p+1]=v+2;triangles[p+2]=v+1;
                triangles[p+3]=v+1;triangles[p+4]=v+2;triangles[p+5]=v+3;
            }
            MeshObject("Stadium ring",verts,uv,triangles,mat,true);
        }
        public void RaceSurface(Material road,Material curb)
        {
            // A continuous ribbon avoids the coplanar overlap of road boxes.
            Ring(47,24,.13f,59,36,.13f,road);
            const int steps=192;
            foreach(int side in new[]{-1,1})
            {
                float radius=side*6;
                var verts=new Vector3[(steps+1)*2];var uv=new Vector2[verts.Length];
                var red=new List<int>();var white=new List<int>();
                for(int i=0;i<=steps;i++)
                {
                    float a=i*Mathf.PI*2/steps;
                    verts[i*2]=new(Mathf.Cos(a)*(53+radius-.35f),.145f,Mathf.Sin(a)*(30+radius-.35f));
                    verts[i*2+1]=new(Mathf.Cos(a)*(53+radius+.35f),.145f,Mathf.Sin(a)*(30+radius+.35f));
                    uv[i*2]=new(i/(float)steps,0);uv[i*2+1]=new(i/(float)steps,1);
                    if(i==steps)continue;
                    int v=i*2;(i%4<2?red:white).AddRange(new[]{v,v+2,v+1,v+1,v+2,v+3});
                }
                MeshObject("Red circuit kerb",verts,uv,red.ToArray(),curb,true);
                MeshObject("White circuit kerb",verts,uv,white.ToArray(),White,true);
            }
        }
        void Crowd(float rx,float rz,bool rectangular,int rows=10,float tierDepth=13,float tierHeight=8,float rowDepth=.95f,float rowHeight=.63f,float baseHeight=2)
        {
            var mat=new Material(Resources.Load<Material>("ArenaCrowd"));materials.Add(mat);
            mat.SetTexture("_BaseMap",Resources.Load<Texture2D>("Sports/Textures/football-fans"));
            mat.SetColor("_BaseColor",new Color(.62f,.67f,.74f));
            var verts=new List<Vector3>();var uv=new List<Vector2>();var indices=new List<int>();
            var rng=new System.Random(7321);
            for(int tier=0;tier<3;tier++)for(int row=0;row<rows;row++)
            {
                float x=rx+3.4f+tier*tierDepth+row*rowDepth,z=rz+3.4f+tier*tierDepth+row*rowDepth;
                // Uniform physical spacing, not uniform angle: a superellipse
                // has very uneven arc length and used to leave huge gaps.
                const int samples=1024;var path=new Vector3[samples+1];var lengths=new float[samples+1];
                for(int j=0;j<=samples;j++)
                {
                    path[j]=StadiumPoint(j*Mathf.PI*2/samples,x,z,baseHeight+tier*tierHeight+row*rowHeight,rectangular);
                    if(j>0)lengths[j]=lengths[j-1]+Vector3.Distance(path[j-1],path[j]);
                }
                int count=Mathf.FloorToInt(lengths[samples]/.72f),segment=1;
                for(int i=0;i<count;i++)
                {
                    // Preserve aisles, with deterministic occupancy across reloads.
                    if(i%64<2 || rng.NextDouble()<.012)continue;
                    float distance=(i+(row%2)*.4f)*lengths[samples]/count;
                    while(segment<samples&&lengths[segment]<distance)segment++;
                    Vector3 p=Vector3.Lerp(path[segment-1],path[segment],Mathf.InverseLerp(lengths[segment-1],lengths[segment],distance));
                    if(rows==14&&tier==0&&row<4&&p.z<0&&Mathf.Abs(p.x)<4)continue;
                    Vector3 right=(path[segment]-path[segment-1]).normalized;
                    float h=1.1f+(float)rng.NextDouble()*.18f;int k=verts.Count,cell=rng.Next(16);
                    verts.Add(p-right*.48f);verts.Add(p+right*.48f);verts.Add(p+right*.48f+Vector3.up*h);verts.Add(p-right*.48f+Vector3.up*h);
                    float u=cell%4*.25f,v=cell/4*.25f;
                    uv.Add(new(u+.006f,v+.006f));uv.Add(new(u+.244f,v+.006f));uv.Add(new(u+.244f,v+.244f));uv.Add(new(u+.006f,v+.244f));
                    indices.AddRange(new[]{k,k+2,k+1,k,k+3,k+2});
                }
            }
            var crowd=MeshObject("Spectator atlas",verts.ToArray(),uv.ToArray(),indices.ToArray(),mat,false);
            crowd.GetComponent<MeshRenderer>().shadowCastingMode=ShadowCastingMode.Off;
        }
        GameObject MeshObject(string name,Vector3[] verts,Vector2[] uv,int[] indices,Material mat,bool batch)
        {
            var mesh=new Mesh {name=name,indexFormat=IndexFormat.UInt32,vertices=verts,uv=uv,triangles=indices};
            mesh.RecalculateNormals();mesh.RecalculateBounds();meshes.Add(mesh);
            var go=new GameObject(name);go.transform.SetParent(Root,false);
            var f=go.AddComponent<MeshFilter>();f.sharedMesh=mesh;
            go.AddComponent<MeshRenderer>().sharedMaterial=mat;if(batch)pending.Add(f);return go;
        }
        public void Batch()
        {
            var batches=new Dictionary<Material,List<CombineInstance>>();
            foreach(var f in pending)
            {
                var mat=f.GetComponent<MeshRenderer>().sharedMaterial;
                if(!batches.ContainsKey(mat)) batches[mat]=new();
                batches[mat].Add(new CombineInstance {mesh=f.sharedMesh,transform=Root.worldToLocalMatrix*f.transform.localToWorldMatrix});
            }
            foreach(var entry in batches)
            {
                var mesh=new Mesh {name=entry.Key.name+" batch",indexFormat=IndexFormat.UInt32};
                mesh.CombineMeshes(entry.Value.ToArray());meshes.Add(mesh);
                var go=new GameObject(mesh.name);go.transform.SetParent(Root,false);
                go.AddComponent<MeshFilter>().sharedMesh=mesh;
                var renderer=go.AddComponent<MeshRenderer>();renderer.sharedMaterial=entry.Key;
                // The key light represents the stadium's distributed floodlights;
                // the continuous canopy must not black out the entire pitch.
                if(entry.Key==Steel || entry.Key==Dark || entry.Key==LightPanel || entry.Key.name=="Stadium fascia" || entry.Key.name=="Canopy panels" || entry.Key.name=="Stadium concrete")renderer.shadowCastingMode=ShadowCastingMode.Off;
                if(entry.Key==pitchInk){renderer.shadowCastingMode=ShadowCastingMode.Off;renderer.receiveShadows=false;}
            }
            foreach(var f in pending) { f.gameObject.SetActive(false);Object.Destroy(f.gameObject); }
            pending.Clear();
        }
        public void Dispose()
        {
            foreach(var m in materials)if(m)Object.Destroy(m);
            foreach(var mesh in meshes)if(mesh)Object.Destroy(mesh);
            Object.Destroy(Root.gameObject);
        }
    }
}
