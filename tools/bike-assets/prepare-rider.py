"""Derive a fitted, posed motorcycle rider from this workspace's CC0 human.
Run the bundled Blender with --background --factory-startup --python this-file.
Only writes the new bike game's own asset directory; source assets are retained.
"""
import bpy, bmesh, os, math, json
from mathutils import Vector, Matrix

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.abspath('artifacts/3d-game/public/assets/horse-racing/realistic/racewear/jockey-racewear-v2.glb'))
bpy.context.scene.frame_set(1)
arm=next(o for o in bpy.data.objects if o.type=='ARMATURE')
bpy.context.view_layer.update()
def bone(name): return arm.pose.bones['mixamorig:'+name]
def world(name): return arm.matrix_world@bone(name).head
def aim(name,child,direction):
    b=bone(name);head=b.head.copy()
    target=arm.matrix_world.inverted().to_3x3()@Vector(direction)
    turn=(bone(child).head-head).rotation_difference(target)
    b.matrix=Matrix.Translation(head)@turn.to_matrix().to_4x4()@Matrix.Translation(-head)@b.matrix
    bpy.context.view_layer.update()

# Work in Blender coordinates: the motorcycle points towards -Y, Z is up.
aim('Spine','Spine1',(0,-.90,.43))
aim('Spine1','Spine2',(0,-.96,.28))
aim('Spine2','Neck',(0,-.94,.34))
aim('Neck','Head',(0,-.50,.87))
origin=world('Hips').copy()
offset=Vector((0,.44,1.11))-origin
def pose_chain(upper,lower,end,target,pole):
    a=world(upper);b=world(lower);c=world(end)
    l1=(b-a).length;l2=(c-b).length
    goal=Vector(target)-offset
    direction=goal-a;d=min(direction.length,l1+l2-.002);direction.normalize()
    projected=Vector(pole)-offset-a
    normal=(projected-direction*projected.dot(direction)).normalized()
    along=(l1*l1-l2*l2+d*d)/(2*d)
    rise=math.sqrt(max(0,l1*l1-along*along))
    joint=a+direction*along+normal*rise
    aim(upper,lower,joint-a)
    aim(lower,end,goal-world(lower))

for side,sign in [('Left',1),('Right',-1)]:
    pose_chain(side+'UpLeg',side+'Leg',side+'Foot',(sign*.29,.37,.56),(sign*.52,-.35,.78))
    pose_chain(side+'Arm',side+'ForeArm',side+'Hand',(sign*.33,-.43,1.085),(sign*.7,-.03,1.03))
    aim(side+'Hand',side+'HandMiddle1',(0,-1,-.25))

def mat(name,color,roughness):
    m=bpy.data.materials.new(name);m.diffuse_color=(*color,1);m.use_nodes=True
    n=m.node_tree.nodes.get('Principled BSDF');n.inputs['Base Color'].default_value=(*color,1);n.inputs['Roughness'].default_value=roughness
    return m
leather=mat('SuitLeather',(.018,.024,.034),.66)
boots=mat('BootArmor',(.014,.017,.022),.47)
accent=mat('SuitAccent',(.66,.025,.037),.53)
seam=mat('SuitPanels',(.052,.058,.068),.72)
allowed={'Shirt','RacingSleeves','Pants','cm_vitruvian','FittedRacingGloves'}
baked=[]
depsgraph=bpy.context.evaluated_depsgraph_get()
helmet_position=world('Head')+offset+Vector((0,-.035,.125))
contacts={n:list(world(n)+offset) for n in ['Head','LeftHand','RightHand','LeftFoot','RightFoot']}
for obj in list(bpy.data.objects):
    if obj.type!='MESH' or obj.name not in allowed: continue
    # Hide the anatomical head: a full-face helmet is added by the game renderer.
    if obj.name=='cm_vitruvian':
        head_groups={g.index for g in obj.vertex_groups if any(t in g.name for t in ('Head','Neck'))}
        weights={v.index:sum(g.weight for g in v.groups if g.group in head_groups) for v in obj.data.vertices}
        bm=bmesh.new();bm.from_mesh(obj.data);bm.verts.ensure_lookup_table()
        bmesh.ops.delete(bm,geom=[f for f in bm.faces if sum(weights[v.index] for v in f.verts)/len(f.verts)>.2],context='FACES')
        bm.to_mesh(obj.data);bm.free()
    bpy.context.view_layer.update()
    evaluated=obj.evaluated_get(depsgraph)
    mesh=bpy.data.meshes.new_from_object(evaluated,preserve_all_data_layers=True,depsgraph=depsgraph)
    mesh.transform(obj.matrix_world)
    for v in mesh.vertices: v.co+=offset
    mesh.materials.clear();mesh.materials.append(leather);mesh.materials.append(boots);mesh.materials.append(accent);mesh.materials.append(seam)
    for poly in mesh.polygons:
        centre=sum((mesh.vertices[v].co for v in poly.vertices),Vector())/len(poly.vertices)
        poly.material_index=0
        if centre.z<.73: poly.material_index=1
        if obj.name=='Shirt' and centre.z>1.23 and .18<abs(centre.x)<.201: poly.material_index=2
        if obj.name=='RacingSleeves' and 1.29<centre.z<1.33: poly.material_index=2
        if obj.name=='Pants' and abs(centre.x)>.27 and centre.z>.74: poly.material_index=3
        poly.use_smooth=True
    baked_obj=bpy.data.objects.new('Moto_'+obj.name,mesh);bpy.context.collection.objects.link(baked_obj);baked.append(baked_obj)
for obj in list(bpy.data.objects):
    if obj not in baked: bpy.data.objects.remove(obj,do_unlink=True)
anchor=bpy.data.objects.new('HelmetAnchor',None);anchor.location=helmet_position;bpy.context.collection.objects.link(anchor)
bpy.context.view_layer.update()
out=os.path.abspath('artifacts/3d-game/bike/public/models');os.makedirs(out,exist_ok=True)
bpy.ops.export_scene.gltf(filepath=os.path.join(out,'rider.glb'),export_format='GLB',export_animations=False,export_yup=True,export_morph=False)
print('MOTORCYCLE_RIDER',json.dumps({'meshes':len(baked),'vertices':sum(len(o.data.vertices) for o in baked),'license':'CC0 Vitruvian / CharMorph','offset':list(offset),'helmet':list(helmet_position),'contacts':contacts}))
