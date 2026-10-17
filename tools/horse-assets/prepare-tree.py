import bpy,os
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.abspath('.cache/horse-realism/tree/island_tree_01.gltf'))
for o in list(bpy.data.objects):
 if o.type!='MESH':continue
 bpy.context.view_layer.objects.active=o
 print('TREE_START',o.name,len(o.data.vertices),list(o.dimensions),flush=True)
 dec=o.modifiers.new('Trackside LOD','DECIMATE');dec.ratio=.008
 bpy.ops.object.modifier_apply(modifier=dec.name)
 print('TREE_END',len(o.data.vertices),flush=True)
 for p in o.data.polygons:p.use_smooth=True
 for m in o.data.materials:
  m.use_backface_culling=False
bpy.ops.export_scene.gltf(filepath=os.path.abspath('artifacts/3d-game/public/assets/horse-racing/realistic/tree.glb'),export_format='GLB',export_image_format='WEBP',export_image_quality=82,export_yup=True,export_animations=False)
