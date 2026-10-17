"""Bake the fixed mounted rider and reduce subpixel geometry for live racing.
The horse remains skeletal; rider bounce remains a runtime group transform.
Run Blender --background --disable-autoexec --python this-file from the repo.
"""
import bpy, os, json, math
from mathutils import Matrix

bpy.ops.wm.read_factory_settings(use_empty=True)
root=os.path.abspath('artifacts/3d-game/public/assets/horse-racing/realistic')
source=os.path.join(root,'racewear/jockey-racewear-v2.glb')
bpy.ops.import_scene.gltf(filepath=source)
bpy.context.scene.frame_set(1)
bpy.context.view_layer.update()
arm=next(o for o in bpy.data.objects if o.type=='ARMATURE')
anchors={b.name:arm.matrix_world@b.matrix for b in arm.pose.bones
         if b.name in ['mixamorig:Head','mixamorig:LeftHand','mixamorig:RightHand','mixamorigHead','mixamorigLeftHand','mixamorigRightHand']}
assert len(anchors)==3, list(anchors)
for o in list(bpy.data.objects):
    if o.type=='MESH' and not o.data.materials:bpy.data.objects.remove(o,do_unlink=True)
meshes=[o for o in bpy.data.objects if o.type=='MESH']
report={'source':'racewear/jockey-racewear-v2.glb','license':'CC0 Vitruvian / CharMorph',
        'changes':['baked unchanged mounted pose','retained head and hand attachment transforms','reduced race-distance topology with UVs and normals preserved'], 'meshes':{}}
for o in meshes:
    bpy.context.view_layer.objects.active=o
    before=sum(len(p.vertices)-2 for p in o.data.polygons)
    for modifier in list(o.modifiers):
        if modifier.type=='ARMATURE': bpy.ops.object.modifier_apply(modifier=modifier.name)
    world=o.matrix_world.copy();o.parent=None;o.matrix_world=world
    name=o.name.lower()
    face=any(m and m.name=='VitSkin' for m in o.data.materials)
    target=6000 if name=='shirt' else 4000 if name=='pants' else 4200 if face else 2400 if name=='cm_vitruvian' else 1400 if 'gloves' in name else 1200 if 'sleeves' in name else 240
    if before>target:
        mod=o.modifiers.new('Live race topology budget','DECIMATE')
        mod.ratio=target/before
        mod.use_collapse_triangulate=True
        bpy.ops.object.modifier_apply(modifier=mod.name)
    o.data.calc_loop_triangles()
    after=len(o.data.loop_triangles)
    assert after>0 and all(math.isfinite(c) for v in o.data.vertices for c in v.co)
    report['meshes'][o.name]={'before':before,'after':after}

# The mounted pose never animated in the previous renderer. Plain meshes avoid
# uploading eight unused 52-bone palettes every frame without losing motion.
for o in list(bpy.data.objects):
    if o.type!='MESH':bpy.data.objects.remove(o,do_unlink=True)
for name,transform in anchors.items():
    o=bpy.data.objects.new(name,None);bpy.context.collection.objects.link(o)
    o.matrix_world=transform
    report.setdefault('anchors',{})[name]=list(transform.translation)
report['trianglesBefore']=sum(m['before'] for m in report['meshes'].values())
report['trianglesAfter']=sum(m['after'] for m in report['meshes'].values())
assert report['trianglesAfter']<24000
out=os.path.join(root,'performance');os.makedirs(out,exist_ok=True)
bpy.ops.export_scene.gltf(filepath=os.path.join(out,'jockey-mounted-v3.glb'),export_format='GLB',
    export_animations=False,export_image_format='WEBP',export_image_quality=92,
    export_yup=True,export_morph=False,export_extras=True)
with open(os.path.join(out,'provenance.json'),'w') as f:json.dump(report,f,indent=2)
print('PERFORMANCE_RIDER_VALIDATED',json.dumps(report))
