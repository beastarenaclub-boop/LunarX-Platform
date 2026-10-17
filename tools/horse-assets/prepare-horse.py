import bpy, math, os, json
from mathutils import Vector, Quaternion, Matrix
from mathutils.kdtree import KDTree

out = os.path.abspath('artifacts/3d-game/public/assets/horse-racing/realistic')
os.makedirs(out, exist_ok=True)
arm = bpy.data.objects['Armature']
for b in arm.pose.bones:
    for constraint in list(b.constraints): b.constraints.remove(constraint)
    b.rotation_mode='QUATERNION';b.rotation_quaternion=Quaternion();b.location=(0,0,0)
bpy.context.view_layer.update()
meshes = [o for o in bpy.data.objects if o.type=='MESH']
# Keep the authored skeleton, feet, saddle line and face at their original size.
# A racehorse has a tucked flank and a leaner barrel than this ranch-horse source.
body_source=bpy.data.objects['Plane'];scale=.335
source_bottom=min((body_source.matrix_world@v.co).z for v in body_source.data.vertices)
def smoothstep(lo,hi,value):
    t=max(0,min(1,(value-lo)/(hi-lo)));return t*t*(3-2*t)
def window(lo,inner_lo,inner_hi,hi,value):
    return smoothstep(lo,inner_lo,value)*(1-smoothstep(inner_hi,hi,value))
for v in body_source.data.vertices:
    p=body_source.matrix_world@v.co
    x,y,z=p.x*scale,p.y*scale,(p.z-source_bottom)*scale
    barrel=window(-.85,-.25,.45,1.1,y)*window(1.18,1.4,2.12,2.48,z)
    flank=window(-.55,-.15,.45,.9,y)*(1-smoothstep(1.48,2.43,z))*smoothstep(1.2,1.35,z)
    neck=window(-2.15,-1.65,-1.0,-.65,y)*smoothstep(1.8,2.2,z)
    p.x*=1-.12*barrel-.07*neck
    p.z+=.18*flank/scale
    v.co=body_source.matrix_world.inverted()@p
    # Original weights let opposite legs pull the belly and withers around.
    # Transfer only that stray influence to the torso, retaining joint blends.
    torso=window(-.72,-.30,.45,.95,y)*smoothstep(1.15,1.32,z)
    upper=smoothstep(1.75,2.4,z)*window(-1.35,-.9,1.05,1.6,y)
    keep=1-max(torso,upper*.9)
    weights={body_source.vertex_groups[g.group].name:g.weight for g in v.groups}
    for name in list(weights):
        if name.startswith(('Bone_L','Bone_R')):
            transfer=weights[name]*(1-keep)
            weights[name]-=transfer;weights['Bone']=weights.get('Bone',0)+transfer
    total=sum(weights.values())
    for name,weight in weights.items():
        body_source.vertex_groups[name].add([v.index],weight/total,'REPLACE')

# Add fetlock controls: the source has no separate hoof joints, which otherwise
# makes every hoof rotate rigidly with the cannon bone through a folded stride.
hoof_joints={}
if bpy.context.object and bpy.context.object.mode!='OBJECT':bpy.ops.object.mode_set(mode='OBJECT')
bpy.ops.object.select_all(action='DESELECT');arm.select_set(True)
bpy.context.view_layer.objects.active=arm;bpy.ops.object.mode_set(mode='EDIT')
for side in ['L','R']:
    for label,suffix in [('Front','.002'),('Hind','.005')]:
        parent=arm.data.edit_bones['Bone_'+side+suffix]
        name='Hoof'+label+'_'+side;bone=arm.data.edit_bones.new(name)
        bone.head=parent.tail.lerp(parent.head,.26);bone.tail=parent.tail.copy()
        bone.parent=parent;bone.roll=parent.roll;hoof_joints[parent.name]=name
bpy.ops.object.mode_set(mode='OBJECT')
for parent,name in hoof_joints.items():
    group=body_source.vertex_groups.new(name=name)
    for v in body_source.data.vertices:
        height=((body_source.matrix_world@v.co).z-source_bottom)*scale
        blend=1-smoothstep(.13,.37,height)
        if blend<=0:continue
        weight=next((g.weight for g in v.groups if g.group==body_source.vertex_groups[parent].index),0)
        if weight<=0:continue
        group.add([v.index],weight*blend,'REPLACE')
        body_source.vertex_groups[parent].add([v.index],weight*(1-blend),'REPLACE')

