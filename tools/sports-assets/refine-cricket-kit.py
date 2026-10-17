"""Smooth cricket jersey shoulders while preserving the baked skin and UV0.
Exports only CricketPlayer.fbx, with the existing three materials and three LODs.
"""
import ast, bpy, json, os

ROOT = os.getcwd()
OUT = os.path.join(ROOT, 'artifacts/unity-sports/Assets/Resources/Sports')
bpy.ops.wm.open_mainfile(filepath=os.path.join(ROOT, '.cache/football-pro/human-upgrade.blend'))
arm = bpy.data.objects['FootballRig']
human = bpy.data.objects['Athlete_LOD0']
arm.animation_data.action = None
for bone in arm.pose.bones:
    bone.rotation_quaternion = (1, 0, 0, 0)
    bone.location = (0, 0, 0)
    bone.scale = (1, 1, 1)
bpy.context.view_layer.update()
with open('tools/sports-assets/upgrade-unity-human.py') as source:
    tree = ast.parse(source.read())
for node in tree.body:
    if isinstance(node, ast.FunctionDef) and node.name in ('activate', 'export'):
        exec(compile(ast.Module(body=[node], type_ignores=[]), '<human export>', 'exec'))

shirt = {i for p in human.data.polygons if p.material_index == 2
         for i in p.vertices if human.data.vertices[i].co.z > 1.08}
activate(human)
group = human.vertex_groups.new(name='Cricket shirt refinement')
group.add(list(shirt), 1, 'REPLACE')
smooth = human.modifiers.new('Relax cricket shirt folds', 'SMOOTH')
smooth.vertex_group = group.name
smooth.factor = .55
smooth.iterations = 5
while human.modifiers.find(smooth.name) > 0:
    bpy.ops.object.modifier_move_up(modifier=smooth.name)
bpy.ops.object.modifier_apply(modifier=smooth.name)
human.vertex_groups.remove(human.vertex_groups['Cricket shirt refinement'])
for index in shirt:
    vertex = human.data.vertices[index]
    x, y, z = vertex.co
    side = 'L' if x > 0 else 'R'
    arm_weight = max(0, min(1, (abs(x) - .13) / .19)) if z > 1.26 else 0
    arm_weight = arm_weight * arm_weight * (3 - 2 * arm_weight)
    chest = max(0, min(1, (z - 1.12) / .28))
    weights = {'Arm.' + side: arm_weight, 'Chest': (1-arm_weight)*chest,
               'Spine': (1-arm_weight)*(1-chest)}
    for group in human.vertex_groups:
        group.remove([index])
    for name, weight in weights.items():
        if weight > 0:
            human.vertex_groups[name].add([index], weight, 'REPLACE')
for polygon in human.data.polygons:
    polygon.use_smooth = True
assert len(human.data.uv_layers) == 1
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT, '.cache/football-pro/cricket-matchday.blend'))
export('CricketPlayer')
print('CRICKET_KIT_REFINED', len(human.data.vertices))
