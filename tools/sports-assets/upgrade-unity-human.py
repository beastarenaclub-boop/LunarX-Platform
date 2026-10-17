"""Detailed CC0 human head, athletic kit, baked material atlases and three LODs.

Reads the existing football rig without modifying it or the shared horse assets.
Run with Blender 4.2 --background --threads 2 --python this-file.
"""
import bpy,bmesh,os,math,json,shutil,numpy as np
from mathutils import Vector
ROOT=os.getcwd();OUT=os.path.join(ROOT,'artifacts/unity-sports/Assets/Resources/Sports')
TEX=os.path.join(OUT,'Textures');os.makedirs(TEX,exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=os.path.join(ROOT,'.cache/football-pro/football-rig.blend'))
arm=bpy.data.objects['FootballRig'];arm.animation_data.action=None
for b in arm.pose.bones:b.rotation_quaternion=(1,0,0,0);b.location=(0,0,0);b.scale=(1,1,1)
bpy.context.view_layer.update()

def activate(o):
 bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o
def remove_faces(o,predicate):
 bm=bmesh.new();bm.from_mesh(o.data);bmesh.ops.delete(bm,geom=[f for f in bm.faces if predicate(f)],context='FACES');bm.to_mesh(o.data);bm.free()
def material(name,color=(1,1,1,1),texture=None,normal=None):
 m=bpy.data.materials.new(name);m.use_nodes=True;bs=m.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=color;bs.inputs['Roughness'].default_value=.7
 for filename,is_normal in [(texture,False),(normal,True)]:
  if not filename:continue
  tex=m.node_tree.nodes.new('ShaderNodeTexImage');tex.image=bpy.data.images.load(os.path.join(ROOT,'.cache/horse-realism',filename),check_existing=True)
  if is_normal:
   tex.image.colorspace_settings.name='Non-Color';n=m.node_tree.nodes.new('ShaderNodeNormalMap');n.inputs['Strength'].default_value=.35;m.node_tree.links.new(tex.outputs['Color'],n.inputs['Color']);m.node_tree.links.new(n.outputs['Normal'],bs.inputs['Normal'])
  else:m.node_tree.links.new(tex.outputs['Color'],bs.inputs['Base Color'])
 return m

body=next(o for o in bpy.data.objects if o.type=='MESH' and 'anatomical body' in o.name)
# Keep hands, arms and legs; the detailed head includes its own neck.
remove_faces(body,lambda f:f.calc_center_median().z>1.51 or (1.02<f.calc_center_median().z<1.49 and abs(f.calc_center_median().x)<.21) or (1.42<f.calc_center_median().z<1.56 and .10<abs(f.calc_center_median().x)<.27))
skin=material('HumanArms',(.48,.285,.19,1));body.data.materials.clear();body.data.materials.append(skin)
for p in body.data.polygons:p.material_index=0
for o in list(bpy.data.objects):
 if o.type=='MESH' and o.name in ['short01','eyebrow001','low-poly']:bpy.data.objects.remove(o,do_unlink=True)
# Remove the large embossed source normals: sports fabric should not resemble
# melted skin. Reshape the front into a relaxed, continuous athletic jersey.
kit=bpy.data.objects['male_casualsuit04']
activate(kit)
# glTF splits vertices at UV seams. Weld positions before smoothing so the
# collar, sleeves and side panels remain sewn together.
bm=bmesh.new();bm.from_mesh(kit.data);bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.00015);bm.to_mesh(kit.data);bm.free()
smooth=kit.modifiers.new('Relax sports fabric','SMOOTH');smooth.factor=.65;smooth.iterations=5;smooth.use_z=False
while kit.modifiers.find(smooth.name)>0:bpy.ops.object.modifier_move_up(modifier=smooth.name)
bpy.ops.object.modifier_apply(modifier=smooth.name)
for v in kit.data.vertices:
 x,y,z=v.co
 if 1.10<z<1.47 and abs(x)<.185 and y<-.06:
  target=-.137+.028*(abs(x)/.185)**2
  v.co.y=y*.15+target*.85
 if z>1.08:
  # Continuous chest/sleeve weights avoid noisy nearest-surface bindings.
  if abs(x)>.18 and z>1.28:
   weight=max(0,min(1,(abs(x)-.18)/.115));weights={'Chest':1-weight,'Arm.'+('L' if x>0 else 'R'):weight}
  else:
   weight=max(0,min(1,(z-1.17)/.25));weights={'Spine':1-weight,'Chest':weight}
  for g in kit.vertex_groups:g.remove([v.index])
  for name,w in weights.items():kit.vertex_groups[name].add([v.index],w,'REPLACE')
