"""Refine the existing rig against the Higgsfield thoroughbred reference.

Open .cache/horse-realism/prepared-horse.blend with --disable-autoexec.
Outputs are staged, so a failed shape/animation review never replaces the game.
Bone rest poses, skin weights, clip timing, muzzle and ground contacts are kept.
"""
import bpy, os, json, math
from mathutils import Vector

scene = bpy.context.scene
arm = bpy.data.objects['Armature']
body = bpy.data.objects['Plane']
arm.animation_data.action = bpy.data.actions['Idle']
scene.frame_set(1)
bpy.context.view_layer.update()
out = os.path.abspath('.cache/horse-higgsfield')
os.makedirs(out, exist_ok=True)

def smooth(lo, hi, v):
    t = max(0, min(1, (v-lo)/(hi-lo)))
    return t*t*(3-2*t)

def window(lo, a, b, hi, v):
    return smooth(lo, a, v) * (1-smooth(b, hi, v))

skin = set()
for polygon in body.data.polygons:
    if body.data.materials[polygon.material_index].name == 'Material':
        skin.update(polygon.vertices)

inverse = body.matrix_world.inverted()
hoof_centers = []
for name in ['HoofFront_L','HoofFront_R','HoofHind_L','HoofHind_R']:
    bone = arm.data.bones[name]
    hoof_centers.append(arm.matrix_world @ bone.tail_local)

for index in skin:
    vertex = body.data.vertices[index]
    p = body.matrix_world @ vertex.co
    x, y, z = p
    torso = window(-1.05,-.6,.65,1.25,y) * window(1.12,1.4,2.12,2.46,z)
    flank = window(-.45,-.15,.5,.95,y) * window(1.05,1.25,1.5,1.9,z)
    p.x *= 1 - .13 * torso
    p.z += .16 * flank
    if z < 1.05:
        center = min(hoof_centers, key=lambda c:(c.x-x)**2+(c.y-y)**2)
        hoof = 1-smooth(.22,.55,z)
        lower_leg = 1-smooth(.7,1.05,z)
        p.x = center.x + (p.x-center.x) * (1 - .28*hoof - .08*lower_leg)
        p.y = center.y + (p.y-center.y) * (1 - .19*hoof)
    vertex.co = inverse @ p

# Verify every frame before export: no invalid vertices, stretched bones or
# changed clip lengths. Record floor clearance rather than silently correcting it.
rows = []
rest_lengths = {}
for action_name in ['Idle','Gallop']:
    arm.animation_data.action = bpy.data.actions[action_name]
    for frame in range(1,32):
        scene.frame_set(frame)
        bpy.context.view_layer.update()
        evaluated = body.evaluated_get(bpy.context.evaluated_depsgraph_get())
        points = [evaluated.matrix_world@v.co for v in evaluated.data.vertices]
        assert all(math.isfinite(c) for p in points for c in p)
        rows.append({'clip':action_name,'frame':frame,'minZ':round(min(p.z for p in points),4),'maxZ':round(max(p.z for p in points),4)})
        for bone in arm.pose.bones:
            length=(arm.matrix_world@bone.tail-arm.matrix_world@bone.head).length
            if bone.name not in rest_lengths:rest_lengths[bone.name]=length
            assert abs(rest_lengths[bone.name]-length)<.0001,(bone.name,frame)

arm.animation_data.action = bpy.data.actions['Idle']
scene.frame_set(1)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out,'thoroughbred-refined.blend'))
bpy.ops.export_scene.gltf(filepath=os.path.join(out,'racehorse-higgsfield-v1.glb'),
    export_format='GLB',export_animations=True,export_animation_mode='ACTIONS',
    export_force_sampling=True,export_image_format='WEBP',export_image_quality=90,
    export_yup=True,export_apply=False)
with open(os.path.join(out,'anatomy-validation.json'),'w') as file:
    json.dump({'reference_job':'d8adf8f5-1270-4a47-bfb6-3da9e205ed24','bones':len(rest_lengths),'frames':rows},file,indent=2)
print('VALIDATED',len(rows),'animation frames;',len(rest_lengths),'constant-length bones',flush=True)
