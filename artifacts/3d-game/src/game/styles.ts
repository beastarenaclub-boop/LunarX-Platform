// Keep base game CSS ahead of the shared mobile/viewport overrides. Game code
// loads on demand, but loading its CSS later would change the existing cascade
// (for example, shrinking roulette's 44px touch targets on phones).
import "../components/table/chips.css";
import "../components/table/round-win-dialog.css";
import "../components/lucky7/lucky7-scene.css";
import "../components/horse-racing/horse-racing.css";
import "../components/bike-racing/bike-racing.css";
import "../components/lunar/jetx-flight.css";
import "../components/lunar/jetx.css";
import "../components/lunar/jetx-fit.css";
import "../components/lunar/jetx-reference.css";
import "../components/lunar/fury.css";
import "../components/roulette/roulette-dealer.css";
import "../components/teenpattiLive/teen-patti-studio.css";
import "../components/teenpattiLive/teen-patti-result.css";
import "../components/table/live-bet-dock.css";
import "../components/teenpattiLive/teen-patti-mobile.css";
import "../components/vegetable/vegetable-bowl.css";
import "../components/rummy/rummy.css";
import "../components/rummy/rummy-studio.css";
import "../components/dragonTiger/dragon-tiger.css";
