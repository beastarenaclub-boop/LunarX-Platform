import bpy,bmesh,os,math
from mathutils import Vector,Matrix,Quaternion
arm=bpy.data.objects['mixamo_vitruvian'];arm.animation_data_clear()
for a in list(bpy.data.actions):bpy.data.actions.remove(a)
master=bpy.data.objects['MountedRider'];master.scale=(1,1,1);master.location=(0,0,0)
for b in arm.pose.bones:b.rotation_quaternion=Quaternion();b.location=(0,0,0);b.scale=(1,1,1)
bpy.context.view_layer.update()
def bone(n):return arm.pose.bones['mixamorig:'+n]
def aim(name,child,direction):
 b=bone(name);head=b.head.copy();q=(bone(child).head-head).rotation_difference(arm.matrix_world.inverted().to_3x3()@Vector(direction));b.matrix=Matrix.Translation(head)@q.to_matrix().to_4x4()@Matrix.Translation(-head)@b.matrix;bpy.context.view_layer.update()
for side,sign in [('Left',1),('Right',-1)]:
 aim(side+'UpLeg',side+'Leg',(sign*.1,-1,-.05));aim(side+'Leg',side+'Foot',(0,0,-1));aim(side+'Foot',side+'ToeBase',(0,-1,-.2))
 aim(side+'Arm',side+'ForeArm',(sign*.1,-.1,-1));aim(side+'ForeArm',side+'Hand',(-sign*.3,-1,.1))
master.location=Vector((0,0,.61))-(arm.matrix_world@bone('Hips').head)
bpy.context.view_layer.update()
# Bake the posed human into a small static mesh, suitable for GPU crowd instancing.
for o in list(bpy.data.objects):
 if o.type!='MESH':continue
 evaluated=o.evaluated_get(bpy.context.evaluated_depsgraph_get());mesh=bpy.data.meshes.new_from_object(evaluated);world=o.matrix_world.copy();o.modifiers.clear();o.data=mesh;o.parent=None;o.matrix_world=world
 bpy.context.view_layer.objects.active=o
 dec=o.modifiers.new('Crowd LOD','DECIMATE');dec.ratio=.018
 bpy.ops.object.modifier_apply(modifier=dec.name)
 for p in o.data.polygons:p.use_smooth=True
 bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
# Head hair cap: a small fitted cap prevents a uniformly bald crowd silhouette.
head=bone('Head');p=arm.matrix_world@head.head
bpy.ops.mesh.primitive_uv_sphere_add(segments=12,ring_count=6,location=(p.x,p.y+.01,p.z+.15),scale=(.093,.106,.083))
hair=bpy.context.object;hair.name='CrowdHair';mat=bpy.data.materials.new('CrowdHair');mat.diffuse_color=(.025,.016,.01,1);mat.use_nodes=True;mat.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=(.025,.016,.01,1);hair.data.materials.append(mat)
for o in list(bpy.data.objects):
 if o.type!='MESH':bpy.data.objects.remove(o,do_unlink=True)
for m in bpy.data.materials:
 if not m.use_nodes:continue
 for n in m.node_tree.nodes:
  if n.type=='TEX_IMAGE' and n.image:
   if 'fabric' in n.image.name or n.image.colorspace_settings.name=='Non-Color':
    for l in list(n.outputs['Color'].links):m.node_tree.links.remove(l)
   else:n.image.scale(256,256)
  if n.type=='BSDF_PRINCIPLED':
   if m.name=='VitShirt':n.inputs['Base Color'].default_value=(.8,.8,.8,1)
   if m.name=='VitPants':n.inputs['Base Color'].default_value=(.05,.07,.09,1)
bpy.ops.export_scene.gltf(filepath=os.path.abspath('artifacts/3d-game/public/assets/horse-racing/realistic/spectator.glb'),export_format='GLB',export_animations=False,export_image_format='WEBP',export_image_quality=80,export_yup=True,export_skins=False,export_morph=False)
print('CROWD_VERTICES',sum(len(o.data.vertices) for o in bpy.data.objects if o.type=='MESH'))

