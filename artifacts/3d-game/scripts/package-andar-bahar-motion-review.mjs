import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const source = process.argv[2];
if (!source) throw new Error("Pass the original screen recording path");
const root = path.resolve("exports/andar-bahar-motion-review-2026-10-16");
const scratch = path.resolve("tmp/andar-bahar-live");
const bin = path.resolve("tmp/dt-ffmpeg/ffmpeg-9.0.2-essentials_build/bin");
mkdirSync(root, { recursive: true });
const run = (args) => {
  const result = spawnSync(path.join(bin, "ffmpeg.exe"), ["-hide_banner", "-loglevel", "error", "-y", ...args], { encoding: "utf8", windowsHide: true });
  if (result.status !== 0) throw new Error(result.stderr);
};
// Preserve the original human performance and frame rate; crop game chrome only.
run(["-ss", "139", "-i", source, "-t", "30", "-vf", "crop=1430:566:30:56", "-an", "-c:v", "libx264", "-preset", "fast", "-crf", "17", "-pix_fmt", "yuv420p", "-movflags", "+faststart", path.join(root, "real-dealer-reference.mp4")]);
copyFileSync(path.join(scratch, "continuous-dealer-pilot-v1.mp4"), path.join(root, "ai-dealer-pilot.mp4"));
for (const name of ["real-dealer-reference", "ai-dealer-pilot"]) {
  run(["-ss", "0", "-i", path.join(root, `${name}.mp4`), "-frames:v", "1", "-q:v", "2", path.join(root, `${name}.jpg`)]);
}
copyFileSync(path.join(scratch, "natural-motion-review/performance-overview.png"), path.join(root, "ai-contact-sheet.png"));
copyFileSync(path.join(scratch, "natural-motion-review/cards-at-18s.png"), path.join(root, "ai-cards-at-18s.png"));

const jobPath = path.join(scratch, "natural-motion-job.json");
const job = JSON.parse(readFileSync(jobPath, "utf8"));
job.integrationStatus = "rejected for gameplay: card opening and placement do not match Andar Bahar";
job.review = {
  reviewedAt: new Date().toISOString(),
  deployedToGame: false,
  motion: "Continuous varied head, body and hand motion; no short repeated clip inside this 30-second take.",
  failures: [
    "Dealt cards stay pink/back-side up rather than being physically opened face-up.",
    "Cards accumulate across one horizontal row instead of alternating Andar and Bahar rows.",
    "Initial loose cards and subsequent card layout differ from the requested game state."
  ],
  sourceRecording: "The real recording has continuous dealing, but changing positions, baked card values and UI overlays prevent a direct drop-in replacement for server-controlled rounds.",
  currentGame: "Still uses one recorded hand take per side. This pilot does not resolve that limitation.",
  cost: { creditsUsed: job.creditsUsed, creditsRemainingAfterGeneration: job.creditsRemaining },
};
writeFileSync(jobPath, JSON.stringify(job, null, 2) + "\n");
writeFileSync(path.join(root, "review.json"), JSON.stringify({ ...job, prompt: undefined, referenceFile: undefined, localFile: "ai-dealer-pilot.mp4" }, null, 2) + "\n");

