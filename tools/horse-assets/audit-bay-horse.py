"""Evaluate exported skin at every gallop frame, without rendering or editing it."""
import bpy, json, math, os
bpy.ops.wm.open_mainfile(filepath=os.path.abspath('.cache/horse-v4/horse-final.blend'))
scene=bpy.context.scene
arm=next(o for o in scene.objects if o.type=='ARMATURE')
body=next(o for o in scene.objects if o.type=='MESH' and o.data.materials)
assert len(arm.data.bones)==56
assert len(body.data.polygons)<33000
for vertex in body.data.vertices:
    assert 0<len(vertex.groups)<=4
    assert abs(sum(g.weight for g in vertex.groups)-1)<.0001
samples=[]
for name in ['Idle','Gallop']:
    arm.animation_data.action=bpy.data.actions[name]
    for frame in range(1,int(arm.animation_data.action.frame_range[1])+1):
        scene.frame_set(frame);bpy.context.view_layer.update()
        evaluated=body.evaluated_get(bpy.context.evaluated_depsgraph_get())
        mesh=evaluated.to_mesh();points=[body.matrix_world@v.co for v in mesh.vertices]
        floor=min(p.z for p in points);height=max(p.z for p in points)
        assert all(math.isfinite(c) for p in points for c in p),(name,frame)
        assert floor>-.06 and floor<.4,(name,frame,floor)
        assert 1.6<height<2.6,(name,frame,height)
        samples.append({'clip':name,'frame':frame,'lowest':round(floor,5),'highest':round(height,5)})
        evaluated.to_mesh_clear()
report={'bones':len(arm.data.bones),'triangles':sum(len(p.vertices)-2 for p in body.data.polygons),
        'vertices':len(body.data.vertices),'maxInfluences':4,'samples':samples}
with open('.cache/horse-v4/deformation-audit.json','w') as f:json.dump(report,f,indent=2)
print('HORSE_DEFORMATION_PASS',report['bones'],report['triangles'],len(samples),flush=True)
