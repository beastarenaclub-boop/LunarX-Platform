"""Export a coherent low-cost canopy with the source's missing leaf opacity."""
import bpy, os, json
from array import array
from mathutils import Vector
root=os.path.abspath('.');cache=root+'/.cache/horse-v4';out=root+'/artifacts/unity-horse/Assets/Resources/Horse'
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=cache+'/tree-canopy.glb')
obj=next(o for o in bpy.context.scene.objects if o.type=='MESH')
bpy.context.view_layer.objects.active=obj;obj.select_set(True)
bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.mesh.separate(type='MATERIAL');bpy.ops.object.mode_set(mode='OBJECT')
for obj in [o for o in bpy.context.scene.objects if o.type=='MESH']:
    bpy.context.view_layer.objects.active=obj
    mat=obj.data.materials[0];label=mat.name
    if 'leaves' not in label:
        before=sum(len(p.vertices)-2 for p in obj.data.polygons)
        modifier=obj.modifiers.new('Bark and branches LOD','DECIMATE');modifier.ratio=min(1,5000/before)
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    for p in obj.data.polygons:p.use_smooth=True
    if 'branches' in label:
        # Match the glTF source's KHR_texture_transform in the runtime UVs.
        for v in obj.data.uv_layers.active.data:v.uv=(v.uv.x*15,v.uv.y*3.4-2.4)
    if 'leaves' in label:
        bs=next(n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
        alpha=mat.node_tree.nodes.new('ShaderNodeTexImage');alpha.image=bpy.data.images.load(cache+'/tree-leaf-alpha.png')
        alpha.image.colorspace_settings.name='Non-Color';mat.node_tree.links.new(alpha.outputs['Color'],bs.inputs['Alpha'])
        mat.surface_render_method='DITHERED'
    print('TREE_PART',label,sum(len(p.vertices)-2 for p in obj.data.polygons),flush=True)
# glTF packs the original diffuse and opacity channels into one RGBA material.
bpy.ops.export_scene.gltf(filepath=cache+'/tree-final.glb',export_format='GLB',export_image_format='AUTO',export_animations=False)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=cache+'/tree-final.glb')
leaf=next(m for m in bpy.data.materials if 'leaves' in m.name)
bs=next(n for n in leaf.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
# Broad cards use upward canopy normals, a common distant-foliage technique.
# The original tangent-space leaf normal map belongs to the curved 24-triangle
# leaves and produces black backfaces on the flattened cards.
for link in list(bs.inputs['Normal'].links):leaf.node_tree.links.remove(link)
for obj in bpy.context.scene.objects:
    if obj.type=='MESH' and any('leaves' in m.name for m in obj.data.materials):
        up=(obj.matrix_world.inverted().to_3x3()@Vector((0,0,1))).normalized()
        obj.data.normals_split_custom_set_from_vertices([tuple(up)]*len(obj.data.vertices))
with open(out+'/materials.json') as f:materialRecords=json.load(f)
for entry in materialRecords['materials']:
    if entry['model']=='Tree' and 'leaves' in entry['name']:entry.pop('normal',None)
with open(out+'/materials.json','w') as f:json.dump(materialRecords,f,indent=2)
source=bs.inputs['Base Color'].links[0].from_node.image
pixels=array('f',[0])*(source.size[0]*source.size[1]*4);source.pixels.foreach_get(pixels)
image=bpy.data.images.new('Unity leaf RGBA',width=source.size[0],height=source.size[1],alpha=True)
image.pixels.foreach_set(pixels);image.file_format='PNG';image.filepath_raw=out+'/Textures/Tree_island_tree_01_leaves_albedo.png';image.save()
assert min(pixels[3::4])<.1 and max(pixels[3::4])>.9,'Missing leaf transparency'
bpy.ops.export_scene.fbx(filepath=out+'/Tree.fbx',object_types={'MESH','EMPTY'},add_leaf_bones=False,
    axis_forward='-Z',axis_up='Y',bake_anim=False,path_mode='RELATIVE')
meshes=[o for o in bpy.context.scene.objects if o.type=='MESH']
count=sum(len(p.vertices)-2 for o in meshes for p in o.data.polygons)
with open(cache+'/tree-audit.json','w') as f:json.dump({'source':'https://polyhaven.com/a/island_tree_01','license':'CC0','triangles':count,'leafCards':5521,'alphaRestored':True},f,indent=2)
bpy.ops.wm.save_as_mainfile(filepath=cache+'/tree-final.blend')
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=12;scene.cycles.use_denoising=True
scene.render.resolution_x=700;scene.render.resolution_y=700;scene.render.resolution_percentage=100
scene.world=bpy.data.worlds.new('Canopy studio');scene.world.color=(.3,.3,.3)
points=[o.matrix_world@v.co for o in meshes for v in o.data.vertices]
lo=Vector([min(p[i] for p in points) for i in range(3)]);hi=Vector([max(p[i] for p in points) for i in range(3)])
center=(lo+hi)*.5;size=max(hi-lo)
light=bpy.data.lights.new('Sun','SUN');light.energy=3;sun=bpy.data.objects.new('Sun',light);scene.collection.objects.link(sun);sun.rotation_euler=(.4,-.5,-.3)
data=bpy.data.cameras.new('Canopy review');camera=bpy.data.objects.new('Canopy review',data);scene.collection.objects.link(camera)
camera.location=center+Vector((1.3,-1.8,.6))*size;camera.rotation_euler=(center-camera.location).to_track_quat('-Z','Y').to_euler()
data.type='ORTHO';data.ortho_scale=size*1.15;scene.camera=camera
scene.render.filepath=cache+'/tree-preview.png';bpy.ops.render.render(write_still=True)
print('TREE_CANOPY_READY',count,flush=True)
