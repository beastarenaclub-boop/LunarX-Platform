"""Build the football-specific rig and retarget CC0 Quaternius locomotion.

Inputs and licenses: assets/CREDITS.txt. Run with Blender 4.2 in background.
The source mesh faces -Y in Blender (+Z in glTF). All clips are in place.
"""
import bpy, os, math, json
from mathutils import Vector, Quaternion, Matrix
from mathutils.kdtree import KDTree

ROOT=os.getcwd()
CACHE=os.path.join(ROOT,'.cache/football-pro')
OUT=os.path.join(ROOT,'artifacts/3d-game/src/components/virtual-sports/assets')
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.join(CACHE,'animations/Animation Library[Standard]/Godot/AnimationLibrary_Godot_Standard.glb'))
source=next(o for o in bpy.data.objects if o.type=='ARMATURE')
# Capture actual posed world directions before unloading the source rig.
mapping={'Hips':'DEF-hips','Spine':'DEF-spine.001','Chest':'DEF-spine.003','Neck':'DEF-neck','Head':'DEF-head'}
for side in ['L','R']:
 for target,src in [('Shoulder','shoulder'),('Arm','upper_arm'),('Forearm','forearm'),('Hand','hand'),('Thigh','thigh'),('Shin','shin'),('Foot','foot'),('Toe','toe')]:
  mapping[target+'.'+side]='DEF-'+src+'.'+side
sampled={}
for target,clip in [('Idle','Idle_Loop'),('Walk','Walk_Loop'),('Jog','Jog_Fwd_Loop'),('Sprint','Sprint_Loop')]:
 action=next(a for a in bpy.data.actions if a.name==clip or a.name.startswith(clip+'_'))
 source.animation_data.action=action
 for track in source.animation_data.nla_tracks:track.mute=True
 start,end=action.frame_range
 frames=[]
 for i in range(int(end-start)+1):
  bpy.context.scene.frame_set(int(start)+i)
  frames.append({name:list((source.matrix_world.to_3x3()@(source.pose.bones[src].tail-source.pose.bones[src].head)).normalized()) for name,src in mapping.items()})
 sampled[target]=frames
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.join(CACHE,'soccer-player-source.glb'))
meshes=[]
for obj in list(bpy.data.objects):
 if obj.type!='MESH':continue
 if obj.name.startswith(('Soccer ball','Soccer jersey number','Hairline','teeth_','eyelashes')):
  bpy.data.objects.remove(obj,do_unlink=True);continue
 world=obj.matrix_world.copy();obj.parent=None;obj.matrix_world=world
 bpy.ops.object.select_all(action='DESELECT');obj.select_set(True);bpy.context.view_layer.objects.active=obj
 bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
 if obj.data.shape_keys:obj.shape_key_clear()
 if len(obj.data.vertices)>2500:
  dec=obj.modifiers.new('Broadcast mesh LOD','DECIMATE');dec.ratio=.24 if 'anatomical body' in obj.name else .55
  bpy.ops.object.modifier_apply(modifier=dec.name)
 for poly in obj.data.polygons:poly.use_smooth=True
 meshes.append(obj)