for name in ['FootballJersey','FootballShorts','FootballSocks']:
 m=bpy.data.materials[name];bs=m.node_tree.nodes.get('Principled BSDF')
 for socket in ['Normal','Base Color']:
  for link in list(bs.inputs[socket].links):m.node_tree.links.remove(link)
 bs.inputs['Base Color'].default_value=(.84,.84,.84,1) if name!='FootballShorts' else (.11,.14,.20,1)
# A subtle woven normal is authored as a material, then baked with the atlas.
 m.node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value=.88

before=set(bpy.data.objects);bpy.ops.import_scene.gltf(filepath=os.path.join(ROOT,'.cache/horse-realism/vitruvian_head.glb'))
headparts=[]
for o in set(bpy.data.objects)-before:
 if o.type!='MESH':continue
 if o.name.startswith('Eyeshadow'):bpy.data.objects.remove(o,do_unlink=True);continue
 if o.data.shape_keys:o.shape_key_clear()
 world=o.matrix_world.copy();o.parent=None;o.matrix_world=world;activate(o);bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
 hidden=[i for i,m in enumerate(o.data.materials) if m.name=='VitMouth' or m.name.startswith('VitCornea')]
 remove_faces(o,lambda f:f.material_index in hidden)
 # Match the face's eye line and chin to the existing 1.84m skeleton.
 for v in o.data.vertices:
  v.co.x*=.94;v.co.y-=.096;v.co.z+=.064
  if v.co.z<1.57:v.co.z-=max(0,(1.57-v.co.z)/.036)*.045
  # A slightly broader jaw, retaining the source eyelids, lips and nose.
  if 1.60<v.co.z<1.68:v.co.x*=1.055
 o.vertex_groups.clear();o.vertex_groups.new(name='Head').add(list(range(len(o.data.vertices))),1,'REPLACE')
 for mod in list(o.modifiers):o.modifiers.remove(mod)
 o.parent=arm;o.modifiers.new('Human skin','ARMATURE').object=arm;headparts.append(o)
head=next(o for o in headparts if any(m.name=='VitSkin' for m in o.data.materials))
face=material('HumanFace',texture='vit_face_bc.png',normal='vit_face_n.png')
sclera=material('HumanSclera',texture='vit_sclera.png');iris=material('HumanIris',texture='vit_iris.png')
eyeback=material('HumanEyeBack',(.015,.012,.009,1));tear=material('HumanTearline',(.30,.12,.09,1))
for o in headparts:
 for i,m in enumerate(o.data.materials):
  o.data.materials[i]=face if m.name=='VitSkin' else sclera if m.name.startswith('VitSclera') else iris if m.name.startswith('VitIris') else eyeback if m.name.startswith('VitEyeBack') else tear
 for p in o.data.polygons:p.use_smooth=True
# Close-cropped geometric hair follows the actual scalp rather than a sphere.
hair=head.copy();hair.data=head.data.copy();hair.name='CroppedHair';bpy.context.collection.objects.link(hair)
remove_faces(hair,lambda f:f.calc_center_median().z < (1.755 if f.calc_center_median().y<-.10 else 1.70))
for v in hair.data.vertices:
 v.co+=v.normal*(.0025+.0015*math.sin(v.co.x*530)*math.sin(v.co.y*390))
hair.data.materials.clear();hair.data.materials.append(material('HumanHair',(.028,.019,.013,1)))
for p in hair.data.polygons:p.material_index=0
hm=hair.data.materials[0];hn=hm.node_tree.nodes;hl=hm.node_tree.links;noise=hn.new('ShaderNodeTexNoise');noise.inputs['Scale'].default_value=220
ramp=hn.new('ShaderNodeValToRGB');ramp.color_ramp.elements[0].color=(.008,.005,.003,1);ramp.color_ramp.elements[1].color=(.055,.036,.021,1)
hl.new(noise.outputs['Fac'],ramp.inputs[0]);hl.new(ramp.outputs['Color'],hn.get('Principled BSDF').inputs['Base Color'])

# Strip unused source materials and merge the 20+ skinned objects before bake.
meshes=[o for o in bpy.data.objects if o.type=='MESH']
for o in list(bpy.data.objects):
 if o.type!='MESH' and o!=arm:bpy.data.objects.remove(o,do_unlink=True)
