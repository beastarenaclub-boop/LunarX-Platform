"""Build a locally animated sports human from the workspace's CC0 Vitruvian source.
Run with Blender --background --factory-startup --python this-file.
No downloaded animation or horse/bike pose is included in the output.
"""
import bpy, bmesh, os, math, json
from mathutils import Vector, Quaternion, Matrix

bpy.ops.wm.read_factory_settings(use_empty=True)
source=os.path.abspath('.cache/horse-realism')
out=os.path.abspath('artifacts/3d-game/src/components/virtual-sports/assets')
os.makedirs(out,exist_ok=True)
bpy.ops.import_scene.gltf(filepath=os.path.join(source,'vitruvian_body.glb'))
arm=next(o for o in bpy.data.objects if o.type=='ARMATURE')
arm.animation_data_clear()
for action in list(bpy.data.actions): bpy.data.actions.remove(action)
for b in arm.pose.bones:
    b.rotation_mode='QUATERNION';b.rotation_quaternion=Quaternion();b.location=(0,0,0);b.scale=(1,1,1)
bpy.context.view_layer.update()
before=set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=os.path.join(source,'vitruvian_head.glb'))
for o in set(bpy.data.objects)-before:
    if o.type!='MESH':continue
    if o.name.startswith('Eyeshadow') or o.name=='Icosphere':
        bpy.data.objects.remove(o,do_unlink=True);continue
    if o.data.shape_keys:o.shape_key_clear()
    world=o.matrix_world.copy();o.parent=arm;o.matrix_world=world
    g=o.vertex_groups.new(name='mixamorig:Head');g.add(list(range(len(o.data.vertices))),1,'REPLACE')
    mod=o.modifiers.new('Head attachment','ARMATURE');mod.object=arm

def material(name,color=(1,1,1,1),diff=None,normal=None,rough=.7):
    m=bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes=True;m.node_tree.nodes.clear();n=m.node_tree.nodes;l=m.node_tree.links
    bs=n.new('ShaderNodeBsdfPrincipled');bs.inputs['Base Color'].default_value=color;bs.inputs['Roughness'].default_value=rough
    bs.inputs['Specular IOR Level'].default_value=.28
    output=n.new('ShaderNodeOutputMaterial');l.new(bs.outputs['BSDF'],output.inputs['Surface'])
    for filename,is_normal in [(diff,False),(normal,True)]:
        if not filename:continue
        image=bpy.data.images.load(os.path.join(source,filename),check_existing=True)
        limit=1024 if 'face' in filename else 512
        if max(image.size)>limit:image.scale(limit,limit)
        tex=n.new('ShaderNodeTexImage');tex.image=image
        if is_normal:
            image.colorspace_settings.name='Non-Color';norm=n.new('ShaderNodeNormalMap');norm.inputs['Strength'].default_value=.3
            l.new(tex.outputs['Color'],norm.inputs['Color']);l.new(norm.outputs['Normal'],bs.inputs['Normal'])
        else:l.new(tex.outputs['Color'],bs.inputs['Base Color'])
    return m
material('VitBody',diff='vit_body_bc.png',normal='vit_body_n.png')
material('VitSkin',diff='vit_face_bc.png',normal='vit_face_n.png',rough=.66)
material('VitShirt',(.9,.9,.9,1),rough=.83)
material('VitPants',(.035,.045,.065,1),rough=.8)
material('VitShoes',(.83,.85,.81,1),rough=.43)
for name in list(bpy.data.materials.keys()):
    if name.startswith('VitSclera'):material(name,diff='vit_sclera.png',rough=.25)
    if name.startswith('VitIris'):material(name,diff='vit_iris.png',rough=.3)
    if name.startswith('VitEyeBack'):material(name,(.018,.012,.009,1))
    if name in ['VitCaruncle','VitTearline']:material(name,(.36,.12,.09,1))

# The source body omits skin hidden by trousers. Retain that continuous weighted
# leg topology and assign skin below the sports hem instead of deleting it.
pants=bpy.data.objects['Pants']
pants.data.materials.append(material('SportsLegs',(.48,.25,.135,1),rough=.72))
pants.data.materials.append(material('SportsSocks',(.83,.84,.8,1),rough=.9))
for p in pants.data.polygons:
    height=sum((pants.matrix_world@pants.data.vertices[i].co).z for i in p.vertices)/len(p.vertices)
    if height<.28:p.material_index=len(pants.data.materials)-1
    elif height<.72:p.material_index=len(pants.data.materials)-2
