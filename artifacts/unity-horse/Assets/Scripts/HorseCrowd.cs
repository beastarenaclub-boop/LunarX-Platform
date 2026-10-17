using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

namespace HorseRacing
{
    // Scanned people use textured meshes nearby and rendered impostors at
    // distances where a whole person covers only a few pixels.
    public sealed class HorseCrowd
    {
        sealed class Model { public Mesh near,far;public Matrix4x4 nearLocal,farLocal;public Material skin,card; }
        sealed class Section { public int person;public Bounds bounds;public Matrix4x4[] near,far,cards; }
        readonly Model[] models=new Model[3];
        readonly Dictionary<(int person,int x,int z),List<Matrix4x4>> placements=new();
        readonly List<Section> sections=new();readonly Plane[] planes=new Plane[6];readonly Mesh quad;
        public int Count{get;private set;}
        public HorseCrowd()
        {
            int i=0;foreach(string name in new[]{"Eric","Carla","Claudia"})
            {
                var near=Resources.Load<GameObject>("Horse/Crowd/"+name+"Near").GetComponentInChildren<MeshFilter>();
                var far=Resources.Load<GameObject>("Horse/Crowd/"+name+"Far").GetComponentInChildren<MeshFilter>();
                models[i++]=new Model{near=near.sharedMesh,far=far.sharedMesh,nearLocal=near.transform.localToWorldMatrix,farLocal=far.transform.localToWorldMatrix,skin=Resources.Load<Material>("Horse/Crowd/"+name),card=Resources.Load<Material>("Horse/Crowd/"+name+"Card")};
            }
            quad=new Mesh{name="Seated scan impostor",vertices=new[]{new Vector3(-.8f,-.15f,0),new Vector3(.8f,-.15f,0),new Vector3(.8f,1.45f,0),new Vector3(-.8f,1.45f,0)},uv=new[]{Vector2.zero,Vector2.right,Vector2.one,Vector2.up},triangles=new[]{0,1,2,0,2,3}};
            quad.RecalculateNormals();quad.RecalculateBounds();
        }
        public void Add(Vector3 p,Quaternion q,Vector3 scale,int variant)
        {
            var key=(variant%3,Mathf.FloorToInt(p.x/24),Mathf.FloorToInt(p.z/24));
            if(!placements.ContainsKey(key))placements[key]=new();placements[key].Add(Matrix4x4.TRS(p,q,scale));Count++;
        }
        public void Prepare()
        {
            foreach(var item in placements)
            {
                var model=models[item.Key.person];var card=item.Value.ToArray();var near=new Matrix4x4[card.Length];var far=new Matrix4x4[card.Length];var bounds=new Bounds(card[0].GetColumn(3),new Vector3(2,3,2));
                for(int i=0;i<card.Length;i++){near[i]=card[i]*model.nearLocal;far[i]=card[i]*model.farLocal;bounds.Encapsulate(new Bounds(card[i].GetColumn(3),new Vector3(2,3,2)));}
                sections.Add(new Section{person=item.Key.person,bounds=bounds,near=near,far=far,cards=card});
            }
            placements.Clear();
        }
        public void Draw(Camera camera)
        {
            GeometryUtility.CalculateFrustumPlanes(camera,planes);
            foreach(var section in sections)
            {
                if(!GeometryUtility.TestPlanesAABB(planes,section.bounds))continue;
                float distance=Vector3.Distance(camera.transform.position,section.bounds.center);
                var model=models[section.person];var mesh=distance<48?model.near:distance<105?model.far:quad;
                var matrices=distance<48?section.near:distance<105?section.far:section.cards;
                Graphics.DrawMeshInstanced(mesh,0,distance<105?model.skin:model.card,matrices,matrices.Length,null,ShadowCastingMode.Off,true,0,camera,LightProbeUsage.Off);
            }
        }
    }
}
