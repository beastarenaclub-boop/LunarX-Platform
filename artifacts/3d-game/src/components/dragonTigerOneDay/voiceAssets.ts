import type { CommentaryKey } from "./commentary";

// Import speech into the build so every deployment carries the exact audio
// files its JavaScript expects, including deployments that reuse public media.
const files = import.meta.glob(
  "../../assets/dragon-tiger-one-day/voice/*.mp3",
  {
    eager: true,
    query: "?url",
    import: "default",
  },
) as Record<string, string>;

export const commentaryVoices = Object.fromEntries(
  Object.entries(files).map(([file, url]) => [
    file
      .split("/")
      .pop()!
      .replace(/\.mp3$/, ""),
    url,
  ]),
) as Record<CommentaryKey, string>;