for o in list(bpy.data.objects):
    if o.type!='MESH':continue
    if not o.data.materials:bpy.data.objects.remove(o,do_unlink=True);continue
    if o.data.shape_keys:o.shape_key_clear()
    hidden=[i for i,m in enumerate(o.data.materials) if m.name=='VitMouth' or m.name.startswith('VitCornea')]
    if hidden:
        bm=bmesh.new();bm.from_mesh(o.data)
        bmesh.ops.delete(bm,geom=[f for f in bm.faces if f.material_index in hidden],context='FACES')
        bm.to_mesh(o.data);bm.free()
    bpy.context.view_layer.objects.active=o
    dec=o.modifiers.new('Sports LOD','DECIMATE');dec.ratio=.1 if o.name in ['Shirt','Pants','cm_vitruvian'] else .26
    while o.modifiers.find(dec.name)>0:bpy.ops.object.modifier_move_up(modifier=dec.name)
    bpy.ops.object.modifier_apply(modifier=dec.name)
    for p in o.data.polygons:p.use_smooth=True
    while len(o.data.color_attributes):o.data.color_attributes.remove(o.data.color_attributes[0])

def bone(name):return arm.pose.bones['mixamorig:'+name]
def aim(name,child,direction):
    b=bone(name);head=b.head.copy();current=bone(child).head-head
    target=arm.matrix_world.inverted().to_3x3()@Vector(direction)
    q=current.rotation_difference(target)
    b.matrix=Matrix.Translation(head)@q.to_matrix().to_4x4()@Matrix.Translation(-head)@b.matrix
    bpy.context.view_layer.update()

# Close cropped hair follows the head, including in sports actions.
hp=arm.matrix_world@bone('Head').head
bpy.ops.mesh.primitive_uv_sphere_add(segments=20,ring_count=12,location=(hp.x,hp.y+.014,hp.z+.145),scale=(.09,.096,.070))
hair=bpy.context.object;hair.name='AthleteHair';hair.data.materials.append(material('AthleteHair',(.025,.018,.012,1),rough=.96))
bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
world=hair.matrix_world.copy();hair.parent=arm;hair.matrix_world=world
hair.vertex_groups.new(name='mixamorig:Head').add(list(range(len(hair.data.vertices))),1,'REPLACE')
hair.modifiers.new('Head attachment','ARMATURE').object=arm

arm.animation_data_create();bpy.context.scene.render.fps=30
clips=[]
for clip,frames in [('Idle',61),('Run',25),('Strike',31)]:
    action=bpy.data.actions.new(clip);arm.animation_data.action=action;clips.append(action)
    for frame in range(1,frames+1):
        phase=(frame-1)/(frames-1)*math.tau
        for b in arm.pose.bones:
            b.rotation_quaternion=Quaternion();b.location=(0,0,0);b.scale=(1,1,1)
        bpy.context.view_layer.update()
        moving=clip=='Run';hit=math.sin((frame-1)/(frames-1)*math.pi) if clip=='Strike' else 0
        lean=.12 if moving else .025
        aim('Spine','Spine1',(0,-lean,1));aim('Neck','Head',(0,.03,1))
        for side,sign in [('Left',1),('Right',-1)]:
            stride=math.sin(phase+(0 if sign==1 else math.pi)) if moving else 0
            thigh=stride*.64 + (hit*.85 if sign==-1 else 0)
            bend=max(0,-stride)*1.05+.16
            aim(side+'UpLeg',side+'Leg',(sign*.055,-math.sin(thigh),-math.cos(thigh)))
            aim(side+'Leg',side+'Foot',(0,-math.sin(thigh-bend),-math.cos(thigh-bend)))
            aim(side+'Foot',side+'ToeBase',(0,-1,-.04))
            swing=-stride*.42
            aim(side+'Arm',side+'ForeArm',(sign*.12,-math.sin(swing),-math.cos(swing)))
            aim(side+'ForeArm',side+'Hand',(-sign*.12,-.8 if moving else -.18,-.4 if moving else -.96))
            aim(side+'Hand',side+'HandMiddle1',(0,-.55,-.7))
        # Match foot support to the ground while retaining a small running flight.
        floor=min((arm.matrix_world@bone(s+'Foot').head).z for s in ['Left','Right'])
        bone('Hips').location.z += .105-floor + (abs(math.sin(phase*2))*.025 if moving else math.sin(phase)*.006)
        bpy.context.view_layer.update()
        for b in arm.pose.bones:
            b.keyframe_insert('rotation_quaternion',frame=frame);b.keyframe_insert('location',frame=frame)
    for fc in action.fcurves:
        for key in fc.keyframe_points:key.interpolation='LINEAR'
    action.use_fake_user=True
arm.animation_data.action=clips[0]
bpy.context.scene.frame_start=1;bpy.context.scene.frame_end=61;bpy.context.scene.frame_set(1)
bpy.context.view_layer.update()
bpy.ops.export_scene.gltf(filepath=os.path.join(out,'athlete.glb'),export_format='GLB',export_animations=True,export_animation_mode='ACTIONS',export_image_format='WEBP',export_image_quality=87,export_yup=True,export_morph=False)
print('SPORTS_ASSET',json.dumps({'vertices':sum(len(o.data.vertices) for o in bpy.data.objects if o.type=='MESH'),'clips':[a.name for a in clips],'file':os.path.join(out,'athlete.glb')}))
