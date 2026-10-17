"""Refine the current CC0 athlete's shirt and preserve its proven atlas UV0.
Only FootballPlayer.fbx is exported; cricket and source atlases stay intact.
"""
import bpy, os, ast, math, json
ROOT=os.getcwd();OUT=os.path.join(ROOT,'artifacts/unity-sports/Assets/Resources/Sports')
bpy.ops.wm.open_mainfile(filepath=os.path.join(ROOT,'.cache/football-pro/human-football.blend'))
arm=bpy.data.objects['FootballRig'];human=bpy.data.objects['Athlete_LOD0']
arm.animation_data.action=None
for bone in arm.pose.bones:
 bone.rotation_quaternion=(1,0,0,0);bone.location=(0,0,0);bone.scale=(1,1,1)
bpy.context.view_layer.update()
tree=ast.parse(open('tools/sports-assets/upgrade-unity-human.py').read())
for node in tree.body:
 if isinstance(node,ast.FunctionDef) and node.name in ['activate','export']:
  exec(compile(ast.Module(body=[node],type_ignores=[]),'<human export>','exec'))
shirt={i for p in human.data.polygons if p.material_index==2 for i in p.vertices if human.data.vertices[i].co.z>1.08}
activate(human)
group=human.vertex_groups.new(name='Jersey refinement');group.add(list(shirt),1,'REPLACE')
smooth=human.modifiers.new('Relax angular shirt folds','SMOOTH');smooth.vertex_group=group.name;smooth.factor=.55;smooth.iterations=5
while human.modifiers.find(smooth.name)>0:bpy.ops.object.modifier_move_up(modifier=smooth.name)
bpy.ops.object.modifier_apply(modifier=smooth.name)
human.vertex_groups.remove(human.vertex_groups['Jersey refinement'])
# Smooth continuous arm/chest blend. Very abrupt per-vertex bone changes in
# the previous shirt created pointed shoulders during walk and sprint clips.
for index in shirt:
 v=human.data.vertices[index];x,y,z=v.co
 side='L' if x>0 else 'R'
 armweight=max(0,min(1,(abs(x)-.13)/.19)) if z>1.26 else 0
 armweight=armweight*armweight*(3-2*armweight)
 chest=max(0,min(1,(z-1.12)/.28))
 weights={'Arm.'+side:armweight,'Chest':(1-armweight)*chest,'Spine':(1-armweight)*(1-chest)}
 for g in human.vertex_groups:g.remove([index])
 for name,weight in weights.items():
  if weight>0:human.vertex_groups[name].add([index],weight,'REPLACE')
# Keep the detailed face and curved shoulder silhouette in the close LOD.
sub=human.modifiers.new('Close camera surface detail','SUBSURF');sub.levels=1;sub.render_levels=1
while human.modifiers.find(sub.name)>0:bpy.ops.object.modifier_move_up(modifier=sub.name)
bpy.ops.object.modifier_apply(modifier=sub.name)
# Retain the improved silhouette without multiplying every distant player by
# four. The existing exporter then produces the usual 35% / 10% distance LODs.
budget=human.modifiers.new('WebGL detail budget','DECIMATE');budget.ratio=.30
while human.modifiers.find(budget.name)>0:bpy.ops.object.modifier_move_up(modifier=budget.name)
bpy.ops.object.modifier_apply(modifier=budget.name)
for p in human.data.polygons:p.use_smooth=True
assert len(human.data.uv_layers)==1
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT,'.cache/football-pro/football-matchday.blend'))
export('FootballPlayer')
print('FOOTBALL_KIT_REFINED',len(human.data.vertices))
