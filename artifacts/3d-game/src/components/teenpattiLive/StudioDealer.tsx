import { useId, type RefObject } from "react";
import dealerPhoto from "@/assets/lucky7/dealer.png";
import {
  ARM_SOURCE,
  DEALER_PHOTO,
  armJoints,
  restingHand,
  segmentMatrix,
} from "./studioMotion";

export interface DealerArmElements {
  upperA: SVGGElement | null;
  lowerA: SVGGElement | null;
  upperB: SVGGElement | null;
  lowerB: SVGGElement | null;
}
const clips = {
  torso:
    "M0 0H1146V570H865L875 1060 825 1195 575 1290 325 1195 282 1060 290 570H0Z",
  upperA:
    "M290 559C195 565 160 694 114 846L20 1070Q-12 1130 48 1193L180 1196 252 1100 300 911 342 640Z",
  lowerA:
    "M0 1062L170 1045 265 1158 418 1173Q476 1178 504 1238L580 1374H466L338 1316 239 1309 69 1270Q0 1240 0 1168Z",
  upperB:
    "M861 558Q969 562 1020 747L1127 1058Q1160 1130 1105 1195L967 1200 900 1100 857 920 813 640Z",
  lowerB:
    "M1146 1062L975 1045 882 1158 728 1173Q670 1178 642 1238L570 1374H680L808 1316 907 1309 1077 1270Q1146 1240 1146 1168Z",
};

/** Articulated photo of the project's fictional adult dealer. */
export default function StudioDealer({
  layer,
  arms,
}: {
  layer: "body" | "arms";
  arms?: RefObject<DealerArmElements>;
}) {
  const id = useId().replace(/:/g, "");
  const photo = (clip: keyof typeof clips) => (
    <image
      href={dealerPhoto}
      width="1146"
      height="1374"
      clipPath={`url(#${id}-${clip})`}
    />
  );
  return (
    <svg
      className={`tpl-dealer tpl-dealer--${layer}`}
      viewBox="0 0 1200 760"
      aria-hidden="true"
      data-testid={`tpl-dealer-${layer}`}
    >
      <defs>
        {Object.entries(clips).map(([name, path]) => (
          <clipPath key={name} id={`${id}-${name}`}>
            <path d={path} />
          </clipPath>
        ))}
      </defs>
      {layer === "body" ? (
        <g
          transform={`translate(${DEALER_PHOTO.x} ${DEALER_PHOTO.y}) scale(${DEALER_PHOTO.scale})`}
        >
          {photo("torso")}
        </g>
      ) : (
        (["A", "B"] as const).map((side) => {
          const source = ARM_SOURCE[side];
          const pose = armJoints(side, restingHand(side));
          return (
            <g key={side} data-testid={`tpl-hand-${side}`}>
              <g
                ref={(el) => {
                  if (arms) arms.current[`upper${side}`] = el;
                }}
                transform={segmentMatrix(
                  source.shoulder,
                  source.elbow,
                  pose.shoulder,
                  pose.elbow,
                )}
              >
                {photo(`upper${side}`)}
              </g>
              <g
                ref={(el) => {
                  if (arms) arms.current[`lower${side}`] = el;
                }}
                transform={segmentMatrix(
                  source.elbow,
                  source.tip,
                  pose.elbow,
                  pose.tip,
                )}
              >
                {photo(`lower${side}`)}
              </g>
            </g>
          );
        })
      )}
    </svg>
  );
}