# Trim the source's long sculpted mane into a close, anatomical racing mane.
# The source crest remains anchored to the neck; long projecting tips are folded down.
# The source names are counterintuitive: BezierCurve is the mane, .005 the tail.
mane=bpy.data.objects['BezierCurve'];tail=bpy.data.objects['BezierCurve.005']
body_points=[body_source.matrix_world@v.co for v in body_source.data.vertices]
inv=mane.matrix_world.inverted()
for v in mane.data.vertices:
    p=mane.matrix_world@v.co
    section=[q for q in body_points if abs(q.y-p.y)<.4 and abs(q.x)<.65]
    if section:
        crest=max(q.z for q in section)
        if p.z>crest+.12:p.z=crest+.12+(p.z-crest-.12)*.12
        p.x*=.62
        v.co=inv@p
for o in list(bpy.data.objects):
    if o not in meshes and o != arm: bpy.data.objects.remove(o, do_unlink=True)

def textured(name, color, normal=None, alpha=False, roughness=.8):
    m=bpy.data.materials[name];m.use_nodes=True;m.node_tree.nodes.clear()
    n=m.node_tree.nodes;l=m.node_tree.links
    shader=n.new('ShaderNodeBsdfPrincipled');shader.inputs['Roughness'].default_value=roughness
    shader.inputs['Specular IOR Level'].default_value=.28
    output=n.new('ShaderNodeOutputMaterial');l.new(shader.outputs['BSDF'],output.inputs['Surface'])
    image=n.new('ShaderNodeTexImage');image.image=bpy.data.images[color]
    l.new(image.outputs['Color'],shader.inputs['Base Color'])
    if alpha:
        l.new(image.outputs['Alpha'],shader.inputs['Alpha']);m.surface_render_method='DITHERED';m.use_backface_culling=False
    if normal:
        norm=n.new('ShaderNodeTexImage');norm.image=bpy.data.images[normal];norm.image.colorspace_settings.name='Non-Color'
        convert=n.new('ShaderNodeNormalMap');convert.inputs['Strength'].default_value=.65
        l.new(norm.outputs['Color'],convert.inputs['Color']);l.new(convert.outputs['Normal'],shader.inputs['Normal'])
    return m
textured('Material','HorseMain4k00.png','HorseMain4k00Norm00.p',roughness=.7)
textured('Material.003','Hair12Main2k.png','Hair12Main2kNorm.png',True,.94)
textured('Eye_brown','eye_texture.bmp.001',roughness=.18)
eye_shader=next(n for n in bpy.data.materials['Eye_brown'].node_tree.nodes if n.type=='BSDF_PRINCIPLED')
for link in list(eye_shader.inputs['Base Color'].links):bpy.data.materials['Eye_brown'].node_tree.links.remove(link)
eye_shader.inputs['Base Color'].default_value=(.018,.012,.007,1)

# Repair the public source rig: mane, tail and eyes were supplied without weights.
body=bpy.data.objects['Plane'];tree=KDTree(len(body.data.vertices))
for v in body.data.vertices:tree.insert(arm.matrix_world.inverted() @ (body.matrix_world @ v.co),v.index)
tree.balance()
for o in meshes:
    if any(m.type=='ARMATURE' for m in o.modifiers): continue
    world=o.matrix_world.copy();o.parent=arm;o.matrix_world=world
    candidates=['Bone.003','Bone.004'] if o==tail else [g.name for g in body.vertex_groups]
    groups={name:o.vertex_groups.new(name=name) for name in candidates}
    for v in o.data.vertices:
        p=arm.matrix_world.inverted() @ (o.matrix_world @ v.co)
        if o==mane:
            neck_weight=1-smoothstep(-.95,-.4,(o.matrix_world@v.co).y*scale)
            groups['Bone.001'].add([v.index],neck_weight,'REPLACE')
            groups['Bone'].add([v.index],1-neck_weight,'REPLACE')
            continue
        if o!=tail:
            weights={}
            for co,index,dist in tree.find_n(p,4):
                for group in body.data.vertices[index].groups:
                    name=body.vertex_groups[group.group].name
                    weights[name]=weights.get(name,0)+group.weight/max(.05,dist)**3
            total=sum(weights.values())
            for name,weight in weights.items():groups[name].add([v.index],weight/total,'REPLACE')
            continue
        distances=[]
        for name in candidates:
            b=arm.data.bones[name];direction=b.tail_local-b.head_local
            t=max(0,min(1,(p-b.head_local).dot(direction)/direction.length_squared))
            distances.append(((p-b.head_local-t*direction).length,name))
        nearest=sorted(distances)[:2]
        weights=[1/max(.05,d)**3 for d,name in nearest];total=sum(weights)
        for weight,(d,name) in zip(weights,nearest): groups[name].add([v.index],weight/total,'REPLACE')
    m=o.modifiers.new('Animated surface','ARMATURE');m.object=arm
