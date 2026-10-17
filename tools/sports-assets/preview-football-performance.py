import bpy,os,math,json
from mathutils import Vector
bpy.ops.wm.open_mainfile(filepath=os.path.abspath('.cache/football-pro/football-performance.blend'))
arm=bpy.data.objects['FootballRig'];human=bpy.data.objects['Athlete_LOD0']
for m in human.data.materials:
 if m.name=='FootballFace':
  bs=m.node_tree.nodes.get('Principled BSDF');tex=bs.inputs['Base Color'].links[0].from_socket
  mix=m.node_tree.nodes.new('ShaderNodeMixRGB');mix.blend_type='MULTIPLY';mix.inputs[0].default_value=1;mix.inputs[2].default_value=(1.6,1.5,1.4,1);m.node_tree.links.new(tex,mix.inputs[1]);m.node_tree.links.new(mix.outputs[0],bs.inputs['Base Color'])
 if m.name=='FootballUniform':
  bs=m.node_tree.nodes.get('Principled BSDF');tex=bs.inputs['Base Color'].links[0].from_socket
  mix=m.node_tree.nodes.new('ShaderNodeMixRGB');mix.blend_type='MULTIPLY';mix.inputs[0].default_value=1;mix.inputs[2].default_value=(.035,.13,.38,1);m.node_tree.links.new(tex,mix.inputs[1]);m.node_tree.links.new(mix.outputs[0],bs.inputs['Base Color'])
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=12;scene.cycles.use_denoising=True
scene.world=bpy.data.worlds.new('Preview');scene.world.use_nodes=True;scene.world.node_tree.nodes.get('Background').inputs[0].default_value=(.3,.4,.6,1);scene.world.node_tree.nodes.get('Background').inputs[1].default_value=.6
bpy.ops.object.light_add(type='AREA',location=(2,-3,4));bpy.context.object.data.energy=400;bpy.context.object.data.size=4;bpy.context.object.rotation_euler=(Vector((0,0,1))-bpy.context.object.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.camera_add(location=(2,-4,2.3));camera=bpy.context.object;camera.rotation_euler=(Vector((0,0,.95))-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.lens=65;scene.camera=camera
bpy.ops.mesh.primitive_plane_add(size=200);plane=bpy.context.object;plane.location.z=-.01
m=bpy.data.materials.new('Ground');m.diffuse_color=(.13,.18,.14,1);plane.data.materials.append(m)
scene.render.resolution_x=800;scene.render.resolution_y=900;scene.render.resolution_percentage=100
for clip,frame in [('Idle',1),('Pass',13)]:
 arm.animation_data.action=bpy.data.actions[clip];scene.frame_set(frame)
 scene.render.filepath=os.path.abspath('tmp/unity-sports/football-'+clip.lower()+'.png');bpy.ops.render.render(write_still=True)
print('FOOTBALL_POSES_RENDERED')
