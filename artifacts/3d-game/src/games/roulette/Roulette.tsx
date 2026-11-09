import { RouletteScreen } from "./RouletteScreen";
import { CLASSIC } from "./wheelSpec";

/** The American wheel: 38 pockets, 0 and 00, numbers 1-36. */
export default function Roulette({ embedded }: { embedded?: boolean } = {}) {
  return <RouletteScreen wheel={CLASSIC} embedded={embedded} />;
}
