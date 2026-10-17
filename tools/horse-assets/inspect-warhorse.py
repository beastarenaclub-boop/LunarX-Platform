import bpy,json,os
bpy.ops.wm.read_factory_settings(use_empty=True)
from pathlib import Path
file=next(Path('.cache/horse-realism-v3/warhorse').rglob('*.glb'))
bpy.ops.import_scene.gltf(filepath=str(file.resolve()))
r={'file':str(file),'objects':[{'name':o.name,'type':o.type,'dimensions':list(o.dimensions),'materials':[m.name for m in o.data.materials] if o.type=='MESH' else []} for o in bpy.data.objects], 'clips':[(a.name,list(a.frame_range)) for a in bpy.data.actions]}
with open('.cache/horse-realism-v3/horse-inspection.json','w') as f:json.dump(r,f,indent=2)
for o in bpy.data.objects:
 if o.type=='ARMATURE': print('BONES',[(b.name,list(o.matrix_world@b.head_local)) for b in o.data.bones])
print('HORSE',r)
