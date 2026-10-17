"""Read original ASF/AMC capture and evaluate its skeleton in Blender metres.

ASF axis rotations describe each joint's local basis. Applying rotations in
that basis (C R C^-1), then accumulating the hierarchy, preserves capture
directions without assuming its rest pose matches our athlete.
"""
import math,re
from mathutils import Vector,Matrix,Euler

def read_capture(directory,clip='10_01'):
 text=open(directory+'/10.asf').read();bones={}
 for block in re.findall(r'\bbegin\s+(.*?)\bend\b',text.split(':bonedata')[1].split(':hierarchy')[0],re.S):
  fields={line.strip().split()[0]:line.strip().split()[1:] for line in block.splitlines() if line.strip()}
  if 'name' not in fields:continue
  axis=Euler(tuple(math.radians(float(v)) for v in fields['axis'][:3]),'XYZ').to_matrix()
  bones[fields['name'][0]]={'direction':Vector(tuple(map(float,fields['direction']))),'length':float(fields['length'][0])*.0254/.45,'basis':axis,'dof':fields.get('dof',[])}
 hierarchy=[]
 for line in text.split(':hierarchy')[1].splitlines():
  parts=line.split()
  if len(parts)>1:hierarchy.extend((parts[0],child) for child in parts[1:])
 frames=[]
 for line in open(directory+'/'+clip+'.amc'):
  parts=line.split()
  if not parts or line.startswith(('#',':')):continue
  if len(parts)==1:frames.append({})
  else:frames[-1][parts[0]]=list(map(float,parts[1:]))
 conversion=Matrix(((1,0,0),(0,0,-1),(0,1,0)))
 poses=[]
 for frame in frames:
  root=frame['root'];position=Vector(root[:3])*(.0254/.45)
  rotation=Euler(tuple(math.radians(v) for v in root[3:]),'XYZ').to_matrix()
  rotations={'root':rotation};ends={'root':position};pose={'root':conversion@position}
  for parent,name in hierarchy:
   b=bones[name];angles=[0.,0.,0.]
   for dof,value in zip(b['dof'],frame.get(name,[])):
    if dof[0]=='r':angles['xyz'.index(dof[1])]=math.radians(value)
   rot=rotations[parent]@b['basis']@Euler(angles,'XYZ').to_matrix()@b['basis'].transposed()
   start=ends[parent];end=start+rot@b['direction']*b['length']
   rotations[name]=rot;ends[name]=end
   pose[name]=(conversion@start,conversion@end)
  poses.append(pose)
 return poses

if __name__=='__main__':
 import os,json
 poses=read_capture(os.path.abspath('.cache/football-pro/mocap'))
 samples=[]
 for i in range(1,len(poses)-1):
  a,b,c=poses[i-1],poses[i],poses[i+1]
  for side in ['l','r']:
   foot=b[side+'foot'][1];speed=((c[side+'foot'][1]-c['root'])-(a[side+'foot'][1]-a['root'])).length*60
   if foot.z<.55:samples.append((round(speed,3),i,side,round(foot.z,3)))
 print('CAPTURE_FRAMES',len(poses),'STRIKES',sorted(samples,reverse=True)[:20])
 print('POSE',json.dumps({k:[list(x) for x in v] if k!='root' else list(v) for k,v in poses[0].items()}))
