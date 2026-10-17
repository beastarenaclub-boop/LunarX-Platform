"""Football-only athlete pass: continuous fitted kit, source-detail face,
and a real CMU soccer strike retargeted onto the existing skeleton.

The cached CC0 character sources remain unchanged. No cricket assets are
exported. Run Blender 4.2 with --background --factory-startup --threads 2.
"""
import bpy,bmesh,os,math,json,ast,sys
from mathutils import Vector,Matrix,Quaternion
ROOT=os.getcwd();OUT=os.path.join(ROOT,'artifacts/unity-sports/Assets/Resources/Sports')
TEX=os.path.join(OUT,'Textures');CACHE=os.path.join(ROOT,'.cache/football-pro')
sys.path.insert(0,os.path.join(ROOT,'tools/sports-assets'))
import importlib
cmu=importlib.import_module('cmu-football-motion')

def activate(o):
 bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o
def remove_faces(o,predicate):
 bm=bmesh.new();bm.from_mesh(o.data);bmesh.ops.delete(bm,geom=[f for f in bm.faces if predicate(f)],context='FACES');bm.to_mesh(o.data);bm.free()
def reset():
 arm.animation_data.action=None
 for b in arm.pose.bones:
  b.rotation_mode='QUATERNION';b.rotation_quaternion=Quaternion();b.location=(0,0,0);b.scale=(1,1,1)
 bpy.context.view_layer.update()
def apply_modifier(o,m):
 activate(o)
 while o.modifiers.find(m.name)>0:bpy.ops.object.modifier_move_up(modifier=m.name)
 bpy.ops.object.modifier_apply(modifier=m.name)
def material(name,color=(1,1,1,1),albedo=None,normal=None):
 m=bpy.data.materials.new(name);m.use_nodes=True;bs=m.node_tree.nodes.get('Principled BSDF')
 bs.inputs['Base Color'].default_value=color;bs.inputs['Roughness'].default_value=.72
 for filename,is_normal in [(albedo,False),(normal,True)]:
  if not filename:continue
  t=m.node_tree.nodes.new('ShaderNodeTexImage');t.image=bpy.data.images.load(filename,check_existing=True)
  if is_normal:
   t.image.colorspace_settings.name='Non-Color';n=m.node_tree.nodes.new('ShaderNodeNormalMap');n.inputs['Strength'].default_value=.35;m.node_tree.links.new(t.outputs['Color'],n.inputs['Color']);m.node_tree.links.new(n.outputs['Normal'],bs.inputs['Normal'])
  else:m.node_tree.links.new(t.outputs['Color'],bs.inputs['Base Color'])
 return m

bpy.ops.wm.open_mainfile(filepath=os.path.join(CACHE,'football-matchday.blend'))
arm=bpy.data.objects['FootballRig'];human=bpy.data.objects['Athlete_LOD0'];reset()
# Keep dark shorts and socks; identify the white jersey from its original UVs
# so its low hem does not survive as a torn second layer at the waist.
atlas=bpy.data.images.load(os.path.join(TEX,'HumanAtlas.png'),check_existing=True);pixels=list(atlas.pixels);aw,ah=atlas.size
jersey=set()
for p in human.data.polygons:
 if p.material_index!=2 or p.center.z<.6:continue
 uv=human.data.uv_layers[0].data[p.loop_indices[0]].uv
 x=min(aw-1,int(uv.x%1*aw));y=min(ah-1,int(uv.y%1*ah))
 if sum(pixels[(y*aw+x)*4:(y*aw+x)*4+3])/3>.5:jersey.add(p.index)
def hidden_skin(f):
 c=f.calc_center_median()
 return f.material_index==0 and (c.z>1.51 or (.72<c.z<1.03 and abs(c.x)<.235))
remove_faces(human,lambda f:f.index in jersey or hidden_skin(f))
# Give the cropped hair a small clearance over the restored source head.
hair_verts={i for p in human.data.polygons if p.material_index==1 for i in p.vertices if human.data.vertices[i].co.z>1.76 or (human.data.vertices[i].co.z>1.70 and human.data.vertices[i].co.y>-.08)}
for i in hair_verts:
 v=human.data.vertices[i];v.co+=(v.co-Vector((0,-.065,1.72))).normalized()*.004
for p in human.data.polygons:p.use_smooth=True

# Recover the original garment surface. The source anatomical body omits skin
# under the shirt, so it cannot be used as a closed garment template.
with bpy.data.libraries.load(os.path.join(CACHE,'football-rig.blend'),link=False) as (src,dst):
 dst.objects=[n for n in src.objects if n=='male_casualsuit04']
