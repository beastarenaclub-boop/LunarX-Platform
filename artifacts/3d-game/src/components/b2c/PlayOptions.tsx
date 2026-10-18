import { Gamepad2, UsersRound } from "lucide-react";
import { useSiteChannel } from "@/lib/siteChannel";
import { useMasterWebsite } from "@/lib/masterWebsite";
import { CRYPTO777_PLAY_URLS } from "./config";

export function PlayOptions() {
  const site = useSiteChannel();
  const master = useMasterWebsite();
  // A branch's own website keeps its existing navigation and account scope.
  if (master) return null;
  return (
    <nav className="b2c-play-options" aria-label="Play options">
      <div className="b2c-play-switch">
        <a href={CRYPTO777_PLAY_URLS.normal} aria-current={site.data?.channel === "b2c" ? "page" : undefined}>
          <Gamepad2 size={16} /> Normal Play
        </a>
        <a href={CRYPTO777_PLAY_URLS.agent} aria-current={site.data?.channel === "b2b" ? "page" : undefined}>
          <UsersRound size={16} /> Agent Play
        </a>
      </div>
      <a className="b2c-panel-link" href={CRYPTO777_PLAY_URLS.panel}>Agent panel</a>
    </nav>
  );
}
