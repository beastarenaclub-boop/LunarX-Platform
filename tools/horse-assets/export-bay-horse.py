"""Export the fitted CC0 horse, its PBR maps and clips for Unity; render review.

Requires prepare-bay-horse.py and rig-bay-horse.mjs first. Does not re-export
unrelated models or overwrite their material records.
"""
import bpy, bmesh, json, os, math
from array import array
from mathutils import Vector, Matrix, Quaternion

root=os.path.abspath('.'); cache=root+'/.cache/horse-v4'
out=root+'/artifacts/unity-horse/Assets/Resources/Horse'
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=cache+'/horse-rigged.glb')
scene=bpy.context.scene;scene.render.fps=30
arm=next(o for o in scene.objects if o.type=='ARMATURE')
body=next(o for o in scene.objects if o.type=='MESH' and o.data.materials)
for obj in list(scene.objects):
    if obj.type=='MESH' and not obj.data.materials:bpy.data.objects.remove(obj,do_unlink=True)
# UV seams are duplicated by glTF. Weld positional twins after binding so a
# disconnected UV island cannot open a visible crack during a gallop.
bpy.context.view_layer.objects.active=body
bm=bmesh.new();bm.from_mesh(body.data)
bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.000015)
bmesh.ops.holes_fill(bm,edges=[e for e in bm.edges if e.is_boundary],sides=16)
bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
bm.to_mesh(body.data);bm.free()
body.data.validate(clean_customdata=True)
for p in body.data.polygons:p.use_smooth=True
bpy.ops.object.select_all(action='DESELECT');body.select_set(True)
# Blend the distance solver's abrupt regions into continuous skin around the
# shoulder and haunch. Keep the runtime's four-influence budget.
adjacent=[set() for v in body.data.vertices]
for edge in body.data.edges:
    a,b=edge.vertices;adjacent[a].add(b);adjacent[b].add(a)
weights=[{g.group:g.weight for g in v.groups} for v in body.data.vertices]
for iteration in range(10):
    smoothed=[]
    for index,original in enumerate(weights):
        neighbours=adjacent[index]
        if not neighbours:smoothed.append(original);continue
        result={g:w*.35 for g,w in original.items()}
        for neighbour in neighbours:
            for g,w in weights[neighbour].items():result[g]=result.get(g,0)+w*.65/len(neighbours)
        pairs=sorted(result.items(),key=lambda x:-x[1])[:8]
        total=sum(w for g,w in pairs);smoothed.append({g:w/total for g,w in pairs})
    weights=smoothed
for group in body.vertex_groups:group.remove(list(range(len(weights))))
for index,weight in enumerate(weights):
    pairs=sorted(weight.items(),key=lambda x:-x[1])[:4];total=sum(w for g,w in pairs)
    for g,w in pairs:body.vertex_groups[g].add([index],w/total,'REPLACE')
print('HORSE_RIG',len(arm.data.bones),'bones',len(body.data.vertices),'vertices',len(body.data.polygons),'triangles',flush=True)
for a in bpy.data.actions:
    base=a.name.split('_')[0]
    label='Gallop' if base=='Run' else base
    start,end=a.frame_range; duration={'Gallop':1.0,'Idle':2.667,'Walk':1.0}.get(label,(end-start)/30)
    for curve in a.fcurves:
        for key in curve.keyframe_points:
            for coord in [key.co,key.handle_left,key.handle_right]:coord.x=1+(coord.x-start)/(end-start)*duration*30
    a.name=label
    print('CLIP',a.name,tuple(a.frame_range),flush=True)
for track in arm.animation_data.nla_tracks:track.mute=True
# The library's idle/tail posture assumes a horizontal tail and a different
# standing stance. Preserve this model's own rest pose for the paddock.
idle=bpy.data.actions['Idle']
for curve in list(idle.fcurves):idle.fcurves.remove(curve)
arm.animation_data.action=idle
for frame in [1,21,41,61,81]:
    phase=(frame-1)/80*math.tau
    for bone in arm.pose.bones:
        bone.matrix_basis=Matrix.Identity(4);bone.rotation_mode='QUATERNION'
        if bone.name=='head':bone.rotation_quaternion=Quaternion((0,0,1),math.sin(phase)*.012)
        bone.keyframe_insert('rotation_quaternion',frame=frame)
        bone.keyframe_insert('location',frame=frame)