for mat in bpy.data.materials:
 if not mat.use_nodes:continue
 bs=next((n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED'),None)
 if not bs:continue
 bs.inputs['Specular IOR Level'].default_value=.3
 if mat.name in ['Micah | top','Micah | bottom']:
  for link in list(bs.inputs['Base Color'].links):mat.node_tree.links.remove(link)
  bs.inputs['Base Color'].default_value=(.85,.85,.85,1) if mat.name.endswith('top') else (.025,.035,.05,1)
  mat.name='FootballJersey' if mat.name.endswith('top') else 'FootballShorts'
 elif 'ribbed white' in mat.name:mat.name='FootballSocks'
 for n in mat.node_tree.nodes:
  if n.type=='TEX_IMAGE' and n.image and max(n.image.size)>1024:
   scale=1024/max(n.image.size);n.image.scale(round(n.image.size[0]*scale),round(n.image.size[1]*scale))

bpy.ops.object.armature_add();arm=bpy.context.object;arm.name='FootballRig'
bpy.ops.object.mode_set(mode='EDIT');arm.data.edit_bones.remove(arm.data.edit_bones[0])
spec={
 'Hips':((0,0,.94),(0,0,1.10),None),
 'Spine':((0,0,1.10),(0,-.01,1.30),'Hips'),
 'Chest':((0,-.01,1.30),(0,-.035,1.49),'Spine'),
 'Neck':((0,-.035,1.49),(0,-.04,1.59),'Chest'),
 'Head':((0,-.04,1.59),(0,-.04,1.80),'Neck'),
}
for s,sign in [('L',1),('R',-1)]:
 spec.update({
  'Shoulder.'+s:((sign*.03,-.025,1.46),(sign*.205,-.025,1.46),'Chest'),
  'Arm.'+s:((sign*.205,-.025,1.46),(sign*.305,-.015,1.22),'Shoulder.'+s),
  'Forearm.'+s:((sign*.305,-.015,1.22),(sign*.29,-.07,.98),'Arm.'+s),
  'Hand.'+s:((sign*.29,-.07,.98),(sign*.275,-.09,.85),'Forearm.'+s),
  'Thigh.'+s:((sign*.10,0,.94),(sign*.145,-.015,.52),'Hips'),
  'Shin.'+s:((sign*.145,-.015,.52),(sign*.145,-.015,.12),'Thigh.'+s),
  'Foot.'+s:((sign*.145,-.015,.12),(sign*.145,-.18,.055),'Shin.'+s),
  'Toe.'+s:((sign*.145,-.18,.055),(sign*.145,-.24,.045),'Foot.'+s),
 })
for name,(head,tail,parent) in spec.items():
 b=arm.data.edit_bones.new(name);b.head=head;b.tail=tail
 if parent:b.parent=arm.data.edit_bones[parent]
bpy.ops.object.mode_set(mode='OBJECT')

def weights_at(p,objname):
 x,y,z=p;s='L' if x>=0 else 'R';ax=abs(x)
 if objname in ['short01','eyebrow001','low-poly']:return {'Head':1}
 if z>1.60:return {'Head':1}
 if z>1.49:
  f=max(0,min(1,(z-1.49)/.11));return {'Neck':1-f,'Head':f}
 # Arms are a bent chain beside the torso in the source pose.
 if (ax>.225 and z>.83) or (ax>.195 and z>1.39):
  chain=[('Hand.'+s,.88),('Forearm.'+s,1.10),('Arm.'+s,1.35),('Shoulder.'+s,1.52)]
 elif z<1.0:
  chain=[('Foot.'+s,.1),('Shin.'+s,.32),('Thigh.'+s,.73),('Hips',1.01)]
 else:chain=[('Hips',1.02),('Spine',1.21),('Chest',1.41),('Neck',1.55)]
 if z<=chain[0][1]:return {chain[0][0]:1}
 for (a,lo),(b,hi) in zip(chain,chain[1:]):
  if z<=hi:
   f=(z-lo)/(hi-lo);f=f*f*(3-2*f);return {a:1-f,b:f}
 return {chain[-1][0]:1}
for obj in meshes:
 obj.vertex_groups.clear()
 groups={n:obj.vertex_groups.new(name=n) for n in spec}
 for v in obj.data.vertices:
  for n,w in weights_at(v.co,obj.name).items():
   if w>.001:groups[n].add([v.index],w,'REPLACE')
 obj.parent=arm
 obj.modifiers.new('Football skin','ARMATURE').object=arm

# Heat weights follow the connected anatomical topology, including individual
# fingers beside the shorts. Height-only weights are unsuitable at that contact.
body=next(o for o in meshes if 'anatomical body' in o.name)
bpy.ops.object.select_all(action='DESELECT');body.select_set(True);arm.select_set(True)
bpy.context.view_layer.objects.active=arm
bpy.ops.object.parent_set(type='ARMATURE_AUTO')
for mod in list(body.modifiers)[1:]:
 if mod.type=='ARMATURE':body.modifiers.remove(mod)
# Transfer the anatomical skin to the kit so collar, sleeves and socks deform
# with the same joints and do not cut through the player during locomotion.
tree=KDTree(len(body.data.vertices))
for v in body.data.vertices:tree.insert(v.co,v.index)
tree.balance()
body_groups={g.index:g.name for g in body.vertex_groups}
for obj in meshes:
 if obj==body or obj.name in ['short01','eyebrow001','low-poly']:continue
 obj.vertex_groups.clear();groups={name:obj.vertex_groups.new(name=name) for name in spec}
 for v in obj.data.vertices:
  weights={}
  allowed=set(spec)
  if obj.name=='male_casualsuit04':
   if v.co.z<1.1:allowed={'Hips','Thigh.L','Thigh.R'}
   elif abs(v.co.x)>.22 and v.co.z>1.3:allowed={'Chest','Spine','Neck','Shoulder.L','Shoulder.R','Arm.L','Arm.R','Forearm.L','Forearm.R'}
   else:allowed={'Hips','Spine','Chest','Neck'}
  elif 'sock' in obj.name.lower() or 'shoe' in obj.name.lower() or 'Cleat' in obj.name:
   allowed={n for n in spec if n.startswith(('Thigh','Shin','Foot','Toe'))}
  for co,index,distance in tree.find_n(v.co,3):
   factor=1/max(.001,distance)**2
   for g in body.data.vertices[index].groups:
    name=body_groups[g.group]
    if name in allowed:weights[name]=weights.get(name,0)+g.weight*factor
  strongest=sorted(weights.items(),key=lambda x:-x[1])[:4];total=sum(w for n,w in strongest)
  if total<.0001:
   name='Hips' if v.co.z>.88 else 'Thigh.'+('L' if v.co.x>=0 else 'R')
   strongest=[(name,1)];total=1
  for name,w in strongest:
   if total:groups[name].add([v.index],w/total,'REPLACE')
for obj in meshes:obj.data.validate(clean_customdata=False)

def reset():
 for b in arm.pose.bones:
  b.rotation_mode='QUATERNION';b.rotation_quaternion=Quaternion();b.location=(0,0,0);b.scale=(1,1,1)
 bpy.context.view_layer.update()
def aim(name,direction):
 b=arm.pose.bones[name];head=b.head.copy();q=(b.tail-head).rotation_difference(Vector(direction))
 b.matrix=Matrix.Translation(head)@q.to_matrix().to_4x4()@Matrix.Translation(-head)@b.matrix
 bpy.context.view_layer.update()
def plant():
 floor=min(arm.pose.bones['Foot.'+s].head.z for s in ['L','R'])
 b=arm.pose.bones['Hips'];m=b.matrix.copy();m.translation.z+=.12-floor;b.matrix=m
 bpy.context.view_layer.update()
arm.animation_data_create();bpy.context.scene.render.fps=30
clips=[]
for name,frames in sampled.items():
 action=bpy.data.actions.new(name);arm.animation_data.action=action;clips.append(action)
 for i,pose in enumerate(frames):
  reset()
  for bone in spec:
   # Keep the natural clavicle width; retarget limb direction, not local T-pose rotations.
   if not bone.startswith('Shoulder'):aim(bone,pose[bone])
  plant()
  for b in arm.pose.bones:
   b.keyframe_insert('rotation_quaternion',frame=i+1);b.keyframe_insert('location',frame=i+1)
 action.use_fake_user=True
# Authored football kick: planted left foot, right backswing and follow-through.
for name in ['Kick','Celebrate']:
 action=bpy.data.actions.new(name);arm.animation_data.action=action;clips.append(action)
 for i in range(31):
  reset();f=i/30
  for bone in spec:
   if not bone.startswith('Shoulder'):aim(bone,sampled['Idle'][0][bone])
  if name=='Kick':
   angle=(-.65*math.sin(f/.35*math.pi/2) if f<.35 else -.65+1.85*math.sin(min(1,(f-.35)/.65)*math.pi/2))
   aim('Thigh.R',(0,-math.sin(angle),-math.cos(angle)))
   bend=.6*max(0,1-f*2)
   aim('Shin.R',(0,-math.sin(angle-bend),-math.cos(angle-bend)))
   aim('Arm.L',(.65,.1,-.8));aim('Arm.R',(-.65,.25,-.8))
  else:
   lift=math.sin(f*math.pi/2)
   for s,sign in [('L',1),('R',-1)]:
    aim('Arm.'+s,(sign*.65,0,-1+2*lift));aim('Forearm.'+s,(sign*.2,-.1,-1+2.3*lift))
  plant()
  for b in arm.pose.bones:
   b.keyframe_insert('rotation_quaternion',frame=i+1);b.keyframe_insert('location',frame=i+1)
 action.use_fake_user=True
for action in clips:
 for fc in action.fcurves:
  for k in fc.keyframe_points:k.interpolation='LINEAR'
arm.animation_data.action=clips[0];bpy.context.scene.frame_set(1)
# Remove non-mesh source empties and unused original animations.
for obj in list(bpy.data.objects):
 if obj!=arm and obj.type!='MESH':bpy.data.objects.remove(obj,do_unlink=True)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(CACHE,'football-rig.blend'))
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT,'football-player.glb'),export_format='GLB',export_animations=True,export_animation_mode='ACTIONS',export_image_format='WEBP',export_image_quality=88,export_morph=False,export_yup=True)
print('FOOTBALL_ASSET',json.dumps({'vertices':sum(len(o.data.vertices) for o in meshes),'clips':[a.name for a in clips]}))
