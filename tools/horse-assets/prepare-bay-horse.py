"""Prepare the licensed Grab3D bay horse for local rigging (Blender 4.2)."""
import bpy, bmesh, json, os

out = os.path.abspath('.cache/horse-v4')
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=out+'/horse-source.glb')
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
for obj in meshes:
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    # The downloaded glTF splits its surface along UV/normal boundaries. Weld
    # BEFORE decimation; decimating separate islands opens large cracks.
    bm=bmesh.new();bm.from_mesh(obj.data)
    original_vertices=len(bm.verts)
    bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.0002)
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
    print('SOURCE_WELD',original_vertices,'->',len(bm.verts),flush=True)
    bm.to_mesh(obj.data);bm.free()
    obj.data.validate(clean_customdata=True)
    before = sum(len(p.vertices)-2 for p in obj.data.polygons)
    modifier = obj.modifiers.new('Game mesh: retain silhouette and UVs', 'DECIMATE')
    modifier.ratio = min(1, 32000 / before)
    modifier.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    if obj.data.has_custom_normals:
        bpy.ops.mesh.customdata_custom_splitnormals_clear()
    obj.data.validate(clean_customdata=True)
    for polygon in obj.data.polygons: polygon.use_smooth = True
    obj.select_set(False)
    print('HORSE_MESH', obj.name, 'triangles', before, '->', len(obj.data.polygons),
          'dimensions',list(obj.dimensions), 'location',list(obj.location))
    print('BOUNDS', [min((obj.matrix_world @ v.co)[i] for v in obj.data.vertices) for i in range(3)],
          [max((obj.matrix_world @ v.co)[i] for v in obj.data.vertices) for i in range(3)])
for mat in bpy.data.materials:
    print('MATERIAL',mat.name)
    if mat.use_nodes:
        for n in mat.node_tree.nodes:
            if n.type=='TEX_IMAGE': print('TEXTURE',n.name,n.image.name,tuple(n.image.size),n.image.colorspace_settings.name)
bpy.ops.wm.save_as_mainfile(filepath=out+'/horse-game.blend')
bpy.ops.export_scene.gltf(filepath=out+'/horse-game.glb', export_format='GLB', export_animations=False)
print('BAY_HORSE_PREPARED')
