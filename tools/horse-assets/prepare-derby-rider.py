"""Make a compact two-point racing seat from the prepared, licensed rider.

Run Blender with --disable-autoexec .cache/horse-realism/prepared-rider.blend.
The previous rider asset is retained. Export a separate mounted rider revision.
"""
import bpy, os, json, math
from mathutils import Vector, Matrix

arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
scene = bpy.context.scene
scene.frame_set(1)
bpy.context.view_layer.update()
def bone(name): return arm.pose.bones['mixamorig:' + name]
def aim(name, child, direction):
    b = bone(name)
    head = b.head.copy()
    target = arm.matrix_world.inverted().to_3x3() @ Vector(direction)
    turn = (bone(child).head - head).rotation_difference(target)
    b.matrix = Matrix.Translation(head) @ turn.to_matrix().to_4x4() @ Matrix.Translation(-head) @ b.matrix
    bpy.context.view_layer.update()

aim('Spine', 'Spine1', (0, -.998, .065))
aim('Spine1', 'Spine2', (0, -.998, .065))
aim('Spine2', 'Neck', (0, -.998, .065))
aim('Neck', 'Head', (0, -.36, .93))
for side, sign in [('Left', 1), ('Right', -1)]:
    aim(side + 'Arm', side + 'ForeArm', (sign * .15, .27, -.95))
    aim(side + 'ForeArm', side + 'Hand', (-sign * .14, -.98, .12))
    aim(side + 'Hand', side + 'HandMiddle1', (0, -1, -.04))

master = bpy.data.objects['MountedRider']
master.location.y -= .18
master.location.z -= .10
for b in arm.pose.bones:
    b.keyframe_insert('rotation_quaternion', frame=1)
    b.keyframe_insert('location', frame=1)
    b.keyframe_insert('scale', frame=1)
scene.frame_set(1)
bpy.context.view_layer.update()
out = os.path.abspath('artifacts/3d-game/public/assets/horse-racing/realistic/derby')
os.makedirs(out, exist_ok=True)
points = {name: list(arm.matrix_world @ bone(name).head) for name in ['Hips', 'Spine', 'Neck', 'Head', 'LeftHand', 'RightHand', 'LeftFoot', 'RightFoot']}
assert all(math.isfinite(c) for p in points.values() for c in p)
assert points['Head'][2] < 3.0, points
bpy.ops.export_scene.gltf(filepath=os.path.join(out, 'jockey-crouch-v1.glb'),
    export_format='GLB', export_animations=True, export_animation_mode='ACTIONS',
    export_image_format='WEBP', export_image_quality=90, export_yup=True,
    export_current_frame=True, export_rest_position_armature=False, export_morph=False)
with open(os.path.join(out, 'rider-pose.json'), 'w') as f:
    json.dump({'source': 'prepared-rider.blend', 'pose': 'two-point race crouch', 'blenderWorldPoints': points}, f, indent=2)
print('DERBY_RIDER_VALIDATED', json.dumps(points))
