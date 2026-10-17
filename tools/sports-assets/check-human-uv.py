import bpy,os,numpy as np
for file in ['human-football.blend','human-football.blend1','human-upgrade.blend1']:
 bpy.ops.wm.open_mainfile(filepath=os.path.abspath('.cache/football-pro/'+file))
 for o in bpy.data.objects:
  if o.type=='MESH':
   image=bpy.data.images.load(os.path.abspath('artifacts/unity-sports/Assets/Resources/Sports/Textures/HumanAtlas.png'),check_existing=True);pixels=np.empty(len(image.pixels),dtype=np.float32);image.pixels.foreach_get(pixels);w,h=image.size
   report=[]
   for uv in o.data.uv_layers:
    samples=[]
    for p in o.data.polygons:
     if p.material_index==2 and all(1.2<o.data.vertices[i].co.z<1.4 for i in p.vertices):
      for i in p.loop_indices:
       u,v=uv.data[i].uv;x=min(w-1,int(u%1*w));y=min(h-1,int(v%1*h));samples.append(sum(pixels[(y*w+x)*4:(y*w+x)*4+3])/3)
    report.append((uv.name,uv.active_render,round(sum(samples)/max(1,len(samples)),3)))
   print('UV_CHANNELS',file,o.name,report)
