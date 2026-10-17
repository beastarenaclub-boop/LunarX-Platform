import bpy,os,json
root=os.path.abspath('.cache/horse-realism-v3/people')
report={}
for key in ['eric_001','carla_001','claudia_002']:
    person,version=key.split('_');name=f'rp_{person}_rigged_{version}'
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=f'{root}/{name}_FBX/{name}_zup_a.fbx')
    arm=next(o for o in bpy.data.objects if o.type=='ARMATURE')
    report[key]={'armature':arm.name,'matrix':[list(row) for row in arm.matrix_world],
      'bones':{b.name:{'head':list(arm.matrix_world@b.head_local),'tail':list(arm.matrix_world@b.tail_local)} for b in arm.data.bones if not any(s in b.name.lower() for s in ['finger','thumb','index','middle','ring','pinky'])},
      'meshes':[{ 'name':o.name,'dims':list(o.dimensions),'materials':[m.name for m in o.data.materials]} for o in bpy.data.objects if o.type=='MESH']}
with open('.cache/horse-realism-v3/people-inspection.json','w') as f:json.dump(report,f,indent=2)
print('PEOPLE_INSPECTED')
