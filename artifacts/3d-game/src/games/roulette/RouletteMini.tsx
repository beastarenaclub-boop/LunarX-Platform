import { RouletteScreen } from "./RouletteScreen";
import { MINI } from "./wheelSpec";

/**
 * The same wheel with `numberCount` halved: 20 pockets, still BOTH zeros,
 * numbers 1-18.
 *
 * The same component, handed a different wheel. There is no mini screen and
 * there must not be one — every difference is inside `MINI`.
 */
export default function RouletteMini({ embedded }: { embedded?: boolean } = {}) {
  return <RouletteScreen wheel={MINI} embedded={embedded} />;
}
