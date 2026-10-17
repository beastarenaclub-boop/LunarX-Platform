"""Normalize cached atlas models to the single UV channel expected by Unity."""
import bpy,os,math,json,ast,numpy as np
ROOT=os.getcwd();OUT=os.path.join(ROOT,'artifacts/unity-sports/Assets/Resources/Sports')
tree=ast.parse(open('tools/sports-assets/upgrade-unity-human.py').read())
for node in tree.body:
 if isinstance(node,ast.FunctionDef) and node.name in ['activate','export']:
  exec(compile(ast.Module(body=[node],type_ignores=[]),'<human export>','exec'))
for file,name,source in [('human-football.blend','FootballPlayer','human-football-atlas-source.blend'),('human-upgrade.blend','CricketPlayer','human-cricket-atlas-source.blend')]:
 path=os.path.abspath('.cache/football-pro/'+file);bpy.ops.wm.open_mainfile(filepath=os.path.abspath('.cache/football-pro/'+source))
 arm=bpy.data.objects['FootballRig'];human=bpy.data.objects['Athlete_LOD0']
 atlas=next(uv for uv in human.data.uv_layers if uv.active_render)
 values=np.empty(len(human.data.loops)*2,dtype=np.float32);atlas.data.foreach_get('uv',values)
 while human.data.uv_layers:human.data.uv_layers.remove(human.data.uv_layers[0])
 uv=human.data.uv_layers.new(name='UVMap');uv.data.foreach_set('uv',values);uv.active_render=True
 actual=np.empty_like(values);uv.data.foreach_get('uv',actual);assert np.array_equal(actual,values),'Atlas coordinates were changed'
 if name=='FootballPlayer' and not human.get('hem_corrected'):
  uniform_vertices={i for p in human.data.polygons if p.material_index==2 for i in p.vertices}
  for i in uniform_vertices:
   v=human.data.vertices[i]
   if .62<v.co.z<.82:v.co.z-=.045*min(1,(.82-v.co.z)/.12)
  human['hem_corrected']=True
 bpy.ops.wm.save_as_mainfile(filepath=path);export(name)
 print('UNITY_UV0_VERIFIED',name,len(human.data.uv_layers))