writeFileSync(path.join(root, "index.html"), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Andar Bahar — dealer motion review</title>
<style>
:root{color-scheme:dark;font-family:system-ui,sans-serif;background:#111116;color:#f5f2eb}*{box-sizing:border-box}body{margin:0}main{max-width:1440px;margin:auto;padding:32px 24px}h1{font-size:clamp(24px,4vw,38px);margin:8px 0 12px}h2{font-size:20px;margin:0 0 12px}p{line-height:1.6;color:#d4d1c9;max-width:85ch}.eyebrow{color:#d9b76d;letter-spacing:.12em;font-size:12px;font-weight:700}.notice{padding:14px 18px;background:#39281b;border:1px solid #775236;border-radius:12px}.toolbar{display:flex;flex-wrap:wrap;gap:10px;margin:22px 0}button,a{color:inherit}button{font:inherit;font-weight:650;border:1px solid #55505e;border-radius:9px;background:#292730;padding:11px 18px;cursor:pointer}button.primary{background:#d9b76d;color:#16120c;border-color:#d9b76d}button:focus-visible,a:focus-visible{outline:3px solid #faf3d5;outline-offset:3px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}.panel{background:#1b1a21;border:1px solid #38343e;border-radius:14px;padding:18px;min-width:0}.video-frame{background:#08080b;aspect-ratio:16/9;display:grid;place-items:center;border-radius:9px;overflow:hidden}video{width:100%;height:100%;object-fit:contain}.meta{font-size:13px;color:#b9b3a7;margin-top:10px}.status{color:#e9ba80;font-weight:650}.details{margin-top:26px}.details li{margin-bottom:8px;line-height:1.5}.details img{display:block;width:100%;max-width:1100px;height:auto;border-radius:9px}footer{border-top:1px solid #38343e;margin-top:28px;padding-top:12px;font-size:13px;color:#b9b3a7}@media(max-width:760px){main{padding:24px 14px}.grid{grid-template-columns:1fr}.panel{padding:12px}}
</style></head><body><main>
<div class="eyebrow">ANDAR BAHAR · MOTION REVIEW</div>
<h1>Natural movement needs correct card handling.</h1>
<p>Compare a continuous real dealer performance with the new AI pilot. Both clips play once, at their original speed. This page is a motion test, not a playable game.</p>
<p class="notice"><strong>Game integration: not ready.</strong> The AI take improves motion variety, but does not open and place cards correctly. The live game's repeated hand take is still unresolved.</p>
<div class="toolbar"><button class="primary" id="play">Play both from start</button><button id="pause">Pause both</button><button id="cards">Inspect AI cards at 18s</button></div>
<p id="playback-status" role="status" aria-live="polite"></p>
<div class="grid">
<article class="panel"><h2>Original human performance</h2><div class="video-frame"><video id="real" controls playsinline muted preload="metadata" poster="real-dealer-reference.jpg" src="real-dealer-reference.mp4"></video></div><div class="meta">30 seconds · 30 fps · native crop · source 02:19–02:49</div><p>Natural gaze, grip and wrist changes. Cards physically turn face-up and form two rows.</p><p>The recorded card values and positions are baked into this footage. It cannot directly represent every server-generated game result.</p></article>
<article class="panel"><h2>Runway / Seedance 2.5 pilot</h2><div class="video-frame"><video id="ai" controls playsinline muted preload="metadata" poster="ai-dealer-pilot.jpg" src="ai-dealer-pilot.mp4"></video></div><div class="meta">30 seconds · 1920 × 1080 · 24 fps · no interpolation</div><p>Continuous head, shoulder and hand motion, with different reaches and pauses.</p><p class="status">Rejected for gameplay: pink card backs remain visible, and cards form one row instead of alternating Andar and Bahar.</p></article>
</div>
<section class="details"><h2>Why this pilot was not added to the game</h2><ul><li>The dealer must physically reveal the face of each card before the game shows its rank.</li><li>Hand contact, card position and the server's reveal timing must agree.</li><li>This pilot does not satisfy those requirements. More resolution does not repair an incorrect action.</li></ul><img src="ai-cards-at-18s.png" alt="At 18 seconds, the AI dealer is laying pink face-down cards across a horizontal row."><p><a href="ai-dealer-pilot.mp4" download>Download AI pilot</a> · <a href="real-dealer-reference.mp4" download>Download human reference</a> · <a href="ai-contact-sheet.png">See the full AI sequence</a> · <a href="review.json">Review record</a></p></section>
<footer>One generation used 2,040 Runway credits. Balance immediately after generation: 193 credits. No additional generation or credit purchase was made for this review.</footer>
</main><script>
const videos=[document.querySelector('#real'),document.querySelector('#ai')];
const status=document.querySelector('#playback-status');
document.querySelector('#play').onclick=async()=>{videos.forEach(v=>{v.pause();v.currentTime=0;v.playbackRate=1});const results=await Promise.allSettled(videos.map(v=>v.play()));status.textContent=results.some(r=>r.status==='rejected')?'Use the individual video play controls to start playback.':'Playing both clips at normal speed.'};
document.querySelector('#pause').onclick=()=>{videos.forEach(v=>v.pause());status.textContent='Both clips paused.'};
document.querySelector('#cards').onclick=()=>{videos.forEach(v=>v.pause());videos[1].currentTime=18;videos[1].scrollIntoView({block:'center',behavior:'smooth'});status.textContent='AI clip paused at 18 seconds. The dealt cards are face-down in one row.'};
</script></body></html>`);
console.log(JSON.stringify({ review: path.join(root, "index.html"), verdict: job.integrationStatus, creditsUsed: job.creditsUsed }));
