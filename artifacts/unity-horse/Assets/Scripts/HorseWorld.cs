using System.Collections.Generic;
using ArenaSports;
using UnityEngine;
using UnityEngine.Rendering;

namespace HorseRacing
{
    public sealed class HorseWorld
    {
        public readonly ArenaGeometry Geometry;
        public readonly Transform Gates;
        public readonly List<Transform> Doors = new();
        readonly Dictionary<string,Material> adMaterials = new();
        readonly Dictionary<string,List<GameObject>> adLabels = new();
        Material cream, green, gold, dirt;
        readonly List<Light> lamps=new();
        readonly Transform root;
        readonly HorseCrowd spectators;
        readonly HorseInstances trees;
        public int SpectatorCount => spectators.Count;
        static Material textMaterial;
        public HorseWorld(Transform parent)
        {
            root = new GameObject("Royal Park racecourse").transform; root.SetParent(parent, false);
            Geometry = new ArenaGeometry(root); var g = Geometry;
            cream = g.Material("Warm limestone", new Color(.58f,.59f,.55f));
            green = g.Material("British racing green", new Color(.045f,.14f,.12f), .3f);
            gold = g.Material("Championship gold", new Color(.72f,.56f,.27f), .32f,.4f);
            foreach(string slot in new[]{"trackside","grandstand","infield","finish"})
            {
                var m=new Material(Resources.Load<Material>("HorseUnlit"));m.SetColor("_BaseColor",new Color(.045f,.14f,.12f));
                adMaterials[slot]=m;adLabels[slot]=new List<GameObject>();
            }
            g.Grass.SetTexture("_BaseMap", Resources.Load<Texture2D>("Horse/Textures/grass-color"));
            g.Grass.SetTexture("_BumpMap", Resources.Load<Texture2D>("Horse/Textures/grass-normal"));
            g.Grass.SetColor("_BaseColor", new Color(.58f,.67f,.48f));
            g.Grass.SetTextureScale("_BaseMap", new Vector2(70,55));
            g.Grass.SetTextureScale("_BumpMap", new Vector2(70,55));
            g.Surface(900,700,g.Grass,-.08f);
            dirt = g.Material("Raked racing loam", new Color(.68f,.61f,.52f),.06f);
            dirt.SetTexture("_BaseMap",Resources.Load<Texture2D>("Horse/Textures/dirt-color"));
            dirt.SetTexture("_BumpMap",Resources.Load<Texture2D>("Horse/Textures/dirt-normal"));
            dirt.SetFloat("_BumpScale",.8f); dirt.EnableKeyword("_NORMALMAP");
            Ring(33,54,dirt); Rail(32.7f); Rail(54.3f);
            // A paved apron separates spectators and advertising from the running lanes.
            Ring(55,64,g.Material("Service road",new Color(.18f,.2f,.2f)));
            for(int i=0;i<72;i++)
            {
                var p = Track(i/72f,55.8f); var next=Track(i/72f+.0001f,55.8f);
                var q=Quaternion.LookRotation((next-p).normalized);
                Board(p+Vector3.up*.85f,q,6.1f,1.05f,i%3);
            }
            for(int i=0;i<48;i++)
            {
                var p=Track(i/48f,31.8f);var next=Track(i/48f+.0001f,31.8f);
                Board(p+Vector3.up*.55f,Quaternion.LookRotation((next-p).normalized),5.2f,.65f,i%3);
            }
            spectators=new HorseCrowd();
            trees=new HorseInstances("Horse/Tree",false,false);
            Grandstand(-1,104); Grandstand(1,86);
            spectators.Prepare();
            for(int sign=-1;sign<=1;sign+=2) for(int i=0;i<6;i++)
                Floodlight(new Vector3(-110+i*44,0,sign*99));
            for(int i=0;i<64;i++)
            {
                float a=i*Mathf.PI*2/64, scale=1.8f+Mathf.Repeat(i*.372f,.9f);
                var p=new Vector3(Mathf.Cos(a)*(178+Mathf.Sin(i*2.1f)*16),0,Mathf.Sin(a)*(134+Mathf.Sin(i*3.3f)*16));
                trees.Add(p,Quaternion.Euler(0,i*137.5f,0),Vector3.one*scale);
            }
            trees.Prepare();
            Landscape();
            for(int side=-1;side<=1;side+=2)
            {
                // Tall screens sit outside the oval, clear of infield tracking cameras.
                var p=new Vector3(side*164,0,6);
                g.Box(p+new Vector3(0,5,0),new Vector3(.5f,10,.5f),g.Steel);
                g.Box(p+new Vector3(0,10,0),new Vector3(16,8,.5f),green);
                Label("ROYAL PARK",p+new Vector3(0,12,-.29f),Quaternion.identity,1.05f,Color.white);
                Label("WORLD RACING SERIES",p+new Vector3(0,10.6f,-.29f),Quaternion.identity,.42f,new Color(.9f,.75f,.44f));
                Label("1600m  /  CHAMPIONSHIP",p+new Vector3(0,8.8f,-.29f),Quaternion.identity,.38f,Color.white);
                Label("1   2   3   4   5   6   7   8",p+new Vector3(0,7.5f,-.29f),Quaternion.identity,.4f,Color.white);
                AdFace("infield",p+new Vector3(0,4,-.3f),Quaternion.identity,15,5);
            }
            // Finish marker outside the actual racing lane.
            g.Box(new Vector3(0,.012f,-43.5f),new Vector3(.22f,.015f,20.5f),g.White);
            AdFace("finish",new Vector3(12,2.6f,-58),Quaternion.Euler(0,180,0),12,2);
            foreach(float z in new[]{-31.5f,-56.5f})
            {
                g.Box(new Vector3(0,3,z),new Vector3(.28f,6,.28f),g.White);
                g.Box(new Vector3(0,5.6f,z),new Vector3(.9f,1.3f,.18f),green);
                Label("FINISH",new Vector3(0,5.6f,z-.12f),Quaternion.identity,.17f,Color.white);
            }
            Gates=new GameObject("Eight starting stalls").transform;Gates.SetParent(root,false);Gates.localPosition=new Vector3(3.9f,0,0);
            for(int i=0;i<8;i++)
            {
                float z=-35-i*2.15f;
                g.Box(new Vector3(-4,3.45f,z),new Vector3(5,.25f,2.1f),green,Gates,false);
                Label((i+1).ToString(),new Vector3(-1.45f,3.35f,z),Quaternion.Euler(0,-90,0),.5f,Color.white,Gates);
                for(int side=-1;side<=1;side+=2)
                {
                    g.Box(new Vector3(-4,1.5f,z+side*1.03f),new Vector3(4.8f,3,.07f),g.Steel,Gates,false);
                    var pivot=new GameObject("Opening stall door").transform;pivot.SetParent(Gates,false);pivot.localPosition=new Vector3(-1.5f,0,z+side*1.03f);
                    g.Box(new Vector3(0,1.2f,-side*.5f),new Vector3(.08f,2.4f,.97f),green,pivot,false);Doors.Add(pivot);
                }
            }
            g.Batch();
        }
        public void DrawInstances(Camera camera) { spectators.Draw(camera);trees.Draw(camera); }
        public void SetNight(bool night) { foreach(var lamp in lamps)lamp.enabled=night; }
        public static Vector3 Track(float progress,float radius)
        {
            float straight=140, length=280+Mathf.PI*2*radius;
            float s=Mathf.Repeat(progress*length+70,length);
            if(s<straight)return new Vector3(-70+s,0,-radius);s-=straight;
            if(s<Mathf.PI*radius){float a=-Mathf.PI/2+s/radius;return new Vector3(70+Mathf.Cos(a)*radius,0,Mathf.Sin(a)*radius);}s-=Mathf.PI*radius;
            if(s<straight)return new Vector3(70-s,0,radius);s-=straight;
            float b=Mathf.PI/2+s/radius;return new Vector3(-70+Mathf.Cos(b)*radius,0,Mathf.Sin(b)*radius);
        }
        void Ring(float inside,float outside,Material mat)
        {
            const int steps=320;var v=new Vector3[(steps+1)*2];var uv=new Vector2[v.Length];var tri=new int[steps*6];
            // Equal normalized distance along each boundary gives an unbroken oval.
            for(int i=0;i<=steps;i++)
            {
                v[i*2]=Track(i/(float)steps,inside)+Vector3.up*.005f;
                v[i*2+1]=Track(i/(float)steps,outside)+Vector3.up*.005f;
                uv[i*2]=new Vector2(v[i*2].x/5,v[i*2].z/5);uv[i*2+1]=new Vector2(v[i*2+1].x/5,v[i*2+1].z/5);
                if(i==steps)continue;int k=i*2,j=i*6;
                tri[j]=k;tri[j+1]=k+2;tri[j+2]=k+1;tri[j+3]=k+1;tri[j+4]=k+2;tri[j+5]=k+3;
            }
            Mesh("Oval surface",v,uv,tri,mat);
        }
        void Rail(float radius)
        {
            var g=Geometry;const int steps=210;
            for(int i=0;i<steps;i++)
            {
                var a=Track(i/(float)steps,radius);var b=Track((i+1)/(float)steps,radius);
                g.Rod(a,b+Vector3.up*.001f,.035f,g.White);
                g.Rod(a+Vector3.up*1.15f,b+Vector3.up*1.15f,.055f,g.White);
                g.Rod(a+Vector3.up*.58f,b+Vector3.up*.58f,.027f,g.White);
                if(i%2==0)g.Rod(a,a+Vector3.up*1.18f,.04f,g.White);
            }
        }
        void Board(Vector3 center,Quaternion rotation,float width,float height,int variant)
        {
            var g=Geometry;var shell=g.Box(center,new Vector3(.13f,height+.1f,width+.1f),g.Dark);shell.transform.rotation=rotation;
            var board=g.Box(center,new Vector3(.15f,height,width),variant==1?cream:green);board.transform.rotation=rotation;
            // Readable original sample sponsors, physically mounted on the trackside panel.
            string text=variant==0?"ROYAL PARK":variant==1?"YOUR BRAND":"WORLD RACING";
            foreach(int side in new[]{-1,1})
            {
                var p=center+rotation*(Vector3.right*side*.085f);
                AdFace("trackside",p,rotation*Quaternion.Euler(0,-side*90,0),width,height);
            }
            g.Box(center-Vector3.up*(height/2+.2f),new Vector3(.16f,.5f,.16f),g.Steel);
        }
        void Grandstand(int sign,float halfWidth)
        {
            var g=Geometry;
            var seats=g.Material("Forest green stadium seats "+sign,new Color(.1f,.25f,.2f),.32f);
            var rng=new System.Random(239+sign);
            var shadowConcrete=g.Material("Grandstand concrete "+sign,new Color(.31f,.34f,.32f));
            g.Box(new Vector3(0,9,sign*94),new Vector3(halfWidth*2,18,4),shadowConcrete);
            for(int tier=0;tier<2;tier++)for(int row=0;row<10;row++)
            {
                float y=1.1f+tier*7.7f+row*.57f, z=sign*(67+tier*12+row*.92f);
                g.Box(new Vector3(0,y*.5f-.28f,z),new Vector3(halfWidth*2,y,.94f),shadowConcrete);
                g.Box(new Vector3(0,y-.28f,z),new Vector3(halfWidth*2,.55f,.96f),cream);
                for(float x=-halfWidth+1;x<halfWidth;x+=1.15f)
                {
                    if(Mathf.Repeat(x+halfWidth,24)<2.6f)continue;
                    g.Box(new Vector3(x,y+.53f,z+sign*.16f),new Vector3(.56f,.55f,.09f),seats);
                    g.Box(new Vector3(x,y+.36f,z-sign*.11f),new Vector3(.56f,.08f,.48f),seats);
                    if(rng.NextDouble()<.16)continue;
                    float size=.93f+(float)rng.NextDouble()*.13f;
                    spectators.Add(new Vector3(x+((float)rng.NextDouble()-.5f)*.08f,y-.03f,z-sign*.07f),Quaternion.Euler(0,(sign==1?180:0)+((float)rng.NextDouble()-.5f)*12,0),new Vector3(size,size,size),rng.Next(3));
                }
            }
            var facade=g.Material("Hospitality glazing "+sign,Color.white,.4f);
            facade.SetTexture("_BaseMap",Resources.Load<Texture2D>("Horse/Textures/hospitality"));facade.SetTextureScale("_BaseMap",new Vector2(13,1));
            g.Box(new Vector3(0,16,sign*94),new Vector3(halfWidth*2,5,6),cream);
            var f=g.Primitive(PrimitiveType.Quad,new Vector3(0,16,sign*90.96f),new Vector3(halfWidth*2,5,1),facade);
            f.transform.rotation=Quaternion.Euler(0,sign==1?0:180,0);
            for(float x=-halfWidth;x<=halfWidth;x+=12)
            {
                g.Rod(new Vector3(x,0,sign*91),new Vector3(x,21,sign*91),.19f,g.Steel);
                g.Rod(new Vector3(x,20,sign*91),new Vector3(x,17,sign*65),.13f,g.Steel);
                g.Rod(new Vector3(x,17,sign*91),new Vector3(x,17,sign*65),.08f,g.Steel);
            }
            var canopy=g.Box(new Vector3(0,18.6f,sign*80),new Vector3(halfWidth*2+5,.4f,31),green);
            canopy.transform.rotation=Quaternion.Euler(-sign*7,0,0);
            g.Box(new Vector3(0,17,sign*64.5f),new Vector3(halfWidth*2,.8f,.3f),green);
            // Glass balustrades, sectional bays and access aisles give the seating
            // a supported architectural structure instead of floating rows.
            for(float x=-halfWidth+1;x<halfWidth;x+=24)
            {
                for(int tier=0;tier<2;tier++)
                {
                    float by=1.1f+tier*7.7f,bz=sign*(67+tier*12);
                    g.Rod(new Vector3(x,by+1,bz),new Vector3(x,by+6.2f,bz+sign*8.6f),.035f,g.Steel);
                    for(int step=0;step<10;step++)g.Rod(new Vector3(x,by+step*.57f,bz+sign*step*.92f),new Vector3(x,by+step*.57f+1,bz+sign*step*.92f),.025f,g.Steel);
                }
                g.Box(new Vector3(x,16,sign*90.65f),new Vector3(.16f,4.7f,.16f),g.Steel);
            }
            for(float x=-halfWidth+12;x<halfWidth;x+=28)
                AdFace("grandstand",new Vector3(x,17,sign*64.3f),Quaternion.Euler(0,sign==1?0:180,0),24,2);
            // Two roof pavilions give the racecourse a recognizable silhouette.
            foreach(float x in new[]{-halfWidth*.6f,halfWidth*.6f})
            {
                g.Box(new Vector3(x,23,sign*85),new Vector3(7,6,7),cream);
                var roof=g.Box(new Vector3(x,26.5f,sign*85),new Vector3(8,.55f,8),green);roof.transform.rotation=Quaternion.Euler(0,45,0);
                g.Rod(new Vector3(x,26.5f,sign*85),new Vector3(x,32,sign*85),.1f,gold);
                g.Box(new Vector3(x+1,30.5f,sign*85),new Vector3(2,1,.03f),green);
            }
        }
        void Landscape()
        {
            var g=Geometry;
            // Mown infield stripes stay away from the race lanes.
            var cut=g.Material("Infield mowing stripes",new Color(.55f,.64f,.46f));
            cut.SetTexture("_BaseMap",Resources.Load<Texture2D>("Horse/Textures/grass-color"));
            for(int i=0;i<9;i++)
            {
                float x=-64+i*16;var turfVertices=new[]{new Vector3(x-4,-.06f,-28.5f),new Vector3(x-4,-.06f,28.5f),new Vector3(x+4,-.06f,28.5f),new Vector3(x+4,-.06f,-28.5f)};
                var turfUv=new Vector2[4];for(int k=0;k<4;k++)turfUv[k]=new Vector2(turfVertices[k].x/13,turfVertices[k].z/13);
                Mesh("Mown turf",turfVertices,turfUv,new[]{0,1,2,0,2,3},cut).shadowCastingMode=ShadowCastingMode.Off;
            }
            var foliage=g.Material("Clipped hedge",new Color(.10f,.2f,.085f));
            foreach(int sign in new[]{-1,1})
            {
                for(int i=0;i<24;i++)g.Primitive(PrimitiveType.Sphere,new Vector3(-112+i*9.8f,1,sign*111),new Vector3(10,2.1f,2.3f),foliage);
                // Entrance concourse and small hospitality marquees behind each stand.
                for(int i=0;i<5;i++)
                {
                    float x=-88+i*44;
                    g.Box(new Vector3(x,2,sign*107),new Vector3(12,4,8),cream);
                    var roof=g.Box(new Vector3(x,4.5f,sign*107),new Vector3(13,.4f,9),green);
                    g.Box(new Vector3(x,1.8f,sign*102.95f),new Vector3(8,2.7f,.1f),g.Dark);
                }
            }
            // Perimeter earthworks break up the otherwise empty flat horizon.
            const int steps=72;var v=new Vector3[(steps+1)*3];var uv=new Vector2[v.Length];var tris=new List<int>();
            for(int i=0;i<=steps;i++)
            {
                float a=i*Mathf.PI*2/steps;
                for(int r=0;r<3;r++)
                {
                    float radius=205+r*90,height=r==1?11+8*Mathf.Sin(a*3+1)+4*Mathf.Sin(a*7):-.1f;
                    int k=i*3+r;v[k]=new Vector3(Mathf.Cos(a)*radius,height,Mathf.Sin(a)*radius*.82f);uv[k]=new Vector2(v[k].x/9,v[k].z/9);
                    if(i<steps&&r<2)tris.AddRange(new[]{k,k+3,k+1,k+1,k+3,k+4});
                }
            }
            Mesh("Perimeter earthworks",v,uv,tris.ToArray(),g.Grass);
        }
        void Floodlight(Vector3 p)
        {
            var g=Geometry;g.Box(p+Vector3.up*14,new Vector3(.3f,28,.3f),g.Steel);
            g.Box(p+Vector3.up*28,new Vector3(5,2,.5f),g.Dark);
            for(int x=0;x<5;x++)for(int y=0;y<2;y++)g.Box(p+new Vector3(-2+x,27.5f+y,-.28f),new Vector3(.68f,.65f,.08f),g.LightPanel);
            var lamp=new GameObject("Track floodlight").AddComponent<Light>();lamp.transform.SetParent(root,false);lamp.transform.position=p+Vector3.up*27;
            lamp.type=LightType.Spot;lamp.range=145;lamp.spotAngle=100;lamp.innerSpotAngle=65;lamp.intensity=12;lamp.color=new Color(.82f,.9f,1);lamp.shadows=LightShadows.None;
            lamp.transform.LookAt(new Vector3(p.x*.8f,0,p.z*.4f));lamp.enabled=false;lamps.Add(lamp);
        }
        MeshRenderer Mesh(string name,Vector3[] v,Vector2[] uv,int[] triangles,Material material)
        {
            var go=new GameObject(name);go.transform.SetParent(root,false);
            var m=new Mesh{name=name,indexFormat=IndexFormat.UInt32,vertices=v,uv=uv,triangles=triangles};m.RecalculateNormals();m.RecalculateBounds();
            go.AddComponent<MeshFilter>().sharedMesh=m;var r=go.AddComponent<MeshRenderer>();r.sharedMaterial=material;return r;
        }
        void AdFace(string slot,Vector3 p,Quaternion rotation,float width,float height)
        {
            var face=Geometry.Primitive(PrimitiveType.Quad,p,new Vector3(width,height,1),adMaterials[slot]);face.transform.rotation=rotation;
            var label=Label("WORLD RACING",p+rotation*Vector3.back*.012f,rotation,height*.24f,Color.white,root);adLabels[slot].Add(label);
        }
        public void Sponsor(string slot,string encoded)
        {
            if(!adMaterials.TryGetValue(slot,out var mat))return;
            Texture2D texture=null;
            if(!string.IsNullOrEmpty(encoded))
            {
                if(encoded.Length>2800000)return;
                texture=new Texture2D(2,2,TextureFormat.RGBA32,false);
                if(!texture.LoadImage(System.Convert.FromBase64String(encoded))){Object.Destroy(texture);return;}
                texture.wrapMode=TextureWrapMode.Clamp;
            }
            if(mat.GetTexture("_BaseMap"))Object.Destroy(mat.GetTexture("_BaseMap"));
            mat.SetTexture("_BaseMap",texture);mat.SetColor("_BaseColor",texture?Color.white:new Color(.045f,.14f,.12f));
            foreach(var label in adLabels[slot])label.SetActive(!texture);
        }
        public static GameObject Label(string text,Vector3 position,Quaternion rotation,float size,Color color,Transform parent=null)
        {
            var go=new GameObject(text);if(parent)go.transform.SetParent(parent,false);go.transform.localPosition=position;go.transform.localRotation=rotation;
            var t=go.AddComponent<TextMesh>();t.font=Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            if(!textMaterial)
            {
                t.font.RequestCharactersInTexture("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 /.-",64,FontStyle.Normal);
                textMaterial=new Material(Resources.Load<Material>("HorseText"));textMaterial.mainTexture=t.font.material.mainTexture;
                Font.textureRebuilt+=font=>{if(textMaterial)textMaterial.mainTexture=font.material.mainTexture;};
            }
            t.text=text;t.fontSize=64;t.characterSize=size*10/64;t.anchor=TextAnchor.MiddleCenter;t.color=color;
            var r=go.GetComponent<MeshRenderer>();r.sharedMaterial=textMaterial;r.shadowCastingMode=ShadowCastingMode.Off;
            return go;
        }
    }
}