for o in meshes:
 activate(o)
 if o.data.has_custom_normals:bpy.ops.mesh.customdata_custom_splitnormals_clear()
 if len(o.data.vertices)>2500:
  dec=o.modifiers.new('Detail budget','DECIMATE');dec.ratio=.46 if o==head else .42
  while o.modifiers.find(dec.name)>0:bpy.ops.object.modifier_move_up(modifier=dec.name)
  bpy.ops.object.modifier_apply(modifier=dec.name)
 for p in o.data.polygons:p.use_smooth=True
 # Preserve source UVs explicitly when the atlas becomes the active UV layer.
 if not o.data.uv_layers:o.data.uv_layers.new(name='SourceUV')
 o.data.uv_layers.active.name='SourceUV'
 for m in o.data.materials:
  if not m or not m.use_nodes:continue
  for node in list(m.node_tree.nodes):
   if node.type=='TEX_IMAGE' and not node.inputs['Vector'].is_linked:
    uv=m.node_tree.nodes.new('ShaderNodeUVMap');uv.uv_map='SourceUV';m.node_tree.links.new(uv.outputs['UV'],node.inputs['Vector'])
activate(body)
for o in meshes:o.select_set(True)
bpy.ops.object.join();human=body;human.name='Athlete_LOD0'
for mod in list(human.modifiers):human.modifiers.remove(mod)
human.modifiers.new('Skin','ARMATURE').object=arm
# Bake three material atlases: human skin, non-tinted detail, and team uniform.
# Every LOD has one renderer and only three draw surfaces.
groups={'HumanSkin':[],'HumanDetail':[],'HumanUniform':[]}
for i,m in enumerate(human.data.materials):
 group='HumanSkin' if m.name in ['HumanFace','HumanArms'] else 'HumanUniform' if m.name.startswith('Football') else 'HumanDetail'
 groups[group].append(i)
human.data.uv_layers.new(name='Atlas');human.data.uv_layers.active_index=human.data.uv_layers.find('Atlas');human.data.uv_layers['Atlas'].active_render=True
activate(human);bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.uv.smart_project(angle_limit=1.15,island_margin=.012);bpy.ops.object.mode_set(mode='OBJECT')
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=1;scene.render.bake.margin=8;scene.render.bake.use_clear=False
scene.render.bake.use_pass_direct=False;scene.render.bake.use_pass_indirect=False;scene.render.bake.use_pass_color=True
mapping=[];newmats=[];indices={}
for normal in [False,True]:
 suffix='_normal' if normal else '';im=bpy.data.images.new('HumanAtlas'+suffix,width=2048,height=2048,alpha=False)
 if normal:im.colorspace_settings.name='Non-Color';im.generated_color=(.5,.5,1,1)
 nodes=[]
 for m in set(human.data.materials):
  node=m.node_tree.nodes.new('ShaderNodeTexImage');node.image=im;m.node_tree.nodes.active=node;nodes.append((m,node))
 bpy.ops.object.bake(type='NORMAL' if normal else 'DIFFUSE',uv_layer='Atlas')
 im.filepath_raw=os.path.join(TEX,'HumanAtlas'+suffix+'.png');im.file_format='PNG';im.save()
 for m,n in nodes:m.node_tree.nodes.remove(n)
for group,slots in groups.items():
 entry={'name':group,'color':[1,1,1,1],'albedo':'HumanAtlas.png'}
 if group=='HumanSkin':entry['normal']='HumanAtlas_normal.png'
 mapping.append(entry);mat=material(group);newmats.append(mat)
 for i in slots:indices[i]=len(newmats)-1
face_materials=[indices[p.material_index] for p in human.data.polygons]
human.data.materials.clear()
for m in newmats:human.data.materials.append(m)
for p,index in zip(human.data.polygons,face_materials):p.material_index=index
atlas_values=np.empty(len(human.data.loops)*2,dtype=np.float32)
human.data.uv_layers['Atlas'].data.foreach_get('uv',atlas_values)
# Blender's layer RNA references change when earlier UV layers are removed.
# Copy the values first, then reconstruct UV0; retaining a layer object loses
# the atlas data while appearing to leave a correctly named UV layer behind.
while human.data.uv_layers:human.data.uv_layers.remove(human.data.uv_layers[0])
atlas=human.data.uv_layers.new(name='UVMap');atlas.data.foreach_set('uv',atlas_values);atlas.active_render=True
for i,m in enumerate(newmats):
 bs=m.node_tree.nodes.get('Principled BSDF');tex=m.node_tree.nodes.new('ShaderNodeTexImage');tex.image=bpy.data.images.load(os.path.join(TEX,mapping[i]['albedo']));m.node_tree.links.new(tex.outputs['Color'],bs.inputs['Base Color'])

