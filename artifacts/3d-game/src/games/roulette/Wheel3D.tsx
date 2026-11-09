import { useMemo } from "react";
import { IMG, DIAMOND_SHEET } from "./assets";
import { BOWL } from "./layout";
import { discPoint } from "./geometry";
import type { Wheel } from "./wheelSpec";

/**
 * The wheel composite: bowl art, the spinning number ring, the hub diamond and
 * the ball, all authored inside one 660 x 432 box.
 *
 * The ring is a flat sprite tilted with a CSS 3D transform rather than a
 * textured mesh. That is the native equivalent of the projection the source
 * builds by hand — `perspective(d) rotateX(tilt) rotateZ(spin)` IS the matrix
 * it constructs — and it hands the compositor a static image with a rotation on
 * it, which is precisely the property the source went to a mesh to get: the
 * browser is never asked to re-rasterise a perspective-warped bitmap per frame,
 * so there is no wobble and no shimmer along the rim.
 *
 * `transform-style: preserve-3d` and the perspective live on the ring's own
 * wrapper, not on an ancestor, so the rest of the screen stays a flat 2D layer.
 */
export interface Wheel3DProps {
  wheel: Wheel;
  /** The ring's rotation, screen convention, radians. */
  spin: number;
  /** The ball's angle, screen convention, radians. */
  ballAngle: number;
  /** The ball's orbit radius, in the ring's 500-unit square. */
  ballRadius: number;
  /** Which sparkle frame the hub diamond is on; 0 while the ring is still. */
  sparkleFrame: number;
}

export function Wheel3D({
  wheel,
  spin,
  ballAngle,
  ballRadius,
  sparkleFrame,
}: Wheel3DProps) {
  const ball = useMemo(() => discPoint(ballRadius, ballAngle), [ballRadius, ballAngle]);

  const frame = sparkleFrame % DIAMOND_SHEET.frames;
  const sheetCol = frame % DIAMOND_SHEET.cols;
  const sheetRow = Math.floor(frame / DIAMOND_SHEET.cols);

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: BOWL.w,
        height: BOWL.h,
        // The ball orbits past the right edge of this box, so nothing here may
        // clip. The parent scales the whole thing into the drawn footprint.
        overflow: "visible",
      }}
    >
      {/* The bowl: static art, fills the box. */}
      <img
        src={IMG.bowl[wheel.code]}
        alt=""
        draggable={false}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
      />

      {/* The number ring, tilted and turned. */}
      <div
        style={{
          position: "absolute",
          left: BOWL.w / 2 + BOWL.discOffset.x,
          top: BOWL.h / 2 + BOWL.discOffset.y,
          width: 0,
          height: 0,
          perspective: `${BOWL.discPerspective}px`,
          transformStyle: "preserve-3d",
        }}
      >
        <img
          src={IMG.ring[wheel.code]}
          alt=""
          draggable={false}
          style={{
            position: "absolute",
            left: -BOWL.discBase / 2,
            top: -BOWL.discBase / 2,
            // A SQUARE element, with the 492 x 533 painted size applied as the
            // OUTERMOST scale. The disc is not square on screen, and if that
            // stretch is baked into the element's box the rotation turns the
            // stretch with it: the outline swells and shrinks by 8% twice a
            // turn and the wheel reads as a wobbling oval. Spun square and
            // stretched afterwards, the outline never moves — which is the
            // property the source built a mesh to get.
            width: BOWL.discBase,
            height: BOWL.discBase,
            transform: `scale(${BOWL.discW / BOWL.discBase}, ${
              BOWL.discH / BOWL.discBase
            }) rotateX(${BOWL.discTiltDeg}deg) rotateZ(${spin}rad)`,
            transformOrigin: "50% 50%",
            // The wrapper is a 0x0 anchor, and the app's CSS reset gives every
            // <img> `max-width: 100%`. Inside a zero-width parent that is a
            // zero-width ring: it rendered as a twelve-pixel sliver, hidden
            // behind the bowl art's own painted numbers, so the wheel LOOKED
            // right and never turned. The ball was landing on a ring nobody
            // could see.
            maxWidth: "none",
            // Without this the browser re-rasterises the warped bitmap on some
            // frames and the rim crawls.
            backfaceVisibility: "hidden",
            willChange: "transform",
          }}
        />
      </div>

      {/* The hub diamond: its own tilt and perspective, one sheet frame at a time. */}
      <div
        style={{
          position: "absolute",
          left: BOWL.w / 2 + BOWL.diamondOffset.x,
          top: BOWL.h / 2 + BOWL.diamondOffset.y,
          width: 0,
          height: 0,
          perspective: `${BOWL.diamondPerspective}px`,
          transformStyle: "preserve-3d",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: -BOWL.diamondW / 2,
            top: -BOWL.diamondH / 2,
            width: BOWL.diamondW,
            height: BOWL.diamondH,
            transform: `scale(${BOWL.diamondScale}) rotateX(${BOWL.diamondTiltDeg}deg)`,
            transformOrigin: "50% 50%",
            backgroundImage: `url(${IMG.diamond})`,
            // One 90x76 cell of a 4x5 sheet, blown up so that cell exactly
            // fills the diamond's box: scale the whole sheet by the same
            // factor, then slide the wanted cell into view.
            backgroundSize: `${DIAMOND_SHEET.cols * BOWL.diamondW}px ${
              DIAMOND_SHEET.rows * BOWL.diamondH
            }px`,
            backgroundPosition: `${-sheetCol * BOWL.diamondW}px ${
              -sheetRow * BOWL.diamondH
            }px`,
            backgroundRepeat: "no-repeat",
          }}
        />
      </div>

      {/*
        The ball. It lies IN the ring's plane, so it is foreshortened by the
        same projection — the near edge of the orbit is slightly larger than the
        far edge, which is what stops it reading as a sticker on top of the
        wheel.
      */}
      <img
        src={IMG.ball}
        alt=""
        draggable={false}
        style={{
          position: "absolute",
          left: BOWL.w / 2 + BOWL.discOffset.x + ball.x - BOWL.ballSize / 2,
          top: BOWL.h / 2 + BOWL.discOffset.y + ball.y - BOWL.ballSize / 2,
          width: BOWL.ballSize,
          height: BOWL.ballSize,
          // Two axes, not one: the ball lies IN the wheel's plane, so it is
          // foreshortened top-to-bottom like the pockets are. A uniform scale
          // kept it a perfect circle, and a circle on a tilted disc reads as
          // something floating above it.
          transform: `scale(${ball.patch.x.toFixed(4)}, ${ball.patch.y.toFixed(4)})`,
          transformOrigin: "50% 50%",
          objectFit: "contain",
        }}
      />
    </div>
  );
}
