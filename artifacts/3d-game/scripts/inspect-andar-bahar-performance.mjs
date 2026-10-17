import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
const input = process.argv[2];
if (!input) throw new Error("Pass a local dealer performance video");
const target = path.resolve(process.argv[3] ?? "tmp/andar-bahar-live/natural-motion-review");
mkdirSync(target, { recursive: true });
const bin = path.resolve("tmp/dt-ffmpeg/ffmpeg-9.0.2-essentials_build/bin");
const probe = spawnSync(path.join(bin, "ffprobe.exe"), ["-v","error","-show_streams","-show_format","-of","json",input], {encoding:"utf8",windowsHide:true});
if (probe.status !== 0) throw new Error(probe.stderr);
const metadata = JSON.parse(probe.stdout);
const video = metadata.streams.find(s => s.codec_type === "video");
const summary = {input:path.basename(input), width:video.width, height:video.height, fps:video.avg_frame_rate, duration:Number(metadata.format.duration)};
writeFileSync(path.join(target,"media.json"), JSON.stringify(summary,null,2));
const result = spawnSync(path.join(bin,"ffmpeg.exe"),["-hide_banner","-loglevel","error","-y","-i",input,"-vf","fps=1,scale=320:-1,tile=5x6","-frames:v","1",path.join(target,"performance-overview.png")],{encoding:"utf8",windowsHide:true});
if(result.status !== 0) throw new Error(result.stderr);
console.log(JSON.stringify({...summary, overview:path.join(target,"performance-overview.png")}));

