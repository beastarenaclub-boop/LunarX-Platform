/**
 * The round player badge, everywhere one is drawn.
 *
 * There were seven copies of this circle across five files — each one a span
 * with a gradient and an initial — so putting real faces in meant editing the
 * same markup seven times and missing one. It is one component now, and the
 * callers keep their own sizing classes because the badge is 20px in one panel
 * and 48px in another.
 *
 * The gradient and the initial are NOT replaced by the image, they sit behind
 * it. A face that is still loading, or a file that 404s, degrades to exactly
 * the badge this app drew before — never an empty circle.
 */
import { useState } from "react";
import { avatarGradient, avatarUrl } from "./avUtils";

export function PlayerAvatar({
  name,
  className,
  style,
  testId,
}: {
  name: string;
  /** The caller's own sizing, border and line-height classes. */
  className?: string;
  style?: React.CSSProperties;
  testId?: string;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <span
      className={`relative overflow-hidden ${className ?? ""}`}
      style={{ background: avatarGradient(name), ...style }}
      data-testid={testId}
    >
      {name[0]?.toUpperCase()}
      {!failed && (
        <img
          src={avatarUrl(name)}
          alt=""
          aria-hidden="true"
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className="absolute inset-0 h-full w-full object-cover"
          /* The app's CSS reset puts `max-width: 100%` on every img, which is
             harmless here, but the explicit box keeps this correct if the
             badge is ever placed in a zero-size anchor the way the roulette
             ring sprite was. */
          style={{ maxWidth: "none" }}
        />
      )}
    </span>
  );
}
