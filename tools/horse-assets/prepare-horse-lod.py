"""Derive a race-distance horse mesh, retaining the original rig and animation.
Run Blender on .cache/horse-earth/thoroughbred-v2.blend with --disable-autoexec.
The detailed v2 mesh remains in use for close-up/winner shots.
"""
import bpy, os, json, math
scene=bpy.context.scene
arm=bpy.data.objects['Armature'];body=bpy.data.objects['Plane']
arm.animation_data.action=bpy.data.actions['Idle'];scene.frame_set(1)
bpy.context.view_layer.objects.active=body
before=sum(len(p.vertices)-2 for p in body.data.polygons)
modifier=body.modifiers.new('Race distance topology','DECIMATE');modifier.ratio=.42
bpy.ops.object.modifier_move_up(modifier=modifier.name)
bpy.ops.object.modifier_apply(modifier=modifier.name)
after=sum(len(p.vertices)-2 for p in body.data.polygons)
rows=[]
for clip in ['Idle','Gallop']:
    arm.animation_data.action=bpy.data.actions[clip]
    for frame in range(1,32):
        scene.frame_set(frame);bpy.context.view_layer.update()
        evaluated=body.evaluated_get(bpy.context.evaluated_depsgraph_get())
        points=[evaluated.matrix_world@v.co for v in evaluated.data.vertices]
        assert all(math.isfinite(c) for p in points for c in p)
        floor=min(p.z for p in points);assert floor>-.12,(clip,frame,floor)
        rows.append({'clip':clip,'frame':frame,'minZ':round(floor,4)})
arm.animation_data.action=bpy.data.actions['Idle'];scene.frame_set(1)
out=os.path.abspath('artifacts/3d-game/public/assets/horse-racing/realistic/performance')
os.makedirs(out,exist_ok=True)
bpy.ops.export_scene.gltf(filepath=os.path.join(out,'thoroughbred-field-v3.glb'),
    export_format='GLB',export_animations=True,export_animation_mode='ACTIONS',
    export_force_sampling=True,export_image_format='WEBP',export_image_quality=92,
    export_yup=True,export_apply=False)
report={'source':'earth/thoroughbred-v2.glb','license':'CC0','trianglesBefore':before,
        'trianglesAfter':after,'bones':[b.name for b in arm.pose.bones],'frames':rows}
with open(os.path.join(out,'horse-lod-validation.json'),'w') as f:json.dump(report,f,indent=2)
print('HORSE_LOD_VALIDATED',before,after,len(rows),'animation frames')
