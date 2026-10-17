"""Convert the locally licensed horse/rider meshes to Unity FBX and PNG maps.
Run from the workspace with Blender --background --python this-file.
"""
import bpy, os, json, shutil
from array import array

root = os.getcwd()
source = os.path.join(root, 'artifacts/3d-game/public/assets/horse-racing/realistic')
out = os.path.join(root, 'artifacts/unity-horse/Assets/Resources/Horse')
os.makedirs(out + '/Textures', exist_ok=True)
materials = []
for name, filename in [('Thoroughbred', 'earth/thoroughbred-v2.glb'),
                       ('Jockey', 'performance/jockey-mounted-v3.glb'),
                       ('Spectator', 'spectator.glb'), ('SpectatorFar', 'spectator.glb'), ('Tree', 'tree.glb')]:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(source, filename))
    # Blender's glTF importer creates an untextured Icosphere as a bone display
    # helper. It is not part of the horse and must never be exported as scenery.
    for obj in list(bpy.data.objects):
        if obj.type == 'MESH' and not obj.data.materials:
            bpy.data.objects.remove(obj, do_unlink=True)
    bpy.context.scene.frame_set(1)
    if name.startswith('Spectator'):
        # Four material regions keep thousands of seated humans inexpensive.
        choices = {key: bpy.data.materials.get(key) for key in ['VitSkin', 'VitShirt', 'VitPants', 'CrowdHair']}
        for obj in bpy.data.objects:
            if obj.type != 'MESH': continue
            for slot in obj.material_slots:
                label = slot.material.name if slot.material else ''
                region = 'VitShirt' if 'Shirt' in label else 'VitPants' if 'Pants' in label else 'CrowdHair' if any(token in label for token in ['Hair', 'Eye', 'Iris', 'Shoes']) else 'VitSkin'
                if choices[region]: slot.material = choices[region]
        bpy.ops.object.select_all(action='DESELECT')
        meshes = [obj for obj in bpy.data.objects if obj.type == 'MESH']
        for obj in meshes: obj.select_set(True)
        bpy.context.view_layer.objects.active = meshes[0]
        bpy.ops.object.join()
        bpy.context.object.name = 'SeatedSpectator'
        if name == 'SpectatorFar':
            decimate = bpy.context.object.modifiers.new('Distant seated crowd', 'DECIMATE')
            decimate.ratio = .28
            bpy.ops.object.modifier_apply(modifier=decimate.name)
    for mat in bpy.data.materials:
        if not mat.use_nodes: continue
        bs = next((n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
        if not bs: continue
        entry = {'name': mat.name, 'model': name, 'color': list(bs.inputs['Base Color'].default_value)}
        safe = name + '_' + ''.join(c if c.isalnum() else '_' for c in mat.name)
        for key, socket in [('albedo', 'Base Color'), ('normal', 'Normal')]:
            links = bs.inputs[socket].links
            node = links[0].from_node if links else None
            if node and node.type == 'NORMAL_MAP':
                links = node.inputs['Color'].links
                node = links[0].from_node if links else None
            if node and node.type == 'TEX_IMAGE':
                image = node.image
                dest = safe + '_' + key + '.png'
                # glTF WebP images are packed. Saving that packed datablock can
                # copy its WebP bytes even when the filename ends in .png.
                # A fresh pixel buffer guarantees an actual PNG for Unity.
                pixels = array('f', [0.0]) * (image.size[0] * image.size[1] * 4)
                image.pixels.foreach_get(pixels)
                converted = bpy.data.images.new('UnityPNG_' + safe + key,
                    width=image.size[0], height=image.size[1], alpha=True)
                converted.colorspace_settings.name = image.colorspace_settings.name
                converted.pixels.foreach_set(pixels)
                converted.file_format = 'PNG'
                converted.filepath_raw = out + '/Textures/' + dest
                converted.save()
                with open(converted.filepath_raw, 'rb') as check:
                    assert check.read(8) == b'\x89PNG\r\n\x1a\n', dest
                bpy.data.images.remove(converted)
                entry[key] = dest
        # Same authored coat map used by the current web renderer.
        if name == 'Thoroughbred' and mat.name == 'Material':
            entry['albedo'] = 'thoroughbred-coat.png'
            entry['color'] = [1, 1, 1, 1]
        materials.append(entry)
    for obj in bpy.data.objects:
        if obj.type == 'ARMATURE' and obj.animation_data:
            for track in obj.animation_data.nla_tracks: track.mute = True
    bpy.ops.export_scene.fbx(filepath=out + '/' + name + '.fbx',
        object_types={'MESH', 'ARMATURE', 'EMPTY'}, add_leaf_bones=False,
        apply_unit_scale=True, apply_scale_options='FBX_SCALE_ALL', axis_forward='-Z', axis_up='Y',
        bake_anim=name == 'Thoroughbred', bake_anim_use_all_actions=True,
        bake_anim_use_nla_strips=False, bake_anim_simplify_factor=.2, path_mode='RELATIVE')
    print('EXPORTED', name, [(a.name, list(a.frame_range)) for a in bpy.data.actions])
for src, dst in [('racewear/thoroughbred-coat-v2.png', 'thoroughbred-coat.png'),
                 ('grass_ground-diff.jpg', 'grass-color.jpg'), ('grass_ground-nor_gl.jpg', 'grass-normal.jpg'),
                 ('raked_dirt-diff.jpg', 'dirt-color.jpg'), ('raked_dirt-nor_gl.jpg', 'dirt-normal.jpg'),
                 ('daylight.hdr', 'daylight.hdr'), ('stadium/spectators-atlas-v1.png', 'spectators.png'),
                 ('stadium/hospitality-facade-v1.png', 'hospitality.png'),
                 ('tree-canopy-0.png', 'tree.png')]:
    shutil.copyfile(os.path.join(source, src), out + '/Textures/' + dst)
shutil.copyfile(source + '/CREDITS.md', out + '/SOURCE-CREDITS.md')
with open(out + '/materials.json', 'w') as f: json.dump({'materials': materials}, f, indent=2)
print('HORSE_UNITY_ASSETS_READY', out)
