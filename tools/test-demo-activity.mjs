import { test } from "node:test";
import assert from "node:assert/strict";
import {
  demoActivitySnapshot,
  resolveDemoActivityGame,
  DEMO_ACTIVITY_LIMIT,
} from "../artifacts/3d-game/src/components/game/demoActivityModel.ts";

test("one shared pool never exceeds 100 across games, including rotation boundaries", () => {
  for (const size of [1, 42, 75, 100, 137]) {
    const games = Array.from({ length: size }, (_, i) => `game-${i}`);
    for (const now of [0, 119999, 120000, 1794288000000]) {
      const snapshot = demoActivitySnapshot(games, now);
      assert.equal(snapshot.total, DEMO_ACTIVITY_LIMIT);
      assert.equal(
        Object.values(snapshot.byGame).reduce(
          (n, players) => n + players.length,
          0,
        ),
        100,
      );
      assert.equal(new Set(snapshot.players.map((p) => p.id)).size, 100);
      if (size <= 100)
        assert.ok(games.every((game) => snapshot.byGame[game].length >= 1));
    }
  }
});

test("tabs and route order share the same profiles; demo states change without financial data", () => {
  const games = ["ice-fish", "lunar", "roulette"],
    now = 1794288000000;
  const a = demoActivitySnapshot(games, now),
    b = demoActivitySnapshot([...games].reverse(), now);
  assert.deepEqual(a, b);
  const later = demoActivitySnapshot(games, now + 6000);
  assert.deepEqual(
    a.players.map((p) => [p.id, p.game]),
    later.players.map((p) => [p.id, p.game]),
  );
  assert.notEqual(a.players[0].state, later.players[0].state);
  assert.ok(a.players.every((p) => /^DEMO \d{3}$/.test(p.id)));
  assert.ok(
    a.players.every((p) => Object.keys(p).sort().join() === "game,id,state"),
  );
});

test("empty and repeated catalog entries cannot create extra practice profiles", () => {
  assert.equal(demoActivitySnapshot([], 0).total, 0);
  assert.deepEqual(
    demoActivitySnapshot(["ice-fish", "ice-fish"], 0),
    demoActivitySnapshot(["ice-fish"], 0),
  );
});

test("direct routes, Colour aliases and partner launchers resolve to existing pool games", () => {
  const catalog = [
    { id: "wingo", route: "/lunar-colour-trading" },
    { id: "forex-trading", route: "/forex-trading" },
    { id: "wild-trails", route: "/horse-racing", registryCode: "horse-racing" },
    { id: "lunar", route: "/aviator-pro" },
  ];
  for (const entry of catalog)
    assert.equal(resolveDemoActivityGame(catalog, entry.route), entry.id);
  assert.equal(resolveDemoActivityGame(catalog, "/wingo"), "wingo");
  assert.equal(
    resolveDemoActivityGame(catalog, "/launcher", undefined, "horse-racing"),
    "wild-trails",
  );
  assert.equal(
    resolveDemoActivityGame(catalog, "/launcher", undefined, "aviator"),
    "lunar",
  );
  assert.equal(resolveDemoActivityGame(catalog, "/login"), null);
});