for action in list(bpy.data.actions):
    arm.animation_data.action=action
    for curve in list(action.fcurves):
        if 'pose.bones["tail_' in curve.data_path:action.fcurves.remove(curve)
    end=round(action.frame_range[1])
    for frame in range(1,end+1,2):
        phase=(frame-1)/(end-1)*math.tau
        for index in range(1,5):
            bone=arm.pose.bones['tail_'+str(index)];bone.rotation_mode='QUATERNION'
            bone.rotation_quaternion=Quaternion((1,0,0),(.12 if action.name=='Gallop' else .01)/index) @ Quaternion((0,0,1),math.sin(phase+index*.5)*.035)
            bone.keyframe_insert('rotation_quaternion',frame=frame)
arm.animation_data.action=bpy.data.actions['Idle'];scene.frame_set(1)
mat=body.data.materials[0];mat.name='BayHorseCoat'
bs=next(n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
entry={'name':mat.name,'model':'Thoroughbred','color':[1,1,1,1]}
for key,socket in [('albedo','Base Color'),('normal','Normal'),('roughness','Roughness')]:
    links=bs.inputs[socket].links;node=links[0].from_node if links else None
    while node and node.type not in ['TEX_IMAGE']:
        linked=[i for i in node.inputs if i.is_linked]
        node=linked[0].links[0].from_node if linked else None
    if not node:continue
    source=node.image
    pixels=array('f',[0])*(source.size[0]*source.size[1]*4);source.pixels.foreach_get(pixels)
    img=bpy.data.images.new('BayHorse-'+key,width=source.size[0],height=source.size[1],alpha=True)
    img.colorspace_settings.name=source.colorspace_settings.name;img.pixels.foreach_set(pixels)
    img.file_format='PNG';img.filepath_raw=out+'/Textures/BayHorse-'+key+'.png';img.save()
    entry[key]='BayHorse-'+key+'.png'
    print('MAP',key,tuple(img.size),flush=True)
with open(out+'/materials.json') as f:materials=json.load(f)
materials['materials']=[m for m in materials['materials'] if m['model']!='Thoroughbred']+[entry]
with open(out+'/materials.json','w') as f:json.dump(materials,f,indent=2)
# Copy the exact original and animation licenses alongside the authored asset.
import shutil
shutil.copyfile(cache+'/LICENSE-grab3d.txt',out+'/BAY-HORSE-LICENSE.txt')
shutil.copyfile(cache+'/rig-tools/node_modules/afk-rig/assets/LICENSE-CC0.md',out+'/HORSE-ANIMATIONS-LICENSE.md')
bpy.ops.export_scene.fbx(filepath=out+'/Thoroughbred.fbx',object_types={'MESH','ARMATURE','EMPTY'},
    add_leaf_bones=False,apply_unit_scale=True,apply_scale_options='FBX_SCALE_ALL',axis_forward='-Z',axis_up='Y',
    bake_anim=True,bake_anim_use_all_actions=True,bake_anim_use_nla_strips=False,bake_anim_simplify_factor=0,path_mode='RELATIVE')
bpy.ops.wm.save_as_mainfile(filepath=cache+'/horse-final.blend')

# Lightweight textured render checks before the longer Unity/WebGL compilation.
scene.render.engine='CYCLES';scene.cycles.samples=12;scene.cycles.use_denoising=True
scene.render.resolution_x=1000;scene.render.resolution_y=720;scene.render.resolution_percentage=100
scene.world=bpy.data.worlds.new('Studio world');scene.world.color=(.16,.16,.16)
def area(name,position,power,size):
    data=bpy.data.lights.new(name,'AREA');data.energy=power;data.shape='DISK';data.size=size
    o=bpy.data.objects.new(name,data);scene.collection.objects.link(o);o.location=position
    o.rotation_euler=(Vector((0,0,1))-o.location).to_track_quat('-Z','Y').to_euler()
area('Key',(3,-4,5),650,4);area('Fill',(-3,-1,3),420,3);area('Rim',(0,3,4),600,3)
bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.01));floor=bpy.context.object
floorMat=bpy.data.materials.new('Neutral studio');floorMat.diffuse_color=(.13,.16,.18,1);floor.data.materials.append(floorMat)
cameraData=bpy.data.cameras.new('Review');camera=bpy.data.objects.new('Review',cameraData);scene.collection.objects.link(camera);scene.camera=camera
camera.location=(3.4,-4.7,2.45);camera.rotation_euler=(Vector((0,-.05,1))-camera.location).to_track_quat('-Z','Y').to_euler();cameraData.lens=52
for name,frame in [('Idle',1),('Gallop',9),('Gallop',26)]:
    arm.animation_data.action=bpy.data.actions[name];scene.frame_set(frame)
    scene.render.filepath=cache+'/textured-'+name+'-'+str(frame)+'.png'
    bpy.ops.render.render(write_still=True)
print('BAY_HORSE_EXPORTED',flush=True)
