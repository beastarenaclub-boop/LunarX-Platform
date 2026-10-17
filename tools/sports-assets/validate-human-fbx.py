"""Verify the actual exported UV0, not just the Blender viewport UV selection."""
import bpy,os,numpy as np
root=os.path.abspath('artifacts/unity-sports/Assets/Resources/Sports')
for name in ['FootballPlayer','CricketPlayer']:
 bpy.ops.wm.read_factory_settings(use_empty=True)
 bpy.ops.import_scene.fbx(filepath=os.path.join(root,name+'.fbx'),use_anim=True)
 if name=='FootballPlayer':
  names=[a.name for a in bpy.data.actions]
  assert any(n.endswith('Pass') for n in names) and any(n.endswith('Kick') for n in names),(name,'Missing football/shared motion',names)
  print('FBX_ACTIONS_PASS',','.join(names))
 image=bpy.data.images.load(os.path.join(root,'Textures/FootballKit.png' if name=='FootballPlayer' else 'Textures/HumanAtlas.png'));w,h=image.size
 pixels=np.empty(len(image.pixels),dtype=np.float32);image.pixels.foreach_get(pixels)
 meshes=[o for o in bpy.data.objects if o.type=='MESH'];assert len(meshes)==3
 for o in meshes:
  assert len(o.data.uv_layers)==1,(name,o.name,'Expected one UV channel')
  samples=[]
  for p in o.data.polygons:
   if not o.data.materials[p.material_index].name.startswith('FootballUniform' if name=='FootballPlayer' else 'HumanUniform'):continue
   if not all(1.2<(o.matrix_world@o.data.vertices[i].co).z<1.4 for i in p.vertices):continue
   for i in p.loop_indices:
    u,v=o.data.uv_layers[0].data[i].uv;x=min(w-1,int(u%1*w));y=min(h-1,int(v%1*h));samples.append(float(np.mean(pixels[(y*w+x)*4:(y*w+x)*4+3])))
  mean=sum(samples)/max(1,len(samples));assert samples and mean>(.45 if name=='FootballPlayer' else .65),(name,o.name,'Incorrect atlas coordinates',len(samples),mean)
  print('FBX_UV0_PASS',name,o.name,len(samples),round(mean,3))
