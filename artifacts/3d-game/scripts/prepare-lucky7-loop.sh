#!/usr/bin/env bash
# A complete calm loop: forward frames 0..N-1, then N-2..1.
# Adjacent frames meet at both joins, without dissolves, cloned holds or app seeks.
set -euo pipefail
source_clip="$1"
output_dir="$2"
mkdir -p "$output_dir"
frames=$(ffprobe -v error -select_streams v:0 -count_frames -show_entries stream=nb_read_frames -of csv=p=0 "$source_clip")
reverse_end=$((frames - 1))
ffmpeg -v error -y -threads 2 -i "$source_clip" -filter_complex_threads 1 \
  -filter_complex "[0:v]fps=24,format=yuv420p,split[a][b];[b]reverse,trim=start_frame=1:end_frame=$reverse_end,setpts=PTS-STARTPTS[r];[a][r]concat=n=2:v=1:a=0[v]" \
  -map '[v]' -an -c:v libx264 -threads 2 -preset fast -tune fastdecode -crf 20 \
  -profile:v baseline -level:v 4.0 -pix_fmt yuv420p -g 24 -keyint_min 24 -sc_threshold 0 \
  -movflags +faststart "$output_dir/asha-continuous-studio-1080p.mp4"
ffmpeg -v error -y -threads 2 -i "$output_dir/asha-continuous-studio-1080p.mp4" \
  -vf scale=1280:720:flags=lanczos -an -c:v libx264 -threads 2 -preset fast -tune fastdecode -crf 21 \
  -profile:v baseline -level:v 3.1 -pix_fmt yuv420p -g 24 -keyint_min 24 -sc_threshold 0 \
  -movflags +faststart "$output_dir/asha-continuous-studio-720p.mp4"
ffmpeg -v error -y -threads 2 -i "$output_dir/asha-continuous-studio-720p.mp4" \
  -an -c:v libvpx-vp9 -threads 2 -row-mt 1 -cpu-used 4 -crf 32 -b:v 0 -g 48 \
  "$output_dir/asha-continuous-studio-720p.webm"
ffmpeg -v error -y -i "$output_dir/asha-continuous-studio-1080p.mp4" \
  -frames:v 1 -q:v 3 "$output_dir/asha-continuous-studio-poster.jpg"
for media in "$output_dir"/asha-continuous-studio-*.mp4 "$output_dir"/asha-continuous-studio-*.webm; do
  ffprobe -v error -show_entries stream=codec_name,profile,width,height,r_frame_rate,nb_frames:format=filename,duration,size -of json "$media"
done
