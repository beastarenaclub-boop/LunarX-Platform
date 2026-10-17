"""Iterate on the cricket kit using the completed, baked football mesh."""
import bpy,os,math,json,ast,bmesh
from mathutils import Vector
ROOT=os.getcwd();OUT=os.path.join(ROOT,'artifacts/unity-sports/Assets/Resources/Sports')
source=open('tools/sports-assets/upgrade-unity-human.py').read()
tree=ast.parse(source)
for node in tree.body:
 if isinstance(node,ast.FunctionDef) and node.name in ['activate','remove_faces','export']:
  exec(compile(ast.Module(body=[node],type_ignores=[]),'<human helpers>','exec'))
bpy.ops.wm.open_mainfile(filepath=os.path.abspath('.cache/football-pro/human-football.blend'))
arm=bpy.data.objects['FootballRig'];human=bpy.data.objects['Athlete_LOD0'];newmats=list(human.data.materials)
mapping=json.load(open(os.path.join(OUT,'materials.json')))['materials']
start=source.index('# Author continuous trouser legs.')
exec(compile(source[start:],'cricket variant','exec'))
