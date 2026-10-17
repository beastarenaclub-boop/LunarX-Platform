export interface Runner {
  id: number;
  name: string;
  jockey: string;
  color: string;
  coat: string;
  rating: number;
  form: string;
  style: string;
}
export const RUNNERS: Runner[] = [
  {
    id: 1,
    name: "Midnight Storm",
    jockey: "A. Laurent",
    color: "#6488f5",
    coat: "#383234",
    rating: 96,
    form: "1 · 2 · 1",
    style: "Strong finisher",
  },
  {
    id: 2,
    name: "Golden Eclipse",
    jockey: "R. Kapoor",
    color: "#e4b54f",
    coat: "#c68a4b",
    rating: 93,
    form: "2 · 1 · 3",
    style: "Front runner",
  },
  {
    id: 3,
    name: "Desert Falcon",
    jockey: "O. Khalid",
    color: "#ec715f",
    coat: "#775040",
    rating: 91,
    form: "3 · 2 · 1",
    style: "Fast starter",
  },
  {
    id: 4,
    name: "Silver Arrow",
    jockey: "S. Williams",
    color: "#a1b6c8",
    coat: "#bfc1ba",
    rating: 89,
    form: "1 · 4 · 2",
    style: "All-rounder",
  },
  {
    id: 5,
    name: "Emerald Prince",
    jockey: "J. Murphy",
    color: "#57b89a",
    coat: "#4b3128",
    rating: 87,
    form: "4 · 3 · 2",
    style: "Endurance expert",
  },
  {
    id: 6,
    name: "Crimson Spirit",
    jockey: "M. Tanaka",
    color: "#c574ac",
    coat: "#9a4f32",
    rating: 85,
    form: "2 · 5 · 3",
    style: "Late surge",
  },
  {
    id: 7,
    name: "Ocean Blue",
    jockey: "L. Santos",
    color: "#50b6c9",
    coat: "#dbd4be",
    rating: 83,
    form: "3 · 4 · 4",
    style: "Steady pacer",
  },
  {
    id: 8,
    name: "Wild Comet",
    jockey: "E. Rossi",
    color: "#a894dd",
    coat: "#644436",
    rating: 81,
    form: "5 · 2 · 4",
    style: "The outsider",
  },
];

export interface Venue {
  id: string;
  name: string;
  country: string;
  event: string;
  distance: number;
  laps: number;
  duration: number;
  surface: string;
  weather: string;
  temperature: number;
  theme: "royal" | "desert" | "alpine" | "coast" | "night" | "marathon";
  sky: string;
  grass: string;
  track: string;
  accent: string;
}
export const VENUES: Venue[] = [
  {
    id: "royal",
    name: "Royal Park",
    country: "ENGLAND",
    event: "The Royal Thoroughbred Cup",
    distance: 1600,
    laps: 1,
    duration: 38,
    surface: "Turf",
    weather: "Clear skies",
    temperature: 21,
    theme: "royal",
    sky: "#c5dbe3",
    grass: "#517346",
    track: "#a99873",
    accent: "#427d55",
  },
  {
    id: "dubai",
    name: "Dubai Sands",
    country: "UAE",
    event: "Desert Gold Championship",
    distance: 2000,
    laps: 1,
    duration: 44,
    surface: "Dirt",
    weather: "Golden hour",
    temperature: 29,
    theme: "desert",
    sky: "#ecd2b5",
    grass: "#8e935a",
    track: "#c6a276",
    accent: "#bd9258",
  },
  {
    id: "alpine",
    name: "Alpine Valley",
    country: "SWITZERLAND",
    event: "The Alpine Invitational",
    distance: 1800,
    laps: 1,
    duration: 42,
    surface: "Turf",
    weather: "Mountain air",
    temperature: 14,
    theme: "alpine",
    sky: "#bdcfdc",
    grass: "#496e54",
    track: "#a18d72",
    accent: "#6f8ea3",
  },
  {
    id: "coast",
    name: "Ocean Downs",
    country: "AUSTRALIA",
    event: "Pacific Coast Classic",
    distance: 1400,
    laps: 1,
    duration: 34,
    surface: "Sand",
    weather: "Sea breeze",
    temperature: 24,
    theme: "coast",
    sky: "#b4dce8",
    grass: "#65936e",
    track: "#ccb38c",
    accent: "#4c9daa",
  },
  {
    id: "night",
    name: "Neon Circuit",
    country: "JAPAN",
    event: "Tokyo Starlight Derby",
    distance: 2000,
    laps: 1,
    duration: 44,
    surface: "Dirt",
    weather: "Under the lights",
    temperature: 18,
    theme: "night",
    sky: "#151e39",
    grass: "#234b40",
    track: "#857f81",
    accent: "#867db8",
  },
  {
    id: "marathon",
    name: "Marathon Stadium",
    country: "FRANCE",
    event: "The Grand Endurance Trophy",
    distance: 3200,
    laps: 2,
    duration: 68,
    surface: "Turf",
    weather: "Afternoon sun",
    temperature: 22,
    theme: "marathon",
    sky: "#c4d9de",
    grass: "#5c7740",
    track: "#b09a78",
    accent: "#84904c",
  },
];
export const CAMERA_MODES = [
  "broadcast",
  "rail",
  "drone",
  "chase",
  "jockey",
  "finish",
] as const;
export type CameraMode = (typeof CAMERA_MODES)[number];
export type Phase = "betting" | "countdown" | "racing" | "finished";
export interface Ticket {
  horseId: number;
  stake: number;
  odds: number;
}
export interface RacePlan {
  startAt: number;
  times: number[];
  order: number[];
  phases: number[];
  venueId: string;
  id: string;
}
export interface RaceResult {
  id: string;
  venueId: string;
  winner: number;
  order: number[];
  payout: number;
  stake: number;
  tickets: Ticket[];
  times: number[];
  date: number;
}
export const venueById = (id: string) =>
  VENUES.find((v) => v.id === id) ?? VENUES[0];
