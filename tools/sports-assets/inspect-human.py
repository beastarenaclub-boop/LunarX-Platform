import bpy,os,json
from mathutils import Vector
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.abspath('.cache/horse-realism/vitruvian_head.glb'))
for o in bpy.data.objects:
 if o.type=='MESH':
  points=[o.matrix_world@Vector(v) for v in o.bound_box]
  print('HEAD_PART',json.dumps({'name':o.name,'verts':len(o.data.vertices),'materials':[m.name for m in o.data.materials],'min':[min(v[i] for v in points) for i in range(3)],'max':[max(v[i] for v in points) for i in range(3)]}))
bpy.ops.wm.open_mainfile(filepath=os.path.abspath('.cache/football-pro/football-rig.blend'))
for o in bpy.data.objects:
 if o.type=='MESH':print('CURRENT_PART',o.name,len(o.data.vertices),[m.name for m in o.data.materials])