for o in meshes:
    o.data.validate()
    for p in o.data.polygons:p.use_smooth=True
body=bpy.data.objects['Plane']
sub=body.modifiers.new('Anatomical surface','SUBSURF');sub.levels=1;sub.render_levels=1
# Bake subdivision before the armature so joint weights are smoothly interpolated.
bpy.context.view_layer.objects.active=body
bpy.ops.object.modifier_move_up(modifier=sub.name)
bpy.ops.object.modifier_apply(modifier=sub.name)
bpy.ops.object.select_all(action='DESELECT')
for o in meshes:o.select_set(True)
bpy.context.view_layer.objects.active=body
bpy.ops.object.join()
meshes=[body]

points=[o.matrix_world @ v.co for o in meshes for v in o.data.vertices]
bottom=min(p.z for p in points);scale=.335
master=bpy.data.objects.new('HorseMotion',None);bpy.context.collection.objects.link(master)
master.scale=(scale,)*3;master.location=(0,0,-bottom*scale)
for o in meshes+[arm]:
    if o.parent is None: o.parent=master
bpy.context.view_layer.update()

scene=bpy.context.scene;scene.render.fps=30;scene.frame_start=1;scene.frame_end=31
def rotate(name, angle):
    b=arm.pose.bones[name];rest=arm.data.bones[name].matrix_local.to_quaternion()
    b.rotation_mode='QUATERNION';b.rotation_quaternion=rest.inverted() @ Quaternion((1,0,0),angle) @ rest
def reset():
    for b in arm.pose.bones:b.rotation_mode='QUATERNION';b.rotation_quaternion=Quaternion();b.location=(0,0,0)

def foot_path(t, keys):
    """Periodic Hermite path; the stance segment is a level, constant-speed sweep."""
    t%=1
    for i in range(len(keys)-1):
        t0,y0,z0=keys[i];t1,y1,z1=keys[i+1]
        if t0<=t<=t1:
            u=(t-t0)/(t1-t0)
            if i==0:return y0+(y1-y0)*u,z0
            previous=keys[i-1]
            following=keys[i+2] if i+2<len(keys) else (keys[1][0]+1,keys[1][1],keys[1][2])
            m0y=(y1-previous[1])/(t1-previous[0])*(t1-t0)
            m0z=(z1-previous[2])/(t1-previous[0])*(t1-t0)
            m1y=(following[1]-y0)/(following[0]-t0)*(t1-t0)
            m1z=(following[2]-z0)/(following[0]-t0)*(t1-t0)
            a=2*u**3-3*u**2+1;b=u**3-2*u**2+u;c=-2*u**3+3*u**2;d=u**3-u**2
            return a*y0+b*m0y+c*y1+d*m1y,max(.045,a*z0+b*m0z+c*z1+d*m1z)
    return keys[0][1:]

