"""Author complete race clothing on the licensed, posed Vitruvian rider.
Run Blender --background --disable-autoexec --python this-file from the repo.
Keeps the rider skeleton, face textures, hand positions and mounted animation.
"""
import bpy, bmesh, os, json, math
from mathutils import Vector

bpy.ops.wm.read_factory_settings(use_empty=True)
root=os.path.abspath('artifacts/3d-game/public/assets/horse-racing/realistic')
bpy.ops.import_scene.gltf(filepath=os.path.join(root,'derby/jockey-crouch-v1.glb'))
scene=bpy.context.scene;scene.frame_set(1);bpy.context.view_layer.update()
arm=next(o for o in bpy.data.objects if o.type=='ARMATURE')
out=os.path.abspath('.cache/horse-racewear');os.makedirs(out,exist_ok=True)
for o in list(bpy.data.objects):
    if o.type=='MESH' and not o.data.materials:bpy.data.objects.remove(o,do_unlink=True)

def material(name,color,rough):
    m=bpy.data.materials.new(name);m.use_nodes=True
    bs=m.node_tree.nodes.get('Principled BSDF')
    bs.inputs['Base Color'].default_value=(*color,1)
    bs.inputs['Roughness'].default_value=rough
    return m

silk=bpy.data.materials['VitShirt'].copy();silk.name='RaceSilk'
silk.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=(1,1,1,1)
glove=material('RaceGloves',(.023,.019,.015),.48)
leather=material('RaceBootLeather',(.018,.016,.013),.40)
sole=material('RaceBootSole',(.009,.008,.007),.86)

# Remove polygon-centred white patches: each continuous garment now takes an
# anti-aliased rest-space silk pattern in the renderer. Original cloth UVs stay.
for name in ['Shirt','RacingSleeves']:
    o=bpy.data.objects[name]
    o.data.materials.clear();o.data.materials.append(silk)
    for p in o.data.polygons:p.material_index=0;p.use_smooth=True
    # A modest smoothing pass preserves sewn folds while removing angular
    # elbows left by the earlier decimation.
    bpy.context.view_layer.objects.active=o
    sub=o.modifiers.new('Tailored cloth surface','SUBSURF');sub.levels=1
    bpy.ops.object.modifier_move_up(modifier=sub.name)
    bpy.ops.object.modifier_apply(modifier=sub.name)
    budget=o.modifiers.new('Clothing triangle budget','DECIMATE');budget.ratio=.58
    bpy.ops.object.modifier_move_up(modifier=budget.name)
    bpy.ops.object.modifier_apply(modifier=budget.name)

# Gloves follow the anatomical fingers, not oversized mitten primitives.
body=bpy.data.objects['cm_vitruvian']
hands={g.index for g in body.vertex_groups if 'Hand' in g.name}
weights={v.index:sum(g.weight for g in v.groups if g.group in hands) for v in body.data.vertices}
gloves=body.copy();gloves.data=body.data.copy();gloves.name='FittedRacingGloves';bpy.context.collection.objects.link(gloves)
bm=bmesh.new();bm.from_mesh(gloves.data);bm.verts.ensure_lookup_table()
bmesh.ops.delete(bm,geom=[f for f in bm.faces if sum(weights[v.index] for v in f.verts)/len(f.verts)<.66],context='FACES')
bm.normal_update()
for v in bm.verts:v.co+=v.normal*.0025
bm.to_mesh(gloves.data);bm.free();gloves.data.materials.clear();gloves.data.materials.append(glove)
for p in gloves.data.polygons:p.material_index=0;p.use_smooth=True
assert len(gloves.data.polygons)>100,'Glove topology missing'

# The lower breeches form fitted boot shafts; use a consistent leather material
# across shafts and the existing anatomical shoes, including the foot in stirrup.
pants=bpy.data.objects['Pants']
for i,m in enumerate(pants.data.materials):
    if m.name=='RidingBoots':pants.data.materials[i]=leather
for i,m in enumerate(body.data.materials):
    if m.name=='VitShoes':body.data.materials[i]=leather

# Add restrained knee cloth folds to the breeches. Preserve joint centres and
# weights; the wrinkle displacement remains below 3 mm in rider source units.
for o in [pants]:
    for v in o.data.vertices:
        w=max([g.weight for g in v.groups if 'UpLeg' in o.vertex_groups[g.group].name] or [0])
        if w>.5:
            amount=.0025*math.sin(v.co.z*68+v.co.y*20)*w
            v.co+=v.normal*amount
    for p in o.data.polygons:p.use_smooth=True

points={b.name:list(arm.matrix_world@b.head) for b in arm.pose.bones if b.name.endswith(('Head','LeftHand','RightHand','LeftFoot','RightFoot'))}
assert all(math.isfinite(c) for p in points.values() for c in p)
report={'source':'derby/jockey-crouch-v1.glb','license':'CC0 Vitruvian / CharMorph',
        'changes':['continuous smooth silk garments','weighted fitted finger gloves','consistent tall leather boots','fine breeches folds'],
        'bones':len(arm.pose.bones),'contactPoints':points,
        'meshes':{o.name:len(o.data.polygons) for o in bpy.data.objects if o.type=='MESH'}}
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out,'jockey-racewear-v2.blend'))
bpy.ops.export_scene.gltf(filepath=os.path.join(out,'jockey-racewear-v2.glb'),export_format='GLB',
    export_animations=True,export_animation_mode='ACTIONS',export_image_format='WEBP',export_image_quality=92,
    export_yup=True,export_current_frame=True,export_rest_position_armature=False,export_morph=False)
with open(os.path.join(out,'racewear-validation.json'),'w') as f:json.dump(report,f,indent=2)
print('RACEWEAR_VALIDATED',json.dumps(report))
