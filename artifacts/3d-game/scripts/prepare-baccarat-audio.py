"""Build original Baccarat lounge music and Hindi speech from the cached Kokoro model.

Run with Python 3.11; dependencies/model live in .cache/sports-commentary.
FFMPEG may override the existing local media tool. No runtime TTS service is needed.
"""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[3]
CACHE = ROOT / '.cache/sports-commentary'
sys.path.insert(0, str(CACHE / 'packages'))
import numpy as np
import onnxruntime as ort
import soundfile as sf
from kokoro_onnx import Kokoro

OUT = ROOT / 'artifacts/3d-game/public/media/baccarat/audio'
WORK = ROOT / 'tmp/baccarat-audio'
OUT.mkdir(parents=True, exist_ok=True)
WORK.mkdir(parents=True, exist_ok=True)
FFMPEG = os.environ.get('FFMPEG', str(ROOT / '.cache/teen-patti-media/package/ffmpeg.exe'))

def encode(samples, rate, key, music=False):
    source = WORK / (key + '.wav')
    sf.write(source, samples, rate)
    subprocess.run([FFMPEG, '-v', 'error', '-y', '-i', str(source), '-af',
                    'loudnorm=I=-21:TP=-3:LRA=8' if music else 'highpass=f=85,loudnorm=I=-16:TP=-2:LRA=7',
                    '-ar', '44100' if music else '24000', '-codec:a', 'libmp3lame',
                    '-b:a', '128k' if music else '64k', str(OUT / (key + '.mp3'))],
                   check=True, creationflags=subprocess.CREATE_NO_WINDOW)

# Eight bars of original, quiet Rhodes/bass/brush lounge at 68 BPM. Notes wrap
# their decay into the start of the buffer so the loop has no hard tail cut.
rate, beat = 44100, 60 / 68
length = round(32 * beat * rate)
music = np.zeros((length, 2), dtype=np.float64)
rng = np.random.default_rng(20261017)

def note(at, midi, duration, level, pan=0, bass=False):
    t = np.arange(round(duration * rate)) / rate
    f = 440 * 2 ** ((midi - 69) / 12)
    env = np.minimum(1, t / .018) * np.exp(-t / (duration * .32)) * np.minimum(1, (duration - t) / .15)
    wave = np.sin(2*np.pi*f*t + .55*np.sin(2*np.pi*f*2*t)*np.exp(-t*3))
    wave += .16*np.sin(2*np.pi*f*2*t)*np.exp(-t*4)
    if bass: wave = np.sin(2*np.pi*f*t) + .12*np.sin(2*np.pi*f*2*t)
    data = wave * env * level
    for delay, gain in [(0, 1), (.087, .11), (.173, .07)]:
        indices = (round((at + delay) * rate) + np.arange(len(t))) % length
        music[indices, 0] += data * gain * np.sqrt((1-pan)/2)
        music[indices, 1] += data * gain * np.sqrt((1+pan)/2)

chords = [(38, [53, 57, 60, 64]), (43, [53, 57, 59, 64]),
          (36, [52, 55, 59, 62]), (33, [49, 55, 59, 64])]
for bar in range(8):
    bass, chord = chords[bar % 4]
    at = bar * 4 * beat
    for j, midi in enumerate(chord):
        note(at + j*.018, midi, beat*3.7, .075, (j-1.5)*.28)
        note(at + beat*2.5 + j*.014, midi, beat*1.4, .027, (1.5-j)*.3)
    for offset, pitch in [(0, bass), (1.5, bass+12), (3, bass+7)]:
        note(at+offset*beat, pitch, beat*.95, .12, bass=True)
    if bar % 2:
        for j, pitch in enumerate([chord[-1]+12, chord[-2]+12, chord[-1]+7]):
            note(at+(1+j*.65)*beat, pitch, beat*.9, .025, .2)
    for eighth in range(8):
        n = round(rate * .13)
        t = np.arange(n) / rate
        noise = rng.normal(0, 1, n)
        brush = np.diff(noise, prepend=0) * np.exp(-t*45) * np.minimum(1,t/.004) * .003
        indices = (round((at+eighth*.5*beat)*rate)+np.arange(n)) % length
        music[indices, 0] += brush
        music[indices, 1] += brush*.75
encode(music, rate, 'vip-lounge', True)

digits = ['शून्य', 'एक', 'दो', 'तीन', 'चार', 'पाँच', 'छह', 'सात', 'आठ', 'नौ']
lines = {
    'open': 'अपनी बेट लगाइए।',
    'closing': 'आख़िरी पाँच सेकंड।',
    'closed': 'बेटिंग बंद। अब कार्ड खुलेंगे।',
    'player-wins': 'प्लेयर की जीत।',
    'banker-wins': 'बैंकर की जीत।',
    'tie': 'यह राउंड टाई है।',
    'natural-8': 'नेचुरल आठ।',
    'natural-9': 'नेचुरल नौ।',
    'player-pair': 'प्लेयर पेयर।',
    'banker-pair': 'बैंकर पेयर।',
    'both-pairs': 'प्लेयर और बैंकर, दोनों पेयर।',
}
for side, name in [('player', 'प्लेयर'), ('banker', 'बैंकर')]:
    for value, word in enumerate(digits): lines[f'{side}-{value}'] = f'{name}, {word}।'

options = ort.SessionOptions()
options.intra_op_num_threads = 2
options.inter_op_num_threads = 1
options.log_severity_level = 3
model = CACHE / 'kokoro-v1.0.onnx'
session = ort.InferenceSession(str(model), sess_options=options, providers=['CPUExecutionProvider'])
kokoro = Kokoro.from_session(session, str(CACHE / 'voices-v1.0.bin'))
clips = []
for key, text in lines.items():
    samples, sample_rate = kokoro.create(text, voice='hf_alpha', speed=1.08, lang='hi')
    samples = np.asarray(samples)
    active = np.flatnonzero(np.abs(samples) > .008)
    if not len(active): raise RuntimeError('Silent speech: ' + key)
    samples = samples[max(0,active[0]-round(.045*sample_rate)):min(len(samples),active[-1]+round(.1*sample_rate))]
    encode(samples, sample_rate, key)
    clips.append({'id': key, 'text': text, 'seconds': round(len(samples)/sample_rate, 3)})
    print(f'{key}: {len(samples)/sample_rate:.2f}s', flush=True)

(OUT / 'manifest.json').write_text(json.dumps({
    'language': 'hi-IN', 'engine': 'Kokoro v1.0 ONNX', 'voice': 'hf_alpha',
    'modelSha256': hashlib.sha256(model.read_bytes()).hexdigest(), 'clips': clips,
    'music': {'file': 'vip-lounge.mp3', 'bpm': 68, 'seconds': length/rate,
              'credits': 'Original synthesized electric piano, bass and brushes composed for Baccarat VIP.'},
}, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
(OUT / 'CREDITS.txt').write_text(
    'Original Hindi Baccarat scripts; locally generated with Kokoro v1.0 (Apache-2.0), stock hf_alpha voice.\n'
    'No real dealer voice was cloned. Commentary is independent of the reference video.\n'
    'Model: https://huggingface.co/hexgrad/Kokoro-82M\n'
    'Runtime: https://github.com/thewh1teagle/kokoro-onnx (MIT)\n'
    'Music: original composition and synthesis in scripts/prepare-baccarat-audio.py.\n', encoding='utf-8')
print('Baccarat audio ready.', flush=True)