def leg_pose(names,t,hind=False):
    """Solve knee/hock to a hoof path in the sagittal plane, keeping bone lengths."""
    bones=[arm.data.bones[name] for name in names]
    heads=[arm.matrix_world@bone.head_local for bone in bones]
    tails=[arm.matrix_world@bone.tail_local for bone in bones]
    vectors=[tail-head for head,tail in zip(heads,tails)]
    rest_angles=[math.atan2(v.y,-v.z) for v in vectors]
    lengths=[math.hypot(v.y,v.z) for v in vectors]
    if hind:
        path=[(0,.75,.05),(.19,1.45,.05),(.32,2.05,.5),(.5,1.20,1.22),(.68,.05,1.05),(.84,.15,.52),(1,.75,.05)]
        shoulder=rest_angles[0]-.20+.29*math.sin(math.tau*t-.25)
    else:
        path=[(0,-1.12,.05),(.19,-.37,.05),(.34,.50,.48),(.51,.28,1.27),(.67,-.78,1.10),(.82,-1.73,.60),(1,-1.12,.05)]
        shoulder=rest_angles[0]-.26*math.sin(math.tau*t+.2)
    root=heads[0]
    elbow_y=root.y+math.sin(shoulder)*lengths[0]
    elbow_z=root.z-math.cos(shoulder)*lengths[0]
    foot_y,foot_z=foot_path(t,path)
    dy,dz=foot_y-elbow_y,foot_z-elbow_z
    distance=math.hypot(dy,dz);distance=max(.12,min(distance,lengths[1]+lengths[2]-.003))
    direction=math.atan2(dy,-dz)
    bend=math.acos(max(-1,min(1,(lengths[1]**2+distance**2-lengths[2]**2)/(2*lengths[1]*distance))))
    # Front knees fold forward; hind hocks fold rearward.
    upper=direction+(bend if hind else -bend)
    knee_y=elbow_y+math.sin(upper)*lengths[1]
    knee_z=elbow_z-math.cos(upper)*lengths[1]
    solved_y=elbow_y+math.sin(direction)*distance
    solved_z=elbow_z-math.cos(direction)*distance
    lower=math.atan2(solved_y-knee_y,-(solved_z-knee_z))
    rotate(names[0],shoulder-rest_angles[0])
    rotate(names[1],upper-rest_angles[1]-(shoulder-rest_angles[0]))
    rotate(names[2],lower-rest_angles[2]-(upper-rest_angles[1]))
    lower_delta=lower-rest_angles[2]
    stance=1-smoothstep(.18,.30,t) if t<.5 else smoothstep(.86,1,t)
    hoof_delta=max(-.42,min(.42,lower_delta*.24))*(1-stance)
    rotate(hoof_joints[names[2]],hoof_delta-lower_delta)

for clip in ['Idle','Gallop']:
    action=bpy.data.actions.new(clip);arm.animation_data_create();arm.animation_data.action=action
    for frame in range(1,32):
        scene.frame_set(frame);reset();phase=(frame-1)/30*math.tau
        if clip=='Gallop':
            rotate('Bone.001',.045*math.sin(phase-.3));rotate('Bone.002',-.06*math.sin(phase-.3))
            for side,offset in [('L',0),('R',.115)]:
                leg_pose(['Bone_'+side,'Bone_'+side+'.001','Bone_'+side+'.002'],((frame-1)/30+offset)%1)
                leg_pose(['Bone_'+side+'.003','Bone_'+side+'.004','Bone_'+side+'.005'],((frame-1)/30+offset+.49)%1,True)
            rotate('Bone.003',.18+.07*math.sin(phase));rotate('Bone.004',.16*math.sin(phase-.4))
        else:
            rotate('Bone.001',.018*math.sin(phase));rotate('Bone.002',-.018*math.sin(phase));rotate('Bone.004',.04*math.sin(phase))
        for b in arm.pose.bones:b.keyframe_insert('rotation_quaternion',frame=frame,group=b.name)
    action.use_fake_user=True
    for c in action.fcurves:
        for k in c.keyframe_points:k.interpolation='BEZIER'
arm.animation_data.action=bpy.data.actions['Idle'];scene.frame_set(1)
for o in bpy.data.objects:o.select_set(True)
bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath('.cache/horse-realism/prepared-horse.blend'))
bpy.ops.export_scene.gltf(filepath=os.path.join(out,'racehorse.glb'),export_format='GLB',export_animations=True,export_animation_mode='ACTIONS',export_force_sampling=True,export_image_format='WEBP',export_image_quality=88,export_yup=True,export_apply=False)
print('HORSE_EXPORTED',os.path.getsize(os.path.join(out,'racehorse.glb')))
