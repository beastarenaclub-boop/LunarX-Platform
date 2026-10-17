import bpy,os,math
from mathutils import Vector
bpy.ops.wm.open_mainfile(filepath=os.path.abspath('.cache/football-pro/human-upgrade.blend'))
arm=bpy.data.objects['FootballRig'];arm.animation_data.action=next(a for a in bpy.data.actions if a.name=='Idle');bpy.context.scene.frame_set(1)
for m in bpy.data.materials:
 if m.name=='HumanUniform':m.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=(.4,.5,.8,1)
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=12
scene.world=bpy.data.worlds.new('Preview world');scene.world.use_nodes=True;scene.world.node_tree.nodes.get('Background').inputs[0].default_value=(.5,.55,.65,1);scene.world.node_tree.nodes.get('Background').inputs[1].default_value=.5
bpy.ops.object.light_add(type='AREA',location=(2,-3,4));bpy.context.object.data.energy=300;bpy.context.object.data.shape='DISK';bpy.context.object.data.size=4
bpy.context.object.rotation_euler=(Vector((0,0,1.3))-bpy.context.object.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.camera_add(location=(.7,-2.6,1.9));camera=bpy.context.object;camera.rotation_euler=(Vector((0,-.07,1.35))-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.lens=65;scene.camera=camera
scene.render.resolution_x=640;scene.render.resolution_y=800;scene.render.resolution_percentage=100
scene.render.filepath=os.path.abspath('tmp/unity-sports/human-preview.png');bpy.ops.render.render(write_still=True)
