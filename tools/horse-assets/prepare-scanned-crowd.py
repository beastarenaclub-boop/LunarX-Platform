"""Prepare licensed Renderpeople scans as seated, three-level crowd assets.
Source files stay in the private working project; distribute compiled game only.
"""
import bpy,os,math,json
from mathutils import Vector,Matrix
root=os.path.abspath('.cache/horse-realism-v3/people')
out=os.path.abspath('artifacts/unity-horse/Assets/Resources/Horse/Crowd')
os.makedirs(out,exist_ok=True)
report=[]
def point(arm,name):return arm.matrix_world@arm.pose.bones[name].head
def aim(arm,name,child,direction):
    b=arm.pose.bones[name];current=point(arm,child)-point(arm,name)
    q=current.normalized().rotation_difference(Vector(direction).normalized())
    world=arm.matrix_world@b.matrix;pos=world.translation.copy()
    world=q.to_matrix().to_4x4()@world;world.translation=pos
    b.matrix=arm.matrix_world.inverted()@world;bpy.context.view_layer.update()
for person,version in [('Eric','001'),('Carla','001'),('Claudia','002')]:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    name=f'rp_{person.lower()}_rigged_{version}';directory=f'{root}/{name}_FBX'
    bpy.ops.import_scene.fbx(filepath=f'{directory}/{name}_zup_a.fbx')
    arm=next(o for o in bpy.data.objects if o.type=='ARMATURE')
    for side in ['l','r']:
        aim(arm,'upperleg_'+side,'lowerleg_'+side,(0,-1,-.10))
        aim(arm,'lowerleg_'+side,'foot_'+side,(0,.12,-1))
        aim(arm,'foot_'+side,'ball_'+side,(0,-1,-.10))
        aim(arm,'upperarm_'+side,'lowerarm_'+side,(.12 if side=='l' else -.12,-.18,-1))
        aim(arm,'lowerarm_'+side,'hand_'+side,(0,-1,-.16))
    meshes=[o for o in bpy.data.objects if o.type=='MESH']
    mesh=meshes[0];bpy.context.view_layer.objects.active=mesh
    for modifier in list(mesh.modifiers):bpy.ops.object.modifier_apply(modifier=modifier.name)
    mesh.parent=None;matrix=mesh.matrix_world.copy();mesh.data.transform(matrix);mesh.matrix_world=Matrix.Identity(4)
    low=min(v.co.z for v in mesh.data.vertices)
    for v in mesh.data.vertices:v.co.z-=low
    for obj in list(bpy.data.objects):
        if obj!=mesh:bpy.data.objects.remove(obj,do_unlink=True)
    bpy.context.view_layer.objects.active=mesh;mesh.select_set(True)
    mat=mesh.data.materials[0];mat.use_nodes=True;mat.name=person+'Scan'
    nodes=mat.node_tree.nodes;nodes.clear();bs=nodes.new('ShaderNodeBsdfPrincipled');bs.inputs['Roughness'].default_value=.8
    output=nodes.new('ShaderNodeOutputMaterial');mat.node_tree.links.new(bs.outputs['BSDF'],output.inputs['Surface'])
    tex=nodes.new('ShaderNodeTexImage');tex.image=bpy.data.images.load(f'{directory}/tex/{name}_dif.jpg');tex.image.scale(2048,2048)
    tex.image.filepath_raw=f'{out}/{person}-color.png';tex.image.file_format='PNG';tex.image.save()
    mat.node_tree.links.new(tex.outputs['Color'],bs.inputs['Base Color'])
    # Keep the photographic scan intact for its distant card, then simplify
    # actual geometry at the two nearer distances.
    scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=16
    scene.world=bpy.data.worlds.new('Soft daylight');scene.world.use_nodes=True;scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.7,.7,.7,1)
    scene.world.node_tree.nodes['Background'].inputs[1].default_value=.8
    bpy.ops.object.light_add(type='AREA',location=(-2,-4,5));bpy.context.object.data.energy=180;bpy.context.object.data.shape='DISK';bpy.context.object.data.size=5
    h=max(v.co.z for v in mesh.data.vertices);w=max(v.co.x for v in mesh.data.vertices)-min(v.co.x for v in mesh.data.vertices)
    bpy.ops.object.camera_add(location=(0,-5,h*.5));cam=bpy.context.object;cam.rotation_euler=(Vector((0,0,h*.5))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=1.6;scene.camera=cam
    scene.render.resolution_x=512;scene.render.resolution_y=512;scene.render.resolution_percentage=100;scene.render.film_transparent=True
    scene.view_settings.view_transform='Standard';scene.render.image_settings.file_format='PNG';scene.render.filepath=f'{out}/{person}-card.png';bpy.ops.render.render(write_still=True)
    bpy.ops.object.select_all(action='DESELECT');mesh.select_set(True);bpy.context.view_layer.objects.active=mesh
    for level,target in [('Near',1800),('Far',360)]:
        clone=mesh.copy();clone.data=mesh.data.copy();bpy.context.collection.objects.link(clone);mesh.select_set(False);clone.select_set(True);bpy.context.view_layer.objects.active=clone
        dec=clone.modifiers.new('Crowd budget','DECIMATE');dec.ratio=min(1,target/max(1,sum(len(p.vertices)-2 for p in clone.data.polygons)));bpy.ops.object.modifier_apply(modifier=dec.name)
        for p in clone.data.polygons:p.use_smooth=True
        bpy.ops.export_scene.fbx(filepath=f'{out}/{person}{level}.fbx',use_selection=True,object_types={'MESH'},add_leaf_bones=False,bake_anim=False,axis_forward='-Z',axis_up='Y')
        report.append({'person':person,'level':level,'triangles':sum(len(p.vertices)-2 for p in clone.data.polygons),'height':h,'width':w})
        bpy.data.objects.remove(clone,do_unlink=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(f'.cache/horse-realism-v3/{person}-seated.blend'))
with open(f'{out}/provenance.json','w') as f:json.dump({'source':'https://renderpeople.com/free-3d-people/','terms':'https://renderpeople.com/general-terms-and-conditions/','models':report},f,indent=2)
print('SCANNED_CROWD_READY',report)