def export(name):
 assert len(human.data.uv_layers)==1,'The baked atlas must be UV0 for Unity.'
 lods=[human]
 for level,ratio in [(1,.35),(2,.10)]:
  o=human.copy();o.data=human.data.copy();o.name='Athlete_LOD'+str(level);bpy.context.collection.objects.link(o);activate(o)
  d=o.modifiers.new('Distance reduction','DECIMATE');d.ratio=ratio
  while o.modifiers.find(d.name)>0:bpy.ops.object.modifier_move_up(modifier=d.name)
  bpy.ops.object.modifier_apply(modifier=d.name);lods.append(o)
 bpy.ops.object.select_all(action='DESELECT');arm.select_set(True)
 for o in lods:o.select_set(True)
 bpy.context.view_layer.objects.active=arm
 bpy.ops.export_scene.fbx(filepath=os.path.join(OUT,name+'.fbx'),use_selection=True,object_types={'ARMATURE','MESH'},add_leaf_bones=False,apply_unit_scale=True,apply_scale_options='FBX_SCALE_ALL',axis_forward='-Z',axis_up='Y',bake_anim=True,bake_anim_use_all_actions=True,bake_anim_use_nla_strips=False,bake_anim_force_startend_keying=True,bake_anim_simplify_factor=.25,use_mesh_modifiers=True)
 print('HUMAN_LODS',name,json.dumps([{'name':o.name,'vertices':len(o.data.vertices),'triangles':sum(len(p.vertices)-2 for p in o.data.polygons),'materials':len(o.data.materials)} for o in lods]))
 for o in lods[1:]:bpy.data.objects.remove(o,do_unlink=True)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT,'.cache/football-pro/human-football.blend'))
export('FootballPlayer')
# Author continuous trouser legs. The source body deliberately omits skin under
# shorts, so extending copied skin cannot form a closed pair of trousers.
uniform=next(p for p in human.data.polygons if p.material_index==2 and all(1.2<human.data.vertices[i].co.z<1.4 and abs(human.data.vertices[i].co.x)<.1 for i in p.vertices))
uv=sum((human.data.uv_layers.active.data[i].uv for i in uniform.loop_indices),Vector((0,0)))/len(uniform.loop_indices)
leg_groups={g.index for g in human.vertex_groups if g.name.startswith(('Thigh.','Shin.','Foot.','Toe.'))}
def lower_leg_face(f):
 limit=.96 if f.material_index==0 else .69
 return all(.13<v.co.z<limit and abs(v.co.x)<.27 and sum(g.weight for g in human.data.vertices[v.index].groups if g.group in leg_groups)>.4 for v in f.verts)
remove_faces(human,lambda f:lower_leg_face(f) and f.material_index in [0,2])
# Match the existing shorts to the long-leg material.
for p in human.data.polygons:
 if p.material_index==2 and all(human.data.vertices[i].co.z<1.08 for i in p.vertices):
  for i in p.loop_indices:human.data.uv_layers.active.data[i].uv=uv
vertices=[];faces=[];rings=[(.88,.082),(.76,.088),(.65,.09),(.54,.084),(.43,.08),(.29,.074),(.13,.064)];segments=24
for side in [-1,1]:
 start=len(vertices)
 for row,(z,radius) in enumerate(rings):
  for i in range(segments):
   angle=i*math.tau/segments;crease=1+.035*math.sin(angle*5+row*.7)
   vertices.append((side*(.12+(1-z)*.027)+math.cos(angle)*radius*crease,-.012+math.sin(angle)*radius*.91*crease,z))
 for row in range(len(rings)-1):
  for i in range(segments):
   a=start+row*segments+i;b=start+row*segments+(i+1)%segments;faces.append((a,a+segments,b+segments,b))
mesh=bpy.data.meshes.new('Continuous trouser legs');mesh.from_pydata(vertices,[],faces);mesh.update()
pants=bpy.data.objects.new('Cricket trousers',mesh);bpy.context.collection.objects.link(pants);pants.parent=arm
mesh.materials.append(newmats[2]);mesh.uv_layers.new(name='UVMap')
for loop in mesh.uv_layers.active.data:loop.uv=uv
for p in mesh.polygons:p.use_smooth=True
groups={name:pants.vertex_groups.new(name=name) for name in ['Thigh.L','Thigh.R','Shin.L','Shin.R']}
for v in mesh.vertices:
 side='R' if v.index<len(rings)*segments else 'L';w=max(0,min(1,(v.co.z-.4)/.25));w=w*w*(3-2*w)
 groups['Thigh.'+side].add([v.index],w,'REPLACE');groups['Shin.'+side].add([v.index],1-w,'REPLACE')
pants.modifiers.new('Skin','ARMATURE').object=arm
activate(human);pants.select_set(True);bpy.ops.object.join();export('CricketPlayer')
open(os.path.join(OUT,'materials.json'),'w').write(json.dumps({'materials':mapping},indent=2))
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT,'.cache/football-pro/human-upgrade.blend'))
print('HUMAN_UPGRADE_READY')