shirt=dst.objects[0];bpy.context.collection.objects.link(shirt);shirt.name='Continuous performance jersey'
shirt.parent=arm
for mod in list(shirt.modifiers):shirt.modifiers.remove(mod)
tops={i for i,m in enumerate(shirt.data.materials) if m.name.startswith('FootballJersey')}
remove_faces(shirt,lambda f: f.material_index not in tops or f.calc_center_median().z<.985)
# A continuous welded shoulder surface follows the underlying body weights.
bm=bmesh.new();bm.from_mesh(shirt.data);bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.00015)
for _ in range(5):bmesh.ops.smooth_vert(bm,verts=list(bm.verts),factor=.55,use_axis_x=True,use_axis_y=True,use_axis_z=True)
for v in bm.verts:
 if not v.is_boundary:continue
 if v.co.z<1.13:v.co.z=1.005
 elif v.co.z>1.46 and abs(v.co.x)<.11:v.co.z=1.518
 elif abs(v.co.x)>.19 and v.co.z<1.40:
  sign=1 if v.co.x>0 else -1
  centre=Vector((sign*.265,-.019,1.316));normal=Vector((sign*.10,.01,-.24)).normalized()
  v.co-=(v.co-centre).dot(normal)*normal
bm.normal_update()
for v in bm.verts:
 normal=v.normal.copy();z=v.co.z
 ease=.020+(.009 if z<1.25 else 0)
 folds=.0028*math.sin(z*100+v.co.x*18)*math.exp(-((z-1.15)/.11)**2)
 v.co+=normal*(ease+folds)
bm.to_mesh(shirt.data);bm.free()
# Replace abrupt nearest-vertex weights with a continuous chest/sleeve blend.
shirt.vertex_groups.clear()
for name in ['Hips','Spine','Chest','Arm.L','Arm.R']:shirt.vertex_groups.new(name=name)
for v in shirt.data.vertices:
 x,y,z=v.co
 a=max(0,min(1,(abs(x)-.15)/.15));a=a*a*(3-2*a)
 c=max(0,min(1,(z-1.12)/.27));c=c*c*(3-2*c)
 h=max(0,min(1,(1.14-z)/.15));h=h*h*(3-2*h)
 for name,w in {'Arm.'+('L' if x>0 else 'R'):a,'Chest':(1-a)*c,'Spine':(1-a)*(1-c)*(1-h),'Hips':(1-a)*(1-c)*h}.items():
  if w>0:shirt.vertex_groups[name].add([v.index],w,'REPLACE')
sub=shirt.modifiers.new('Tailored curved silhouette','SUBSURF');sub.levels=1;apply_modifier(shirt,sub)
solid=shirt.modifiers.new('Sewn edge thickness','SOLIDIFY');solid.thickness=.0025;solid.offset=0;apply_modifier(shirt,solid)
shirt.modifiers.new('Athlete skin','ARMATURE').object=arm

# Tailored material zones are authored on the mesh; the shader bake below
# produces the game texture, not a painted-over screenshot.
fabric=material('Kit fabric',(.82,.82,.82,1));trim=material('Kit piping',(.13,.15,.18,1));inset=material('Kit side mesh',(.62,.64,.67,1))
for m in [fabric,trim,inset]:
 nodes=m.node_tree.nodes;links=m.node_tree.links;bs=nodes.get('Principled BSDF')
 wave=nodes.new('ShaderNodeTexWave');wave.wave_type='BANDS';wave.bands_direction='X';wave.inputs['Scale'].default_value=380
 bump=nodes.new('ShaderNodeBump');bump.inputs['Strength'].default_value=.07;bump.inputs['Distance'].default_value=.0002
 links.new(wave.outputs['Color'],bump.inputs['Height']);links.new(bump.outputs['Normal'],bs.inputs['Normal'])
shirt.data.materials.clear()
for m in [fabric,trim,inset]:shirt.data.materials.append(m)
for p in shirt.data.polygons:
 c=p.center;x,y,z=c
 p.material_index=2 if abs(x)>.175 and z<1.42 else 0
 p.use_smooth=True

# Bring back the original source face and its own UVs. A face no longer has to
# share a small patch of the old whole-body atlas with shoes and clothes.
before=set(bpy.data.objects);bpy.ops.import_scene.gltf(filepath=os.path.join(ROOT,'.cache/horse-realism/vitruvian_head.glb'))
face=None
for o in set(bpy.data.objects)-before:
 if o.type!='MESH' or not any(m.name.startswith('VitSkin') for m in o.data.materials):
  bpy.data.objects.remove(o,do_unlink=True);continue
 face=o
 if o.data.shape_keys:o.shape_key_clear()
 world=o.matrix_world.copy();o.parent=None;o.matrix_world=world;activate(o);bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
 skin_indices={i for i,m in enumerate(o.data.materials) if m.name.startswith('VitSkin')}
 remove_faces(o,lambda f:f.material_index not in skin_indices)
 for v in o.data.vertices:
  v.co.x*=.94;v.co.y-=.096;v.co.z+=.064
  if v.co.z<1.57:v.co.z-=max(0,(1.57-v.co.z)/.036)*.045
  if 1.60<v.co.z<1.68:v.co.x*=1.055
 o.vertex_groups.clear();o.vertex_groups.new(name='Head').add(list(range(len(o.data.vertices))),1,'REPLACE')
 for m in list(o.modifiers):o.modifiers.remove(m)
 dec=o.modifiers.new('Face detail budget','DECIMATE');dec.ratio=.55;apply_modifier(o,dec)
 for p in o.data.polygons:p.use_smooth=True
 o.parent=arm;o.modifiers.new('Head skin','ARMATURE').object=arm
