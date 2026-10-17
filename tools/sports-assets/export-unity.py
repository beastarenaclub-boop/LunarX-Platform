"""Export the authored CC0 sports rig and its six clips to Unity-friendly FBX.
Run with Blender --background --factory-startup --python this-file.
"""
import bpy,os,bmesh,json,shutil
from mathutils import Vector
ROOT=os.getcwd()
OUT=os.path.join(ROOT,'artifacts/unity-sports/Assets/Resources/Sports')
os.makedirs(OUT,exist_ok=True)
textures=os.path.join(OUT,'Textures');os.makedirs(textures,exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=os.path.join(ROOT,'.cache/football-pro/football-rig.blend'))
arm=bpy.data.objects['FootballRig'];arm.animation_data.action=None
for b in arm.pose.bones:b.rotation_quaternion=(1,0,0,0);b.location=(0,0,0);b.scale=(1,1,1)
bpy.context.view_layer.update()
# Remove skin concealed by the kit, preventing exposed shoulder patches in
# extreme football actions while retaining the neck and visible upper arms.
body=next(o for o in bpy.data.objects if o.type=='MESH' and 'anatomical body' in o.name)
bm=bmesh.new();bm.from_mesh(body.data)
hidden=[]
for f in bm.faces:
 p=f.calc_center_median();x,y,z=p
 if (1.05<z<1.48 and abs(x)<.19) or (1.44<z<1.555 and .105<abs(x)<.265):hidden.append(f)
bmesh.ops.delete(bm,geom=hidden,context='FACES');bm.to_mesh(body.data);bm.free()
mapping={}
for mat in bpy.data.materials:
 if not mat.use_nodes:continue
 entry={}
 bs=next((n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED'),None)
 if bs:
  entry['color']=list(bs.inputs['Base Color'].default_value)
  links=bs.inputs['Base Color'].links
  if links and links[0].from_node.type=='TEX_IMAGE':
   image=links[0].from_node.image
   safe=''.join(c if c.isalnum() or c in '-_' else '_' for c in mat.name)
   filename=safe+'.png';image.file_format='PNG';image.filepath_raw=os.path.join(textures,filename);image.save()
   entry['albedo']=filename
  if bs.inputs['Normal'].links:
   norm=bs.inputs['Normal'].links[0].from_node
   if norm.type=='NORMAL_MAP' and norm.inputs['Color'].links:
    tex=norm.inputs['Color'].links[0].from_node
    if tex.type=='TEX_IMAGE':
     image=tex.image;filename=''.join(c if c.isalnum() else '_' for c in mat.name)+'_normal.png';image.file_format='PNG';image.filepath_raw=os.path.join(textures,filename);image.save();entry['normal']=filename
 mapping[mat.name]=entry
open(os.path.join(OUT,'materials.json'),'w').write(json.dumps({'materials':[dict(name=k,**v) for k,v in mapping.items()]},indent=2))

def export(name):
 bpy.ops.object.select_all(action='DESELECT')
 for o in bpy.data.objects:
  if o.type in ['ARMATURE','MESH']:o.select_set(True)
 bpy.context.view_layer.objects.active=arm
 bpy.ops.export_scene.fbx(filepath=os.path.join(OUT,name+'.fbx'),use_selection=True,object_types={'ARMATURE','MESH'},add_leaf_bones=False,apply_unit_scale=True,apply_scale_options='FBX_SCALE_ALL',axis_forward='-Z',axis_up='Y',bake_anim=True,bake_anim_use_all_actions=True,bake_anim_use_nla_strips=False,bake_anim_force_startend_keying=True,bake_anim_simplify_factor=.25,path_mode='RELATIVE',use_mesh_modifiers=True)
export('FootballPlayer')
# Cricket trousers follow the same skinned legs as the body. Keep the original
# body's weights, normals and rest coordinates; extend the kit to the ankles.
pants=body.copy();pants.data=body.data.copy();pants.name='CricketTrousers';bpy.context.collection.objects.link(pants)
bm=bmesh.new();bm.from_mesh(pants.data)
bmesh.ops.delete(bm,geom=[f for f in bm.faces if not all(.13<v.co.z<1.045 and abs(v.co.x)<.25 for v in f.verts)],context='FACES')
for v in bm.verts:
 center=.14 if v.co.x>=0 else -.14;v.co.x=center+(v.co.x-center)*1.14;v.co.y*=1.13
bm.to_mesh(pants.data);bm.free()
kit=bpy.data.materials['FootballJersey'];pants.data.materials.clear();pants.data.materials.append(kit)
for f in pants.data.polygons:f.material_index=0
export('CricketPlayer')
src=os.path.join(ROOT,'artifacts/3d-game/src/components/virtual-sports/assets')
for filename in ['grass-color.jpg','grass-normal.jpg','daylight.hdr','football-fans.png','CREDITS.txt','football-fans-provenance.json','football-animations-LICENSE.txt']:
 shutil.copyfile(os.path.join(src,filename),os.path.join(textures if filename.endswith(('.jpg','.png','.hdr')) else OUT,filename))
print('UNITY_ASSETS_READY',OUT)
