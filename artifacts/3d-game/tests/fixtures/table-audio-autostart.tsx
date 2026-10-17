import { useState } from "react";
import { createRoot } from "react-dom/client";
import { useBaccaratAudio } from "../../src/components/baccarat/useBaccaratAudio";
import { useTeenPattiAudio } from "../../src/components/teenpattiLive/useTeenPattiAudio";
import { useTableMusic } from "../../src/components/lucky7live/useTableMusic";
import { useMatchCommentary } from "../../src/components/virtual-sports/MatchCommentary";
import { setAudioGame } from "../../src/game/audio";
import { updateSettings } from "../../src/game/engine";

const round = { roundId: "auto-1", phase: "betting", remainingMs: 25000, phaseDurationMs: 30000, config: { settleDurationMs: 6000 } } as any;
function Baccarat() {
  const a = useBaccaratAudio(round, null, 0, true);
  return <><audio data-testid="music" ref={a.element} src={a.musicUrl} loop />
    <output data-testid="voice">{a.line}</output><button onClick={a.toggleSound}>Sound</button></>;
}
function TeenPatti() {
  const a = useTeenPattiAudio();
  return <><audio data-testid="music" ref={a.element} src={a.musicUrl} loop />
    <audio data-testid="ambience" ref={a.ambienceElement} src={a.ambienceUrl} loop />
    <button onClick={a.toggleSound}>Sound</button></>;
}
function Live() {
  const [enabled,setEnabled] = useState(true);
  const ref = useTableMusic(enabled);
  return <><audio data-testid="music" ref={ref} src="/media/baccarat/audio/vip-lounge.mp3" loop /><button onClick={() => setEnabled(!enabled)}>Sound</button></>;
}
function Sports() {
  const [enabled,setEnabled] = useState(true);
  const a = useMatchCommentary({ id:"match-1", phase:"betting", fixture:{id:"brazil-argentina"}, events:[] } as any, { id:"football" } as any, enabled);
  return <><output data-testid="voice" data-playing={a.playing} data-blocked={a.blocked}>{a.caption}</output><button onClick={() => setEnabled(!enabled)}>Sound</button></>;
}
const kind = new URLSearchParams(location.search).get("kind");
if(kind === "baccarat" || kind === "teen-patti-live") setAudioGame(kind);
const root = createRoot(document.getElementById("root")!);
Object.assign(window, { stopTableAudio: () => root.unmount(), muteTable: () => updateSettings({sound:false}) });
root.render(kind === "baccarat" ? <Baccarat /> : kind === "teen-patti-live" ? <TeenPatti /> : kind === "sports" ? <Sports /> : <Live />);
