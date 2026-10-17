"""Render the licensed full-resolution source into inexpensive distant-tree cards.

Run from the repo root with Blender --background --factory-startup --disable-autoexec.
The close trunk mesh is unnecessary at 100m; these retain the original leaf silhouette.
"""
import bpy, os, math
from mathutils import Vector

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.abspath('.cache/horse-realism/tree/island_tree_01.gltf'))
scene = bpy.context.scene
meshes = [obj for obj in scene.objects if obj.type == 'MESH']
points = [obj.matrix_world @ Vector(corner) for obj in meshes for corner in obj.bound_box]
lo = Vector(tuple(min(p[i] for p in points) for i in range(3)))
hi = Vector(tuple(max(p[i] for p in points) for i in range(3)))
center = (lo + hi) * .5
print('TREE_BOUNDS', list(lo), list(hi), flush=True)
scene.render.engine = 'CYCLES'
scene.cycles.samples = 24
scene.cycles.use_denoising = True
scene.cycles.transparent_max_bounces = 12
scene.render.film_transparent = True
scene.render.resolution_x = 768
scene.render.resolution_y = 768
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
scene.world = bpy.data.worlds.new('Soft open sky')
scene.world.use_nodes = True
scene.world.node_tree.nodes['Background'].inputs[0].default_value = (.62, .73, .85, 1)
scene.world.node_tree.nodes['Background'].inputs[1].default_value = .7
scene.view_settings.view_transform = 'Standard'
scene.view_settings.look = 'Medium High Contrast'
sun_data = bpy.data.lights.new('Sun', 'SUN')
sun_data.energy = 2.2
sun_data.angle = .15
sun = bpy.data.objects.new('Sun', sun_data)
scene.collection.objects.link(sun)
sun.rotation_euler = (math.radians(28), math.radians(-30), math.radians(-25))
camera_data = bpy.data.cameras.new('Tree camera')
camera = bpy.data.objects.new('Tree camera', camera_data)
scene.collection.objects.link(camera)
scene.camera = camera
camera_data.type = 'ORTHO'
camera_data.ortho_scale = max(hi.z - lo.z, hi.x - lo.x, hi.y - lo.y) * 1.07
out = os.path.abspath('artifacts/3d-game/public/assets/horse-racing/realistic')
for index, angle in enumerate([0, 1.25]):
    camera.location = center + Vector((math.sin(angle) * 20, -math.cos(angle) * 20, .35))
    camera.rotation_euler = (center - camera.location).to_track_quat('-Z', 'Y').to_euler()
    scene.render.filepath = os.path.join(out, 'tree-canopy-' + str(index) + '.png')
    bpy.ops.render.render(write_still=True)
