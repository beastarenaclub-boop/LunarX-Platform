import bpy,bmesh,os,math,json
from mathutils import Vector,Quaternion,Matrix
bpy.ops.wm.read_factory_settings(use_empty=True)
source=os.path.abspath('.cache/horse-realism')
bpy.ops.import_scene.gltf(filepath=os.path.join(source,'vitruvian_body.glb'))
arm=next(o for o in bpy.data.objects if o.type=='ARMATURE');arm.animation_data_clear()
for action in list(bpy.data.actions):bpy.data.actions.remove(action)
for b in arm.pose.bones:b.rotation_mode='QUATERNION';b.rotation_quaternion=Quaternion();b.location=(0,0,0);b.scale=(1,1,1)
bpy.context.view_layer.update()
before=set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=os.path.join(source,'vitruvian_head.glb'))
for o in set(bpy.data.objects)-before:
    if o.type!='MESH':continue
    if o.name.startswith('Eyeshadow') or o.name=='Icosphere':bpy.data.objects.remove(o,do_unlink=True);continue
    if o.data.shape_keys:o.shape_key_clear()
    world=o.matrix_world.copy();o.parent=arm;o.matrix_world=world
    g=o.vertex_groups.new(name='mixamorig:Head');g.add(list(range(len(o.data.vertices))),1,'REPLACE')
    mod=o.modifiers.new('Rider head','ARMATURE');mod.object=arm
for o in list(bpy.data.objects):
    if o.type=='MESH' and not o.data.materials:bpy.data.objects.remove(o,do_unlink=True)
def mat(name,diff=None,normal=None,color=(.5,.5,.5,1),rough=.7):
    m=bpy.data.materials.get(name)
    if not m:return
    m.use_nodes=True;m.node_tree.nodes.clear();n=m.node_tree.nodes;l=m.node_tree.links
    bs=n.new('ShaderNodeBsdfPrincipled');bs.inputs['Base Color'].default_value=color;bs.inputs['Roughness'].default_value=rough;bs.inputs['Specular IOR Level'].default_value=.3
    out=n.new('ShaderNodeOutputMaterial');l.new(bs.outputs['BSDF'],out.inputs['Surface'])
    for file,kind in [(diff,'color'),(normal,'normal')]:
        if not file:continue
        image=bpy.data.images.load(os.path.join(source,file),check_existing=True)
        if max(image.size)>2048:image.scale(2048,2048)
        tex=n.new('ShaderNodeTexImage');tex.image=image
        if kind=='color':l.new(tex.outputs['Color'],bs.inputs['Base Color'])
        else:
            image.colorspace_settings.name='Non-Color';norm=n.new('ShaderNodeNormalMap');norm.inputs['Strength'].default_value=.12 if 'fabric' in file else .35
            if 'fabric' in file:
                uv=n.new('ShaderNodeTexCoord');multiply=n.new('ShaderNodeVectorMath');multiply.operation='SCALE';multiply.inputs[3].default_value=28
                l.new(uv.outputs['UV'],multiply.inputs[0]);l.new(multiply.outputs['Vector'],tex.inputs['Vector'])
            l.new(tex.outputs['Color'],norm.inputs['Color']);l.new(norm.outputs['Normal'],bs.inputs['Normal'])
    return m
mat('VitBody','vit_body_bc.png','vit_body_n.png');mat('VitSkin','vit_face_bc.png','vit_face_n.png',rough=.62)
mat('VitMouth','vit_mouth.png',rough=.6);mat('VitShirt',normal='vit_fabric_n.png',color=(.65,.015,.022,1),rough=.34)
mat('VitPants',normal='vit_fabric_n.png',color=(.85,.82,.75,1),rough=.88);mat('VitShoes',color=(.018,.014,.01,1),rough=.43)
bpy.data.materials.new('RidingBoots');mat('RidingBoots',color=(.015,.011,.008,1),rough=.42)
# Race silks have full sleeves. Derive their topology and all deformation weights
# from the authored anatomical arms so the elbows remain human-shaped in a crouch.
bpy.data.materials.new('SilkWhite');mat('SilkWhite',normal='vit_fabric_n.png',color=(.92,.92,.86,1),rough=.34)
body=bpy.data.objects['cm_vitruvian']
sleeves=body.copy();sleeves.data=body.data.copy();sleeves.name='RacingSleeves';bpy.context.collection.objects.link(sleeves)
if sleeves.data.shape_keys:sleeves.shape_key_clear()
arm_groups={g.index for g in body.vertex_groups if g.name in ['mixamorig:'+side+part for side in ['Left','Right'] for part in ['Arm','ForeArm']]}
arm_weight={v.index:sum(g.weight for g in v.groups if g.group in arm_groups) for v in body.data.vertices}
bm=bmesh.new();bm.from_mesh(sleeves.data);bm.verts.ensure_lookup_table()
bmesh.ops.delete(bm,geom=[f for f in bm.faces if sum(arm_weight[v.index] for v in f.verts)/len(f.verts)<.70],context='FACES')
bm.normal_update()
for v in bm.verts:v.co+=v.normal*.008
bm.to_mesh(sleeves.data);bm.free()
sleeves.data.materials.clear();sleeves.data.materials.append(bpy.data.materials['VitShirt']);sleeves.data.materials.append(bpy.data.materials['SilkWhite'])
for p in sleeves.data.polygons:
    center=sum((sleeves.matrix_world@sleeves.data.vertices[i].co for i in p.vertices),Vector())/len(p.vertices)
    # A clean white cuff band sits above the wrist, on both sleeves.
    p.material_index=1 if 1.085<center.z<1.115 else 0
