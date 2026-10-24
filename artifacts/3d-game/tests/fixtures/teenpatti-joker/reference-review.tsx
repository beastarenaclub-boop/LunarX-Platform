import { useRef } from "react";
import { createRoot } from "react-dom/client";
import { dealJoker } from "@workspace/api-zod/teenpatti-joker";
import JokerPaperInk, {
  type PaperCalibration,
} from "@/components/teenpattiJoker/JokerPaperInk";
import tracks from "@/assets/teenpatti-joker/reference-motion/paper-tracks.json";
function Review() {
  const video = useRef<HTMLVideoElement>(null);
  return (
    <>
      <div
        style={{
          position: "relative",
          width: "min(960px,100vw)",
          aspectRatio: "16/9",
        }}
      >
        <style>{`.j20-paper-ink{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}`}</style>
        <video
          ref={video}
          muted
          playsInline
          controls
          aria-label="AI dealer reference motion preview"
          style={{ width: "100%", height: "100%" }}
          src="/media/teenpatti-joker/dealer-reference-v3.mp4"
          onLoadedData={() => {
            video.current!.currentTime = 20;
            void video.current!.play().catch(() => undefined);
          }}
        />
        <JokerPaperInk
          video={video}
          calibration={tracks as unknown as PaperCalibration}
          outcome={dealJoker([3, 16, 26, 47, 36, 39, 37])}
        />
      </div>
      <p style={{ color: "#ddd", font: "14px Arial", padding: "0 16px" }}>
        Full AI dealer sequence — preparation, seven-card deal and collection.
      </p>
    </>
  );
}
createRoot(document.getElementById("root")!).render(<Review />);
