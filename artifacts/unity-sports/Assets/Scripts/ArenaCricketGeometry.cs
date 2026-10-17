using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

namespace ArenaSports
{
    public sealed partial class ArenaGeometry
    {
        public void CricketGround()
        {
            Grass.SetColor("_BaseColor",new(.50f,1.02f,.43f));
            Grass.SetTextureScale("_BaseMap",new(90,75));
            Grass.SetTextureScale("_BumpMap",new(90,75));
            var stripe=Material("Cricket mowing stripes",Color.white);
            stripe.CopyPropertiesFromMaterial(Grass);stripe.SetColor("_BaseColor",new(.46f,.93f,.39f));
            // Adjacent strips share vertices in the same plane; an overlapping
            // base plane would produce z-fighting from the stadium camera.
            for(int band=0;band<20;band++)
            {
                var v=new List<Vector3>();var uv=new List<Vector2>();var tris=new List<int>();
                for(int j=0;j<=16;j++)
                {
                    float x=Mathf.Lerp(-100+band*10, -90+band*10,j/16f);
                    float z=85*Mathf.Sqrt(Mathf.Max(0,1-x*x/(100*100)));
                    v.Add(new(x,-.012f,-z));v.Add(new(x,-.012f,z));
                    uv.Add(new(x/200+.5f,-z/170+.5f));uv.Add(new(x/200+.5f,z/170+.5f));
                    if(j<16){int k=j*2;tris.AddRange(new[]{k,k+1,k+2,k+2,k+1,k+3});}
                }
                var strip=MeshObject("Mown outfield",v.ToArray(),uv.ToArray(),tris.ToArray(),band%2==0?Grass:stripe,true);
                strip.GetComponent<MeshFilter>().sharedMesh.RecalculateTangents();
            }
            var square=Material("Practice wicket square",Color.white);
            square.CopyPropertiesFromMaterial(Grass);square.SetColor("_BaseColor",new(.65f,.87f,.44f));
            square.SetTextureScale("_BaseMap",new(13,4.5f));square.SetTextureScale("_BumpMap",new(13,4.5f));
            Surface(26,9,square,.006f);
            var wicket=Material("Rolled cricket wicket",Color.white,.06f);
            wicket.SetTexture("_BaseMap",Resources.Load<Texture2D>("CricketWicket"));
            MeshObject("Match wicket",new[]{new Vector3(-11.4f,.018f,-1.525f),new Vector3(-11.4f,.018f,1.525f),new Vector3(11.4f,.018f,1.525f),new Vector3(11.4f,.018f,-1.525f)},
                new[]{new Vector2(0,0),new Vector2(0,1),new Vector2(1,1),new Vector2(1,0)},new[]{0,1,2,0,2,3},wicket,true);
            var rope=Material("Boundary rope",new(.86f,.82f,.66f));
            for(int i=0;i<240;i++)
            {
                float a=i*Mathf.PI*2/240,b=(i+1)*Mathf.PI*2/240;
                Rod(new(Mathf.Cos(a)*73,.045f,Mathf.Sin(a)*60),new(Mathf.Cos(b)*73,.045f,Mathf.Sin(b)*60),.035f,rope);
            }
            // Fine geometry is limited to the pitch apron and fades by distance.
            CricketGrass();
        }
        void CricketGrass()
        {
            var mat=Material("Close cricket turf",new(.16f,.25f,.06f),.04f);mat.SetFloat("_Cull",0);
            var verts=new List<Vector3>();var uv=new List<Vector2>();var indices=new List<int>();
            var random=new System.Random(1758);
            for(int i=0;i<14500;i++)
            {
                float x=(float)random.NextDouble()*38-19,z=(float)random.NextDouble()*24-12;
                if(Mathf.Abs(x)<13.1f&&Mathf.Abs(z)<6.1f)continue;
                float h=.018f+(float)random.NextDouble()*.025f,w=.006f;
                int k=verts.Count;float lean=(float)random.NextDouble()*.025f;
                verts.Add(new(x-w,0,z));verts.Add(new(x+w,0,z));verts.Add(new(x+lean,h,z+.01f));
                uv.Add(Vector2.zero);uv.Add(Vector2.right);uv.Add(Vector2.up);indices.AddRange(new[]{k,k+2,k+1});
            }
            var go=MeshObject("Pitch-side grass blades",verts.ToArray(),uv.ToArray(),indices.ToArray(),mat,false);
            var renderer=go.GetComponent<MeshRenderer>();renderer.shadowCastingMode=ShadowCastingMode.Off;
            var lod=go.AddComponent<LODGroup>();lod.SetLODs(new[]{new LOD(.30f,new Renderer[]{renderer})});lod.RecalculateBounds();
        }
        public void CricketStadium()
        {
            const float rx=82,rz=69;
            Surface(280,250,Dark,-.09f);
            var seat=Material("Cricket ivory seating",new(.38f,.43f,.41f));
            var concrete=PhotographicSurface("Stadium concrete","stadium-concrete",new(.78f,.77f,.69f),new(100,2));
            var roof=Material("Canopy panels",new(.72f,.77f,.78f),.28f,.1f);
            roof.SetTexture("_BumpMap",Resources.Load<Texture2D>("Sports/Textures/stadium-metal-normal"));
            roof.SetTextureScale("_BumpMap",new(8,5));roof.SetFloat("_BumpScale",.18f);roof.EnableKeyword("_NORMALMAP");
            roof.SetFloat("_Cull",0);
            var fascia=Material("Stadium fascia",new(.12f,.19f,.18f),.2f);
            var glass=Material("Cricket pavilion glass",new(.15f,.25f,.28f),.72f,.25f);
            var led=new Material(Resources.Load<Material>("ArenaLED"));materials.Add(led);
            for(int tier=0;tier<3;tier++)
            {
                float offset=tier*13,floor=2+tier*8;
                for(int row=0;row<10;row++)
                {
                    float x=rx+3+offset+row*.95f,z=rz+3+offset+row*.95f,y=floor+row*.63f;
                    Ring(x,z,y,x+.95f,z+.95f,y,seat);
                    Ring(x,z,y-.63f,x,z,y,concrete);
                }
                Ring(rx+13+offset,rz+13+offset,floor+6.2f,rx+13+offset,rz+13+offset,floor+7.2f,fascia);
                Ring(rx+13+offset,rz+13+offset,floor+6.35f,rx+13+offset,rz+13+offset,floor+6.85f,led,false,64);
                if(tier<2)Ring(rx+13+offset,rz+13+offset,floor+7.2f,rx+13+offset,rz+13+offset,floor+8,glass);
            }
            Crowd(rx,rz,false);
            // Separate scalloped canopy bays, with visible ribs and open sky.
            for(int bay=0;bay<20;bay++)
            {
                var verts=new List<Vector3>();var uv=new List<Vector2>();var triangles=new List<int>();
                for(int j=0;j<=12;j++)
                {
                    float u=j/12f,a=(bay+u*.975f)*Mathf.PI*2/20,arch=Mathf.Sin(u*Mathf.PI);
                    verts.Add(StadiumPoint(a,rx-1,rz-1,29+arch*4.3f,false));
                    verts.Add(StadiumPoint(a,rx+43,rz+43,34+arch*1.8f,false));
                    uv.Add(new(u,0));uv.Add(new(u,1));
                    if(j<12){int k=j*2;triangles.AddRange(new[]{k,k+2,k+1,k+1,k+2,k+3});}
                    if(j>0)Rod(verts[(j-1)*2],verts[j*2],.14f,Steel);
                }
                var canopy=MeshObject("Scalloped cricket canopy",verts.ToArray(),uv.ToArray(),triangles.ToArray(),roof,true);
                canopy.GetComponent<MeshFilter>().sharedMesh.RecalculateTangents();
                float angle=bay*Mathf.PI*2/20;
                Vector3 inner=StadiumPoint(angle,rx-1,rz-1,29,false),outer=StadiumPoint(angle,rx+43,rz+43,34,false);
                Rod(new(outer.x,0,outer.z),outer,.27f,Steel);Rod(inner,outer,.18f,Steel);
                Rod(inner-Vector3.up,outer-Vector3.up*1.5f,.10f,Steel);
                for(int i=0;i<8;i++)Rod(Vector3.Lerp(inner,outer,i/8f),Vector3.Lerp(inner,outer,(i+1)/8f)-Vector3.up*1.3f,.045f,Steel);
                Box(inner-Vector3.up*.65f,new(3.2f,.15f,.7f),LightPanel);
            }
            Ring(rx+43,rz+43,0,rx+43,rz+43,34,concrete);
            for(int i=0;i<72;i++)
            {
                float a=(i+.5f)*Mathf.PI*2/72;
                Vector3 p=StadiumPoint(a,rx-3,rz-3,.52f,false);
                var board=Box(p,new(6.2f,.9f,.12f),led);
                board.transform.rotation=Quaternion.LookRotation(new Vector3(-p.x/(rx*rx),0,-p.z/(rz*rz)));
            }
            foreach(int side in new[]{-1,1})
            {
                // White sight screens sit behind each bowler's arm.
                Box(new(side*78,3.2f,0),new(.3f,6.4f,12),White);
                Box(new(side*109,18,0),new(1,7,15),Dark);
                Box(new(side*108.4f,18,0),new(.12f,6.3f,14.2f),led);
                for(int z=-5;z<=5;z+=10)Rod(new(side*79,0,z),new(side*79,6.8f,z),.11f,Steel);
            }
            for(int i=0;i<4;i++)
            {
                float a=(i+.5f)*Mathf.PI/2;Vector3 p=StadiumPoint(a,116,102,0,false);
                Rod(p,p+Vector3.up*49,.43f,White);
                var bank=new GameObject("Cricket floodlight bank").transform;bank.SetParent(Root,false);
                bank.position=p+Vector3.up*49;bank.LookAt(new Vector3(0,25,0));
                Box(Vector3.zero,new(8,4,.35f),Dark,bank);
                for(int x=-3;x<=3;x+=2)for(int y=-1;y<=1;y++)Box(new(x,y,.23f),new(1.35f,.65f,.08f),LightPanel,bank);
            }
        }
        public GameObject CricketCap(Material mat,bool helmet,Transform parent)
        {
            var v=new List<Vector3>();var uv=new List<Vector2>();var indices=new List<int>();
            const int rows=8,segments=24;
            for(int y=0;y<=rows;y++)for(int x=0;x<=segments;x++)
            {
                float theta=y/(float)rows*Mathf.PI*.53f,a=x/(float)segments*Mathf.PI*2;
                v.Add(new(Mathf.Cos(a)*Mathf.Sin(theta)*.112f,Mathf.Cos(theta)*.14f,Mathf.Sin(a)*Mathf.Sin(theta)*.123f));
                uv.Add(new(x/(float)segments,y/(float)rows));
                if(y<rows&&x<segments){int k=y*(segments+1)+x;indices.AddRange(new[]{k,k+1,k+segments+1,k+1,k+segments+2,k+segments+1});}
            }
            var cap=MeshObject(helmet?"Batting helmet":"Fielding cap",v.ToArray(),uv.ToArray(),indices.ToArray(),mat,false);
            cap.transform.SetParent(parent,false);
            var brim=Box(new(0,-.005f,.105f),new(.19f,.013f,.13f),mat,cap.transform,false);
            brim.transform.localRotation=Quaternion.Euler(9,0,0);
            if(helmet)
            {
                foreach(int side in new[]{-1,1})
                {
                    Box(new(side*.105f,-.07f,-.015f),new(.025f,.15f,.10f),mat,cap.transform,false);
                    Rod(new(side*.10f,-.015f,.07f),new(side*.09f,-.16f,.15f),.005f,Steel,cap.transform,false);
                }
                for(int i=0;i<3;i++)Rod(new(-.09f,-.07f-i*.037f,.15f),new(.09f,-.07f-i*.037f,.15f),.004f,Steel,cap.transform,false);
            }
            return cap;
        }
        public void BatchEquipment(Transform root)
        {
            var filters=root.GetComponentsInChildren<MeshFilter>();
            var groups=new Dictionary<Material,List<CombineInstance>>();
            foreach(var filter in filters)
            {
                var mat=filter.GetComponent<MeshRenderer>().sharedMaterial;
                if(!groups.ContainsKey(mat))groups[mat]=new();
                groups[mat].Add(new CombineInstance{mesh=filter.sharedMesh,transform=root.worldToLocalMatrix*filter.transform.localToWorldMatrix});
            }
            foreach(var pair in groups)
            {
                var mesh=new Mesh{name="Cricket equipment batch",indexFormat=IndexFormat.UInt32};
                mesh.CombineMeshes(pair.Value.ToArray());meshes.Add(mesh);
                var go=new GameObject(pair.Key.name);go.transform.SetParent(root,false);
                go.AddComponent<MeshFilter>().sharedMesh=mesh;go.AddComponent<MeshRenderer>().sharedMaterial=pair.Key;
            }
            foreach(var filter in filters){Object.Destroy(filter.GetComponent<MeshRenderer>());Object.Destroy(filter);}
        }
    }
}
