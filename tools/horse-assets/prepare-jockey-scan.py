"""Fit a Renderpeople scanned head to the existing licensed racewear body."""
import bpy,bmesh,os,json
from mathutils import Vector,Matrix
bpy.ops.wm.read_factory_settings(use_empty=True)
root=os.path.abspath('.');out=f'{root}/artifacts/unity-horse/Assets/Resources/Horse'
source=f'{root}/.cache/horse-realism-v3/people/rp_eric_rigged_001_FBX'
bpy.ops.import_scene.fbx(filepath=source+'/rp_eric_rigged_001_zup_a.fbx')
head=next(o for o in bpy.data.objects if o.type=='MESH');bpy.context.view_layer.objects.active=head
for mod in list(head.modifiers):bpy.ops.object.modifier_apply(modifier=mod.name)
matrix=head.matrix_world.copy();head.parent=None;head.data.transform(matrix);head.matrix_world=Matrix.Identity(4)
bm=bmesh.new();bm.from_mesh(head.data)
bmesh.ops.delete(bm,geom=[v for v in bm.verts if v.co.z<1.575],context='VERTS');bm.to_mesh(head.data);bm.free()
for v in head.data.vertices:v.co=(v.co-Vector((0,-.010172,1.639064)))*1.3+Vector((0,-.77705,2.95108))
head.name='ScannedJockeyHead';head.data.materials[0].name='ScannedJockeyFace'
for o in list(bpy.data.objects):
    if o!=head:bpy.data.objects.remove(o,do_unlink=True)
face=head.data.materials[0];face.use_nodes=True
bs=next(n for n in face.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
for link in list(bs.inputs['Base Color'].links):face.node_tree.links.remove(link)
tex=face.node_tree.nodes.new('ShaderNodeTexImage');tex.image=bpy.data.images.load(source+'/tex/rp_eric_rigged_001_dif.jpg');tex.image.scale(4096,4096)
tex.image.filepath_raw=out+'/Textures/Jockey-scanned-face.png';tex.image.file_format='PNG';tex.image.save();face.node_tree.links.new(tex.outputs['Color'],bs.inputs['Base Color'])
bpy.ops.import_scene.gltf(filepath=f'{root}/artifacts/3d-game/public/assets/horse-racing/realistic/performance/jockey-mounted-v3.glb')
for o in list(bpy.data.objects):
    if o.type=='MESH' and o!=head and (not o.data.materials or any(m.name=='VitSkin' or 'Eye' in m.name or 'Iris' in m.name or 'Tear' in m.name or 'Lacrimal' in m.name for m in o.data.materials)):
        bpy.data.objects.remove(o,do_unlink=True)
bpy.ops.export_scene.fbx(filepath=out+'/JockeyScan.fbx',object_types={'MESH','EMPTY'},add_leaf_bones=False,bake_anim=False,axis_forward='-Z',axis_up='Y')
print('JOCKEY_SCAN_READY',[(o.name,len(o.data.polygons)) for o in bpy.data.objects if o.type=='MESH'])
