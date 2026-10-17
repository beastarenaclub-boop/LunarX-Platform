import { useId } from "react";
import { CardFace } from "./TableCardArt";
import { PAPER_QUADS } from "./dealerFilm";

type Point = [number, number];

function paperProjection(corners: number[][]) {
  const [a, b, c, d] = corners;
  const dx1 = b[0] - c[0],
    dx2 = d[0] - c[0];
  const dy1 = b[1] - c[1],
    dy2 = d[1] - c[1];
  const dx3 = a[0] - b[0] + c[0] - d[0];
  const dy3 = a[1] - b[1] + c[1] - d[1];
  const det = dx1 * dy2 - dx2 * dy1;
  const g = (dx3 * dy2 - dx2 * dy3) / det;
  const h = (dx1 * dy3 - dx3 * dy1) / det;
  return ([x, y]: Point): Point => {
    // Leave the photographed paper edge and its contact shadow intact.
    const u = 0.035 + (x / 66) * 0.93;
    const v = 0.065 + (y / 94) * 0.87;
    const w = g * u + h * v + 1;
    return [
      ((b[0] - a[0] + g * b[0]) * u + (d[0] - a[0] + h * d[0]) * v + a[0]) / w,
      ((b[1] - a[1] + g * b[1]) * u + (d[1] - a[1] + h * d[1]) * v + a[1]) / w,
    ];
  };
}

function triangleMatrix(source: Point[], target: Point[]) {
  const [a, b, c] = source,
    [p, q, r] = target;
  const bx = b[0] - a[0],
    by = b[1] - a[1];
  const cx = c[0] - a[0],
    cy = c[1] - a[1];
  const det = bx * cy - cx * by;
  const xx = ((q[0] - p[0]) * cy - (r[0] - p[0]) * by) / det;
  const xy = ((r[0] - p[0]) * bx - (q[0] - p[0]) * cx) / det;
  const yx = ((q[1] - p[1]) * cy - (r[1] - p[1]) * by) / det;
  const yy = ((r[1] - p[1]) * bx - (q[1] - p[1]) * cx) / det;
  return `matrix(${xx} ${yx} ${xy} ${yy} ${p[0] - xx * a[0] - xy * a[1]} ${p[1] - yx * a[0] - yy * a[1]})`;
}

const triangles: Point[][] = Array.from({ length: 4 }, (_, row) => {
  const y = row * 23.5,
    end = y + 23.5;
  return [
    [
      [0, y],
      [66, y],
      [66, end],
    ],
    [
      [0, y],
      [66, end],
      [0, end],
    ],
  ] as Point[][];
}).flat();

const meshes = PAPER_QUADS.map((quad) => {
  const project = paperProjection(quad);
  return triangles.map((triangle) =>
    triangleMatrix(triangle, triangle.map(project)),
  );
});

/** Small SVG mesh keeps four-corner perspective without a WebGL dependency.
 * Only ink is added: the original filmed paper and shadows stay visible. */
export default function PhysicalCardFace({
  index,
  value,
  won,
}: {
  index: number;
  value: number;
  won: boolean;
}) {
  const id = useId().replace(/:/g, "");
  return (
    <>
      <defs>
        <g id={`${id}-face`}>
          <CardFace value={value} inkOnly />
        </g>
        {triangles.map((points, i) => (
          <clipPath
            id={`${id}-clip-${i}`}
            key={i}
            clipPathUnits="userSpaceOnUse"
          >
            <polygon points={points.map((p) => p.join(",")).join(" ")} />
          </clipPath>
        ))}
      </defs>
      {meshes[index].map((matrix, i) => (
        <g key={i} transform={matrix}>
          <g clipPath={`url(#${id}-clip-${i})`}>
            <use href={`#${id}-face`} />
          </g>
        </g>
      ))}
      {won && (
        <polygon
          points={PAPER_QUADS[index].map((p) => p.join(",")).join(" ")}
          fill="none"
          stroke="#d4a849"
          strokeWidth=".7"
        />
      )}
    </>
  );
}
