"""Refine the CC0 horse without changing its rig, UVs, tack or race timing.

Run with Blender --background --disable-autoexec
.cache/horse-higgsfield/thoroughbred-refined.blend --python this-file.
The v2 mesh and a complete Idle/Gallop deformation audit are staged for review.
"""
import bpy, math, os, json

scene = bpy.context.scene
arm = bpy.data.objects['Armature']
body = bpy.data.objects['Plane']
arm.animation_data.action = bpy.data.actions['Idle']
scene.frame_set(1)
bpy.context.view_layer.update()
out = os.path.abspath('.cache/horse-earth')
os.makedirs(out, exist_ok=True)

def smooth(a, b, x):
    t = max(0, min(1, (x-a)/(b-a)))
    return t*t*(3-2*t)

def bell(x, center, width):
    return math.exp(-((x-center)/width)**2)

skin = {i for p in body.data.polygons
        if body.data.materials[p.material_index].name == 'Material'
        for i in p.vertices}
inverse = body.matrix_world.inverted()
max_change = 0
for index in skin:
    vertex = body.data.vertices[index]
    p = body.matrix_world @ vertex.co
    before = p.copy()
    x, y, z = p
    # Taper the throat/chest and define the shoulder instead of uniformly
    # shrinking the entire horse. The head and saddle contact stay in place.
    neck = bell(y, -1.45, .49) * bell(z, 2.26, .50)
    shoulder = bell(y, -.80, .42) * bell(z, 1.85, .42)
    p.x *= 1 - neck*.105 - shoulder*.04
    throat = bell(y, -1.28, .50) * (1-smooth(1.65, 2.32, z)) * smooth(1.12, 1.6, z)
    p.z += throat*.12
    # A lean hindquarter with a clear flank and rounded, rather than inflated,
    # croup; lower leg joint centres and hoof contacts are untouched.
    rump = bell(y, 1.03, .52) * smooth(2.05, 2.49, z)
    p.z -= rump*.07
    p.x *= 1 - .055*bell(y, .92, .56)*bell(z, 1.65, .42)
    # Small anatomical transitions follow the existing muscle masses/UV map.
    p.x += math.copysign(.014*bell(y, -.64, .25)*bell(z, 1.96, .36), x)
    p.x -= math.copysign(.012*bell(y, .41, .18)*bell(z, 1.75, .28), x)
    max_change = max(max_change, (p-before).length)
    vertex.co = inverse @ p

# Smooth normals are retained; no remeshing, skin-weight reassignment or new
# animation curves that might change the muzzle position at the finish.
body.data.update()
rows = []
lengths = {}
for clip in ['Idle', 'Gallop']:
    arm.animation_data.action = bpy.data.actions[clip]
    for frame in range(1,32):
        scene.frame_set(frame)
        bpy.context.view_layer.update()
        evaluated = body.evaluated_get(bpy.context.evaluated_depsgraph_get())
        points = [evaluated.matrix_world@v.co for v in evaluated.data.vertices]
        assert all(math.isfinite(c) for p in points for c in p)
        floor = min(p.z for p in points)
        assert floor > -.12, (clip, frame, floor)
        rows.append({'clip':clip, 'frame':frame,
                     'minZ':round(floor,4), 'maxZ':round(max(p.z for p in points),4)})
        for bone in arm.pose.bones:
            length=(arm.matrix_world@bone.tail-arm.matrix_world@bone.head).length
            if bone.name not in lengths: lengths[bone.name]=length
            assert abs(lengths[bone.name]-length)<.0001, (clip, frame, bone.name)
arm.animation_data.action=bpy.data.actions['Idle']
scene.frame_set(1)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out,'thoroughbred-v2.blend'))
bpy.ops.export_scene.gltf(filepath=os.path.join(out,'thoroughbred-v2.glb'),
    export_format='GLB', export_animations=True, export_animation_mode='ACTIONS',
    export_force_sampling=True, export_image_format='WEBP', export_image_quality=92,
    export_yup=True, export_apply=False)
with open(os.path.join(out,'anatomy-validation.json'),'w') as file:
    json.dump({'bones':len(lengths), 'vertices':len(body.data.vertices),
               'maxVertexChangeMetres':round(max_change,5), 'frames':rows},file,indent=2)
print('VALIDATED',len(rows),'frames;',len(lengths),'constant-length bones',flush=True)
