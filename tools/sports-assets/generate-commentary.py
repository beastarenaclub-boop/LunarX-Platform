"""Generate original Hindi match announcements locally with Kokoro ONNX.
Dependencies are isolated in .cache/sports-commentary/packages.
No announcer imitation or cloned reference voice is used.
"""
import sys,os,json,urllib.request,concurrent.futures,hashlib
from pathlib import Path
root=Path(__file__).resolve().parents[2]
cache=root/'.cache/sports-commentary'
sys.path.insert(0,str(cache/'packages'))
use_dml=os.environ.get('ARENA_TTS_DML')=='1'
if use_dml: sys.path.insert(0,str(cache/'dml'))
os.environ['OMP_NUM_THREADS']='2'
import numpy as np
import onnxruntime as ort
import soundfile as sf
from kokoro_onnx import Kokoro
base='https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/'
def download(name):
    path=cache/name
    if not path.exists():
        urllib.request.urlretrieve(base+name,path)
    return path
model=os.environ.get('ARENA_TTS_MODEL','kokoro-v1.0.onnx')
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
    paths=list(pool.map(download,[model,'voices-v1.0.bin']))
options=ort.SessionOptions();options.intra_op_num_threads=2;options.inter_op_num_threads=1
options.enable_mem_pattern=not use_dml
options.log_severity_level=3
providers=[('DmlExecutionProvider',{'device_id':int(os.environ.get('ARENA_TTS_DEVICE','1'))}),'CPUExecutionProvider'] if use_dml else ['CPUExecutionProvider']
session=ort.InferenceSession(str(paths[0]),sess_options=options,providers=providers)
print('Speech providers: '+str(session.get_providers()),flush=True)
kokoro=Kokoro.from_session(session,str(paths[1]))
output=root/'artifacts/3d-game/public/virtual-sports/audio/hi'
output.mkdir(parents=True,exist_ok=True)
lines=json.loads((cache/'lines.json').read_text(encoding='utf-8'))
report=[]
for i,(key,text) in enumerate(lines.items()):
    target=output/(key+'.ogg')
    if not target.exists():
        samples,rate=kokoro.create(text,voice='hm_omega',speed=1.08,lang='hi')
        samples=np.asarray(samples)
        peak=float(np.max(np.abs(samples)))
        if peak<.001 or len(samples)/rate<.5: raise RuntimeError('Empty speech: '+key)
        samples=samples/max(1,peak/0.89)
        sf.write(target,samples,rate,format='OGG',subtype='VORBIS')
    info=sf.info(target)
    report.append({'id':key,'seconds':round(info.duration,2),'bytes':target.stat().st_size})
    print(f'{i+1}/{len(lines)} {key}: {info.duration:.1f}s',flush=True)
(output/'manifest.json').write_text(json.dumps({'language':'hi-IN','engine':'Kokoro v1.0 ONNX','voice':'hm_omega','clips':report},ensure_ascii=False,indent=2),encoding='utf-8')
(output/'CREDITS.txt').write_text('Original Hindi scripts authored for Arena Sports. Generated locally with Kokoro v1.0 (Apache-2.0), voice hm_omega. No real commentator voice was cloned.\nModel: https://huggingface.co/hexgrad/Kokoro-82M\nONNX runtime wrapper (MIT): https://github.com/thewh1teagle/kokoro-onnx\nModel SHA256: '+hashlib.sha256(paths[0].read_bytes()).hexdigest()+'\n',encoding='utf-8')
print('Hindi announcement pack complete.',flush=True)
