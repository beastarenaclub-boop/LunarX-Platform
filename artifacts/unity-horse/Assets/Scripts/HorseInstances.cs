using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

namespace HorseRacing
{
    // The crowd consists of seated human meshes. Instancing reuses their geometry
    // instead of allocating a GameObject and material for every spectator.
    public sealed class HorseInstances
    {
        sealed class Part { public Mesh mesh; public int sub; public Material material; public Matrix4x4 local; }
        sealed class Batch { public Part part; public Matrix4x4[] transforms; public Bounds bounds; }
        readonly List<Part[]> variants = new();
        readonly List<Matrix4x4>[] placements;
        readonly List<Batch> batches = new();
        readonly bool shadows;
        readonly Plane[] planes=new Plane[6];
        static readonly Color[] shirts = {
            new Color(.54f,.19f,.12f), new Color(.12f,.22f,.36f), new Color(.66f,.61f,.51f),
            new Color(.19f,.3f,.22f), new Color(.42f,.34f,.42f), new Color(.72f,.73f,.7f),
            new Color(.27f,.29f,.3f), new Color(.55f,.38f,.18f)
        };
        public int Count { get; private set; }
        public HorseInstances(string resource, bool crowd, bool castShadows)
        {
            shadows=castShadows;
            var prefab=Resources.Load<GameObject>(resource);
            placements=new List<Matrix4x4>[crowd?8:1];
            for(int variant=0;variant<placements.Length;variant++)
            {
                placements[variant]=new List<Matrix4x4>();var parts=new List<Part>();
                foreach(var filter in prefab.GetComponentsInChildren<MeshFilter>())
                {
                    var renderer=filter.GetComponent<MeshRenderer>();if(!renderer)continue;
                    for(int sub=0;sub<filter.sharedMesh.subMeshCount;sub++)
                    {
                        var mat=new Material(renderer.sharedMaterials[sub]);mat.enableInstancing=true;
                        if(crowd)
                        {
                            if(mat.name.Contains("Shirt"))mat.SetColor("_BaseColor",shirts[variant]);
                            if(mat.name.Contains("Pants"))mat.SetColor("_BaseColor",Color.Lerp(new Color(.07f,.1f,.14f),new Color(.33f,.3f,.24f),variant/10f));
                            if(mat.name.Contains("Skin"))mat.SetColor("_BaseColor",Color.Lerp(Color.white,new Color(.56f,.35f,.23f),(variant%4)/4f));
                            if(mat.name.Contains("Hair"))mat.SetColor("_BaseColor",variant==5?new Color(.42f,.39f,.34f):new Color(.05f,.035f,.02f));
                        }
                        // FBX root transforms contain the Blender-to-Unity axis
                        // conversion, including for single-mesh model assets.
                        parts.Add(new Part{mesh=filter.sharedMesh,sub=sub,material=mat,local=filter.transform.localToWorldMatrix});
                    }
                }
                variants.Add(parts.ToArray());
            }
        }
        public void Add(Vector3 position, Quaternion rotation, Vector3 scale, int variant=0)
        {
            placements[Mathf.Abs(variant)%placements.Length].Add(Matrix4x4.TRS(position,rotation,scale));Count++;
        }
        public void Prepare()
        {
            batches.Clear();
            for(int variant=0;variant<placements.Length;variant++)
            {
                // Keep both grandstands and small seating sections in separate
                // bounds; a visible seat must not submit the entire arena.
                var cells=new Dictionary<Vector2Int,List<Matrix4x4>>();
                foreach(var matrix in placements[variant])
                {
                    var p=matrix.GetColumn(3);var key=new Vector2Int(Mathf.FloorToInt(p.x/32),Mathf.FloorToInt(p.z/32));
                    if(!cells.ContainsKey(key))cells[key]=new();cells[key].Add(matrix);
                }
                foreach(var cell in cells.Values)foreach(var part in variants[variant])
                for(int offset=0;offset<cell.Count;offset+=250)
                {
                    int count=Mathf.Min(250,cell.Count-offset);var matrices=new Matrix4x4[count];var bounds=new Bounds();
                    for(int i=0;i<count;i++)
                    {
                        var m=matrices[i]=cell[offset+i]*part.local;
                        var b=part.mesh.bounds;var e=b.extents;
                        var x=m.MultiplyVector(new Vector3(e.x,0,0));var y=m.MultiplyVector(new Vector3(0,e.y,0));var z=m.MultiplyVector(new Vector3(0,0,e.z));
                        var extent=new Vector3(Mathf.Abs(x.x)+Mathf.Abs(y.x)+Mathf.Abs(z.x),Mathf.Abs(x.y)+Mathf.Abs(y.y)+Mathf.Abs(z.y),Mathf.Abs(x.z)+Mathf.Abs(y.z)+Mathf.Abs(z.z));
                        var world=new Bounds(m.MultiplyPoint3x4(b.center),extent*2);
                        if(i==0)bounds=world;else bounds.Encapsulate(world);
                    }
                    batches.Add(new Batch{part=part,transforms=matrices,bounds=bounds});
                }
            }
        }
        public void Draw(Camera camera)
        {
            GeometryUtility.CalculateFrustumPlanes(camera,planes);
            foreach(var batch in batches)
                if(GeometryUtility.TestPlanesAABB(planes,batch.bounds))
                Graphics.DrawMeshInstanced(batch.part.mesh,batch.part.sub,batch.part.material,batch.transforms,batch.transforms.Length,null,shadows?ShadowCastingMode.On:ShadowCastingMode.Off,true,0,camera,LightProbeUsage.Off);
        }
    }
}