face_material=material('FootballFace',albedo=os.path.join(ROOT,'.cache/horse-realism/vit_face_bc.png'),normal=os.path.join(ROOT,'.cache/horse-realism/vit_face_n.png'))
face.data.materials.clear();face.data.materials.append(face_material)
for p in face.data.polygons:p.material_index=0
face_uv=[tuple(v.uv) for v in face.data.uv_layers.active.data]
while face.data.uv_layers:face.data.uv_layers.remove(face.data.uv_layers[0])
face.data.uv_layers.new(name='UVMap')
for dst,src in zip(face.data.uv_layers[0].data,face_uv):dst.uv=src
import shutil
for src,dst in [('vit_face_bc.png','FootballFace.png'),('vit_face_n.png','FootballFace_normal.png')]:shutil.copyfile(os.path.join(ROOT,'.cache/horse-realism',src),os.path.join(TEX,dst))

# Extract socks/shorts so all kit parts can share one independent baked atlas.
lower=human.copy();lower.data=human.data.copy();bpy.context.collection.objects.link(lower);lower.name='Shorts and socks'
remove_faces(lower,lambda f:f.material_index!=2)
remove_faces(human,lambda f:f.material_index==2)
for m in lower.data.materials:
 if not m or not m.use_nodes:continue
 for node in list(m.node_tree.nodes):
  if node.type=='TEX_IMAGE':
   uv=m.node_tree.nodes.new('ShaderNodeUVMap');uv.uv_map='SourceUV';m.node_tree.links.new(uv.outputs['UV'],node.inputs['Vector'])
lower.data.uv_layers.active.name='SourceUV'
if not shirt.data.uv_layers:shirt.data.uv_layers.new(name='SourceUV')
shirt.data.uv_layers.active.name='SourceUV'
activate(lower);shirt.select_set(True);bpy.ops.object.join();kit=lower
kit.data.uv_layers.new(name='BakeUV');kit.data.uv_layers.active_index=kit.data.uv_layers.find('BakeUV');kit.data.uv_layers['BakeUV'].active_render=True
activate(kit);bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.uv.smart_project(angle_limit=1.15,island_margin=.009);bpy.ops.object.mode_set(mode='OBJECT')
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=1;scene.render.bake.margin=10;scene.render.bake.use_pass_direct=False;scene.render.bake.use_pass_indirect=False;scene.render.bake.use_pass_color=True
for normal in [False,True]:
 filename='FootballKit'+('_normal' if normal else '')+'.png'
 im=bpy.data.images.new(filename,width=2048,height=2048,alpha=False)
 if normal:im.colorspace_settings.name='Non-Color';im.generated_color=(.5,.5,1,1)
 nodes=[]
 for m in set(kit.data.materials):
  n=m.node_tree.nodes.new('ShaderNodeTexImage');n.image=im;m.node_tree.nodes.active=n;nodes.append((m,n))
 bpy.ops.object.bake(type='NORMAL' if normal else 'DIFFUSE',uv_layer='BakeUV')
 im.filepath_raw=os.path.join(TEX,filename);im.file_format='PNG';im.save()
 for m,n in nodes:m.node_tree.nodes.remove(n)
values=[tuple(v.uv) for v in kit.data.uv_layers['BakeUV'].data]
while kit.data.uv_layers:kit.data.uv_layers.remove(kit.data.uv_layers[0])
uv=kit.data.uv_layers.new(name='UVMap')
for dst,src in zip(uv.data,values):dst.uv=src
kitmat=material('FootballUniform',albedo=os.path.join(TEX,'FootballKit.png'),normal=os.path.join(TEX,'FootballKit_normal.png'))
kit.data.materials.clear();kit.data.materials.append(kitmat)
for p in kit.data.polygons:p.material_index=0
# The old atlas material was modified only for baking; restore its UV lookup.
for m in human.data.materials:
 if m and m.use_nodes:
  for n in m.node_tree.nodes:
   if n.type=='UVMAP':n.uv_map='UVMap'
for o in [human,kit,face]:
 values=[tuple(v.uv) for v in o.data.uv_layers.active.data]
 while o.data.uv_layers:o.data.uv_layers.remove(o.data.uv_layers[0])
 o.data.uv_layers.new(name='UVMap')
 for dst,src in zip(o.data.uv_layers[0].data,values):dst.uv=src