shirt=bpy.data.objects['Shirt'];shirt.data.materials.append(bpy.data.materials['SilkWhite'])
for p in shirt.data.polygons:
    c=sum((shirt.matrix_world@shirt.data.vertices[i].co for i in p.vertices),Vector())/len(p.vertices)
    # White chevron and side panels are material regions on actual cloth topology.
    chevron=abs(c.z-(1.23+abs(c.x)*.75))<.033 and abs(c.x)<.16
    side_panel=.105<abs(c.x)<.145 and c.z<1.28
    p.material_index=1 if chevron or side_panel else 0
pants=bpy.data.objects['Pants'];pants.data.materials.append(bpy.data.materials['RidingBoots'])
for polygon in pants.data.polygons:
    if sum((pants.matrix_world@pants.data.vertices[i].co).z for i in polygon.vertices)/len(polygon.vertices)<.48:polygon.material_index=len(pants.data.materials)-1
for name in list(bpy.data.materials.keys()):
    if name.startswith('VitSclera'):mat(name,'vit_sclera.png',rough=.22)
    if name.startswith('VitIris'):mat(name,'vit_iris.png',rough=.22)
    if name.startswith('VitEyeBack'):mat(name,color=(.02,.012,.007,1),rough=.3)
    if name.startswith('VitCornea'):mat(name,color=(.04,.025,.012,1),rough=.15)
    if name=='VitCaruncle':mat(name,color=(.48,.12,.1,1),rough=.4)
    if name=='VitTearline':mat(name,color=(.38,.12,.11,1),rough=.25)
def bone(name):return arm.pose.bones['mixamorig:'+name]
def aim(name,child,direction):
    b=bone(name);head=b.head.copy();current=bone(child).head-head;target=arm.matrix_world.inverted().to_3x3()@Vector(direction)
    q=current.rotation_difference(target);b.matrix=Matrix.Translation(head)@q.to_matrix().to_4x4()@Matrix.Translation(-head)@b.matrix;bpy.context.view_layer.update()
aim('Spine','Spine1',(0,-.975,.22));aim('Neck','Head',(0,-.24,.97))
for side,sign in [('Left',1),('Right',-1)]:
    aim(side+'UpLeg',side+'Leg',(sign*.72,-.68,-.10));aim(side+'Leg',side+'Foot',(sign*.13,.47,-.88));aim(side+'Foot',side+'ToeBase',(0,-1,-.08))
    aim(side+'Arm',side+'ForeArm',(sign*.26,.16,-.95));aim(side+'ForeArm',side+'Hand',(-sign*.18,-.95,.23));aim(side+'Hand',side+'HandMiddle1',(0,-1,-.08))
    for finger in ['Index','Middle','Ring','Pinky']:
        for segment in [1,2,3]:
            b=bone(side+'Hand'+finger+str(segment));p=b.head.copy();q=Quaternion((1,0,0),.42 if segment==1 else .65)
            b.matrix=Matrix.Translation(p)@q.to_matrix().to_4x4()@Matrix.Translation(-p)@b.matrix
            bpy.context.view_layer.update()
# Keep the authored anatomy and fingers in a low two-point racing crouch.
bpy.context.view_layer.update()
master=bpy.data.objects.new('MountedRider',None);bpy.context.collection.objects.link(master);scale=1.48;master.scale=(scale,)*3
hip=arm.matrix_world@bone('Hips').head;master.location=Vector((0,-.02,2.76))-hip*scale
for o in list(bpy.data.objects):
    if o!=master and o.parent is None:o.parent=master
for o in bpy.data.objects:
    if o.type=='MESH':
        remove_materials=[i for i,m in enumerate(o.data.materials) if m.name=='VitMouth' or m.name.startswith('VitCornea')]
        if remove_materials:
            bm=bmesh.new();bm.from_mesh(o.data)
            bmesh.ops.delete(bm,geom=[f for f in bm.faces if f.material_index in remove_materials],context='FACES')
            bm.to_mesh(o.data);bm.free()
        if o.name in ['Shirt','Pants','RacingSleeves','cm_vitruvian'] or o.name.startswith('Eye_'):
            bpy.context.view_layer.objects.active=o
            decimate=o.modifiers.new('Game mesh budget','DECIMATE');decimate.ratio=.35 if o.name in ['Shirt','Pants'] else .6
            while o.modifiers.find(decimate.name)>0:bpy.ops.object.modifier_move_up(modifier=decimate.name)
            bpy.ops.object.modifier_apply(modifier=decimate.name)
        for p in o.data.polygons:p.use_smooth=True
        while len(o.data.color_attributes):o.data.color_attributes.remove(o.data.color_attributes[0])
# Retain the skeleton and author a stationary mounted clip; the game adds stride response.
arm.animation_data_create();act=bpy.data.actions.new('Mounted');arm.animation_data.action=act
for b in arm.pose.bones:
    b.keyframe_insert('rotation_quaternion',frame=1);b.keyframe_insert('location',frame=1);b.keyframe_insert('scale',frame=1)
bpy.context.scene.frame_start=1;bpy.context.scene.frame_end=2;bpy.context.scene.frame_set(1);bpy.context.view_layer.update()
print('RIDER_POINTS',json.dumps({name:list(arm.matrix_world@bone(name).head) for name in ['Hips','Head','LeftHand','RightHand','LeftFoot','RightFoot']}))
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(source,'prepared-rider.blend'))
bpy.ops.export_scene.gltf(filepath=os.path.abspath('artifacts/3d-game/public/assets/horse-racing/realistic/jockey.glb'),export_format='GLB',export_animations=True,export_animation_mode='ACTIONS',export_image_format='WEBP',export_image_quality=90,export_yup=True,export_current_frame=True,export_rest_position_armature=False,export_morph=False)