export function oddsFor(id: number) {
  const weights = RUNNERS.map((r) => Math.exp((r.rating - 81) / 13));
  return (
    Math.round(
      (weights.reduce((a, b) => a + b, 0) / weights[id - 1]) * 0.94 * 100,
    ) / 100
  );
}
export function makePlan(
  venue: Venue,
  random = Math.random,
  now = Date.now(),
): RacePlan {
  // Weighted random ranking. Bets never influence the draw; quoted win odds use these weights.
  const order = RUNNERS.map((r) => ({
    id: r.id,
    draw: -Math.log(Math.max(1e-9, random())) / Math.exp((r.rating - 81) / 13),
  }))
    .sort((a, b) => a.draw - b.draw)
    .map((r) => r.id);
  const times = RUNNERS.map(
    (r) => venue.duration + order.indexOf(r.id) * 0.47 + random() * 0.25,
  );
  return {
    startAt: now + 3000,
    times,
    order,
    phases: RUNNERS.map(() => random() * Math.PI * 2),
    venueId: venue.id,
    id: `TC-${now.toString(36).toUpperCase()}`,
  };
}
export function progressAt(plan: RacePlan, id: number, elapsed: number) {
  const t = Math.max(0, elapsed) / plan.times[id - 1];
  if (t >= 1) return 1 + Math.min((t - 1) * 0.4, 0.075);
  // Smooth, monotonic race progress with changing positions; all cross at their exact finish time.
  return Math.max(
    0,
    t +
      Math.sin(t * Math.PI * 4 + plan.phases[id - 1]) *
        Math.sin(t * Math.PI) *
        0.018,
  );
}
export function standingsAt(plan: RacePlan, elapsed: number) {
  return RUNNERS.map((r) => r.id).sort((a, b) => {
    if (elapsed >= plan.times[a - 1] && elapsed >= plan.times[b - 1])
      return plan.times[a - 1] - plan.times[b - 1];
    return progressAt(plan, b, elapsed) - progressAt(plan, a, elapsed);
  });
}
export function settle(
  plan: RacePlan,
  tickets: Ticket[],
  now = Date.now(),
): RaceResult {
  const winner = plan.order[0];
  return {
    id: plan.id,
    venueId: plan.venueId,
    winner,
    order: plan.order,
    times: plan.times,
    stake: tickets.reduce((sum, t) => sum + t.stake, 0),
    payout: tickets
      .filter((t) => t.horseId === winner)
      .reduce((sum, t) => sum + Math.round(t.stake * t.odds), 0),
    tickets: tickets.map((t) => ({ ...t })),
    date: now,
  };
}

// Stadium with two straights and two semicircular bends. Local horses face +Z.
export function trackPoint(progress: number, lane: number) {
  const radius = 35 + lane * 2.15,
    straight = 140,
    circumference = straight * 2 + Math.PI * 2 * radius;
  let s =
    ((((progress % 1) + 1) % 1) * circumference + straight / 2) % circumference;
  if (s < straight) return { x: -70 + s, z: -radius, heading: Math.PI / 2 };
  s -= straight;
  if (s < Math.PI * radius) {
    const a = -Math.PI / 2 + s / radius;
    return {
      x: 70 + Math.cos(a) * radius,
      z: Math.sin(a) * radius,
      heading: -a,
    };
  }
  s -= Math.PI * radius;
  if (s < straight) return { x: 70 - s, z: radius, heading: -Math.PI / 2 };
  s -= straight;
  const a = Math.PI / 2 + s / radius;
  return {
    x: -70 + Math.cos(a) * radius,
    z: Math.sin(a) * radius,
    heading: -a,
  };
}