activate(human);kit.select_set(True);face.select_set(True);bpy.ops.object.join()
used=sorted({p.material_index for p in human.data.polygons});slots=[human.data.materials[i] for i in used];indices={old:new for new,old in enumerate(used)}
poly_indices=[indices[p.material_index] for p in human.data.polygons];human.data.materials.clear()
for m in slots:human.data.materials.append(m)
for p,index in zip(human.data.polygons,poly_indices):p.material_index=index
for mod in list(human.modifiers):human.modifiers.remove(mod)
human.modifiers.new('Skin','ARMATURE').object=arm

# Retarget the soccer strike using captured world-space segment directions.
poses=cmu.read_capture(os.path.join(CACHE,'mocap'))
contact=596;start=contact-48;end=contact+48
mapping={'Hips':'lowerback','Spine':'upperback','Chest':'thorax','Neck':'upperneck','Head':'head'}
for side,prefix in [('L','l'),('R','r')]:
 for name,src in [('Arm','humerus'),('Forearm','radius'),('Hand','hand'),('Thigh','femur'),('Shin','tibia'),('Foot','foot'),('Toe','toes')]:mapping[name+'.'+side]=prefix+src
# The ball travels in the strike direction, which differs from the planted
# foot's toe direction during an inside-foot pass.
forward=(poses[contact+1]['rfoot'][1]-poses[contact+1]['root'])-(poses[contact-1]['rfoot'][1]-poses[contact-1]['root']);forward.z=0
alignment=forward.normalized().rotation_difference(Vector((0,-1,0))).to_matrix()
# Retain the authored Kick for basketball/tennis, which share this character
# resource. Only football explicitly selects the captured Pass action.
action=bpy.data.actions.new('Pass');action.use_fake_user=True
track=[]
for j,i in enumerate(range(start,end+1,4)):
 reset();arm.animation_data.action=action
 for name,source in mapping.items():
  direction=alignment@(poses[i][source][1]-poses[i][source][0]);direction.normalize()
  b=arm.pose.bones[name];head=b.head.copy();q=(b.tail-head).rotation_difference(direction)
  b.matrix=Matrix.Translation(head)@q.to_matrix().to_4x4()@Matrix.Translation(-head)@b.matrix
  bpy.context.view_layer.update()
 # Keep the support ankle planted; retain captured torso/arm counterbalance.
 hips=arm.pose.bones['Hips'];m=hips.matrix.copy();m.translation.z+=.12-arm.pose.bones['Foot.L'].head.z;hips.matrix=m
 bpy.context.view_layer.update()
 for b in arm.pose.bones:
  b.keyframe_insert('rotation_quaternion',frame=j+1);b.keyframe_insert('location',frame=j+1)
 track.append({'time':j/30,'rightFoot':list(arm.pose.bones['Foot.R'].head),'rightToe':list(arm.pose.bones['Toe.R'].head),'leftFoot':list(arm.pose.bones['Foot.L'].head)})
for fc in action.fcurves:
 for key in fc.keyframe_points:key.interpolation='LINEAR'
reset();bpy.context.scene.render.fps=30
for unused in list(bpy.data.actions):
 if unused.name not in {'Idle','Walk','Jog','Sprint','Kick','Pass','Celebrate'}:bpy.data.actions.remove(unused)
 else:unused.use_fake_user=True
metadata={'capture':'CMU 10_01','sourceFrames':[start,end],'contactFrame':contact,'clip':'Pass','duration':.8,'contactTime':.4,'samples':track}
open(os.path.join(OUT,'football-strike.json'),'w').write(json.dumps(metadata,indent=2))
materials=[{'name':'HumanSkin','albedo':'HumanAtlas.png','normal':'HumanAtlas_normal.png'}, {'name':'HumanDetail','albedo':'HumanAtlas.png'}, {'name':'FootballFace','albedo':'FootballFace.png','normal':'FootballFace_normal.png'}, {'name':'FootballUniform','albedo':'FootballKit.png','normal':'FootballKit_normal.png'}]
open(os.path.join(OUT,'football-materials.json'),'w').write(json.dumps({'materials':materials},indent=2))
# Reuse the existing LOD/export convention; each football LOD now has 4 surfaces.
tree=ast.parse(open('tools/sports-assets/upgrade-unity-human.py').read())
for node in tree.body:
 if isinstance(node,ast.FunctionDef) and node.name=='export':exec(compile(ast.Module(body=[node],type_ignores=[]),'<football export>','exec'))
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(CACHE,'football-performance.blend'))
export('FootballPlayer')
print('FOOTBALL_PERFORMANCE_READY',len(human.data.vertices),[m.name for m in human.data.materials])
