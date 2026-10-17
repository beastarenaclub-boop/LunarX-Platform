import {
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Canvas, useFrame, useLoader, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { tableAssetManifest, tableAssetUrls } from "@/assets/models/teenpatti";
import {
  buildDealPlan,
  cardPose,
  planDealMs,
  type DealPlan,
} from "./dealPlan";
import type { DealAudio } from "./tableDealAudio";
import {
  CHIP_DENOMINATIONS,
  TEEN_PATTI_SPOTS,
  chipStack,
  type SpotAmounts,
  type TeenPattiDeal,
  type TeenPattiSpot,
} from "./types";

/**
 * The 3D live Teen Patti table.
 *
 * This module is the ONLY place three.js is imported in the Teen Patti Live
 * feature, and `TeenPattiTable` pulls it in as its own lazy chunk — the lobby
 * and every other game keep their current bundle. Frames are written straight
 * onto the meshes; React never re-renders during a deal.
 */

/* ── Geometry constants of the asset pack ─────────────────────────────── */
const CARD_THICKNESS = 0.00036;
const CHIP_THICKNESS = 0.0033;
const CHIP_HALF = CHIP_THICKNESS / 2;
const DEFAULT_HAND_SPREAD = 0.075;
const ATLAS_COLS = tableAssetManifest.card.atlas.cols;
const ATLAS_ROWS = tableAssetManifest.card.atlas.rows;

const FALLBACK_ANCHORS: Record<string, [number, number, number]> = {
  Anchor_chips_pairPlusA: [-0.44, 0.783, 0.3],
  Anchor_chips_playerA: [-0.34, 0.783, 0.06],
  Anchor_chips_tie: [0, 0.783, 0.06],
  Anchor_chips_playerB: [0.34, 0.783, 0.06],
  Anchor_chips_pairPlusB: [0.44, 0.783, 0.3],
  Anchor_handA: [-0.34, 0.782, -0.17],
  Anchor_handB: [0.34, 0.782, -0.17],
  Anchor_shoe: [0.64, 0.78, -0.33],
  Anchor_dealer: [0, 0, -0.98],
};

/**
 * UV offset of one card in the shared atlas.
 *
 * The atlas texture arrives through the glTF with `flipY = false`, so V grows
 * downwards from the top of the image — row 0 (spades) is at the top and the
 * card back sits on the bottom row. That is the convention the model's own
 * `KHR_texture_transform` was authored in, which is why this does not use the
 * asset pack's `cardAtlasCell` helper (that one assumes an uploaded-flipped
 * texture, i.e. a separately loaded atlas).
 */
function setCardFace(material: THREE.MeshStandardMaterial, card: number) {
  const map = material.map;
  if (!map) return;
  const rank = ((card % 13) + 13) % 13;
  const suit = Math.floor(card / 13) % ATLAS_ROWS;
  map.repeat.set(1 / ATLAS_COLS, 1 / ATLAS_ROWS);
  map.offset.set(rank / ATLAS_COLS, suit / ATLAS_ROWS);
}

interface CardRig {
  group: THREE.Object3D;
  front: THREE.MeshStandardMaterial | null;
}

interface Rig {
  root: THREE.Group;
  cards: CardRig[];
  chipProtos: Map<number, THREE.Object3D>;
  chipAnchors: Map<TeenPattiSpot, THREE.Vector3>;
  spotMaterials: Map<TeenPattiSpot, THREE.MeshStandardMaterial>;
  handAnchors: Record<"A" | "B", THREE.Vector3>;
  handSpread: number;
  shoeExit: THREE.Vector3;
  mixer: THREE.AnimationMixer | null;
  actions: {
    idle: THREE.AnimationAction | null;
    deal: THREE.AnimationAction | null;
    reveal: THREE.AnimationAction | null;
  };
  dispose: () => void;
}

function buildRig(gltfs: GLTF[]): Rig {
  const [tableG, cardsG, chipsG, shoeG, dealerG] = gltfs;
  const root = new THREE.Group();
  const owned: { dispose: () => void }[] = [];

  /* Table ------------------------------------------------------------- */
  const table = tableG.scene.clone(true);
  table.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) mesh.receiveShadow = true;
  });
  root.add(table);
  table.updateMatrixWorld(true);

  const anchorOf = (name: string): THREE.Vector3 => {
    const found = table.getObjectByName(name);
    if (found) return found.getWorldPosition(new THREE.Vector3());
    return new THREE.Vector3(...(FALLBACK_ANCHORS[name] ?? [0, 0, 0]));
  };

  const chipAnchors = new Map<TeenPattiSpot, THREE.Vector3>();
  for (const spot of TEEN_PATTI_SPOTS) {
    chipAnchors.set(spot, anchorOf(`Anchor_chips_${spot}`));
  }

  // Own the betting-spot materials so the winning-spot glow can never leak
  // into the loader's cached copy of the table.
  const spotMaterials = new Map<TeenPattiSpot, THREE.MeshStandardMaterial>();
  for (const spot of TEEN_PATTI_SPOTS) {
    const mesh = table.getObjectByName(`Spot_${spot}`) as THREE.Mesh | null;
    const base = mesh?.material;
    if (!mesh || !base || Array.isArray(base)) continue;
    const mat = (base as THREE.MeshStandardMaterial).clone();
    mesh.material = mat;
    spotMaterials.set(spot, mat);
    owned.push(mat);
  }

  const handAnchors = {
    A: anchorOf("Anchor_handA"),
    B: anchorOf("Anchor_handB"),
  };
  const spreadRaw = Number(
    (table.getObjectByName("Anchor_handA")?.userData as { spread?: unknown })
      ?.spread,
  );
  const handSpread = Number.isFinite(spreadRaw) && spreadRaw > 0
    ? spreadRaw
    : DEFAULT_HAND_SPREAD;

  /* Shoe -------------------------------------------------------------- */
  const shoe = shoeG.scene.clone(true);
  shoe.position.copy(anchorOf("Anchor_shoe"));
  shoe.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) mesh.castShadow = true;
  });
  root.add(shoe);
  shoe.updateMatrixWorld(true);
  const exit = shoe.getObjectByName("Anchor_shoeExit");
  const shoeExit = exit
    ? exit.getWorldPosition(new THREE.Vector3())
    : shoe.position.clone().add(new THREE.Vector3(0.16, 0.0456, 0));

  /* Dealer ------------------------------------------------------------ */
  // Skinned meshes need SkeletonUtils: a plain clone keeps pointing at the
  // original skeleton and the dealer would animate the cached rig instead.
  const dealer = cloneSkinned(dealerG.scene) as THREE.Object3D;
  dealer.position.copy(anchorOf("Anchor_dealer"));
  dealer.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    // A skinned bind pose is a poor bounding box; without this the dealer
    // pops out of view when she reaches across the table.
    mesh.frustumCulled = false;
  });
  root.add(dealer);

  const mixer = dealerG.animations.length
    ? new THREE.AnimationMixer(dealer)
    : null;
  const clipAction = (name: string): THREE.AnimationAction | null => {
    const clip = dealerG.animations.find((c) => c.name === name);
    return clip && mixer ? mixer.clipAction(clip) : null;
  };
  const actions = {
    idle: clipAction("Idle"),
    deal: clipAction("Deal"),
    reveal: clipAction("Reveal"),
  };
  if (actions.idle) {
    actions.idle.setLoop(THREE.LoopRepeat, Infinity);
    actions.idle.play();
  }
  for (const a of [actions.deal, actions.reveal]) {
    if (!a) continue;
    a.setLoop(THREE.LoopOnce, 1);
    a.clampWhenFinished = true;
  }

  /* Cards ------------------------------------------------------------- */
  const proto =
    cardsG.scene.getObjectByName("Card") ?? cardsG.scene.children[0] ?? null;
  const cards: CardRig[] = [];
  for (let i = 0; i < 6; i++) {
    const group = proto ? proto.clone(true) : new THREE.Group();
    let front: THREE.MeshStandardMaterial | null = null;
    group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      const mat = mesh.material;
      if (Array.isArray(mat) || !mat) return;
      if (mat.name !== "CardFront") return;
      const cloned = (mat as THREE.MeshStandardMaterial).clone();
      if (cloned.map) {
        // Cloned textures share their source, so this costs no extra upload.
        cloned.map = cloned.map.clone();
        owned.push(cloned.map);
      }
      mesh.material = cloned;
      front = cloned;
      owned.push(cloned);
    });
    group.visible = false;
    root.add(group);
    cards.push({ group, front });
  }

  /* Chips ------------------------------------------------------------- */
  const chipProtos = new Map<number, THREE.Object3D>();
  for (const value of CHIP_DENOMINATIONS) {
    const found = chipsG.scene.getObjectByName(`Chip_${value}`);
    if (found) chipProtos.set(value, found);
  }

  return {
    root,
    cards,
    chipProtos,
    chipAnchors,
    spotMaterials,
    handAnchors,
    handSpread,
    shoeExit,
    mixer,
    actions,
    dispose: () => {
      mixer?.stopAllAction();
      if (mixer) mixer.uncacheRoot(dealer);
      // Only our own clones — the loader's cached geometries and materials
      // are shared with any future mount of this scene.
      for (const o of owned) o.dispose();
    },
  };
}

/* ── Chips on the felt ────────────────────────────────────────────────── */

interface Stack {
  group: THREE.Group;
  denoms: number[];
  meshes: THREE.Object3D[];
  restY: number[];
  from: number;
  since: number;
}

const CHIP_DROP_MS = 260;
const CHIP_DROP_STEP_MS = 45;

function ChipStacks({ rig, chips }: { rig: Rig; chips: SpotAmounts }) {
  const stacksRef = useRef(new Map<TeenPattiSpot, Stack>());
  const holderRef = useRef<THREE.Group | null>(null);
  if (!holderRef.current) {
    holderRef.current = new THREE.Group();
    rig.root.add(holderRef.current);
  }

  useEffect(() => {
    const holder = holderRef.current!;
    return () => {
      holder.removeFromParent();
      stacksRef.current.clear();
    };
  }, []);

  useEffect(() => {
    const holder = holderRef.current!;
    const stacks = stacksRef.current;
    for (const spot of TEEN_PATTI_SPOTS) {
      const amount = chips[spot] ?? 0;
      const denoms = chipStack(amount);
      const current = stacks.get(spot);
      const same =
        current &&
        current.denoms.length === denoms.length &&
        current.denoms.every((d, i) => d === denoms[i]);
      if (same) continue;

      // How much of the stack survives — anything above it is a fresh chip
      // and drops onto the felt.
      let from = 0;
      if (current) {
        while (
          from < denoms.length &&
          from < current.denoms.length &&
          current.denoms[from] === denoms[from]
        )
          from++;
      }

      current?.group.removeFromParent();
      const anchor =
        rig.chipAnchors.get(spot) ?? new THREE.Vector3(0, 0.783, 0);
      const group = new THREE.Group();
      const meshes: THREE.Object3D[] = [];
      const restY: number[] = [];
      denoms.forEach((value, i) => {
        const proto = rig.chipProtos.get(value) ?? rig.chipProtos.get(100);
        if (!proto) return;
        const chip = proto.clone(true);
        const y = anchor.y + CHIP_HALF + i * CHIP_THICKNESS;
        // A hand-pushed stack is never perfectly aligned.
        chip.position.set(
          anchor.x + Math.sin(i * 2.399) * 0.0016,
          y,
          anchor.z + Math.cos(i * 2.399) * 0.0016,
        );
        chip.rotation.y = i * 1.17;
        group.add(chip);
        meshes.push(chip);
        restY.push(y);
      });
      holder.add(group);
      stacks.set(spot, {
        group,
        denoms,
        meshes,
        restY,
        from,
        since: performance.now(),
      });
    }
  }, [rig, chips]);

  useFrame(() => {
    const now = performance.now();
    for (const stack of stacksRef.current.values()) {
      if (stack.from >= stack.meshes.length) continue;
      let settled = true;
      for (let i = stack.from; i < stack.meshes.length; i++) {
        const k = Math.min(
          1,
          Math.max(
            0,
            (now - stack.since - (i - stack.from) * CHIP_DROP_STEP_MS) /
              CHIP_DROP_MS,
          ),
        );
        if (k < 1) settled = false;
        const eased = 1 - (1 - k) ** 3;
        stack.meshes[i].position.y = stack.restY[i] + (1 - eased) * 0.1;
        stack.meshes[i].visible = k > 0;
      }
      if (settled) stack.from = stack.meshes.length;
    }
  });

  return null;
}

/* ── The deal ─────────────────────────────────────────────────────────── */

interface DealProps {
  rig: Rig;
  deal: TeenPattiDeal | null;
  roundKey: string;
  revealEndsAt: number | null;
  audio?: DealAudio;
  onSettled?: (roundId: string) => void;
}

function Deal({ rig, deal, roundKey, revealEndsAt, audio, onSettled }: DealProps) {
  const invalidate = useThree((s) => s.invalidate);
  const planRef = useRef<DealPlan | null>(null);
  const startRef = useRef(0);
  const cueRef = useRef(0);
  const doneRef = useRef<string | null>(null);
  const resumedAtRef = useRef(0);
  const gestureRef = useRef({ deal: false, reveal: false });
  const targets = useRef<THREE.Vector3[]>([]);
  const scratch = useRef(new THREE.Vector3());
  const audioRef = useRef(audio);
  audioRef.current = audio;
  const settledRef = useRef(onSettled);
  settledRef.current = onSettled;

  // Anchor the choreography to the round's reveal deadline at the moment the
  // scene is actually on screen. A late chunk load, a late join or an operator
  // who shortened the reveal window all shorten (or skip) the deal instead of
  // leaving cards in the air when the round settles.
  useLayoutEffect(() => {
    const cards = rig.cards;
    if (!deal || !roundKey) {
      planRef.current = null;
      for (const c of cards) c.group.visible = false;
      invalidate();
      return;
    }
    const remaining = revealEndsAt != null ? revealEndsAt - Date.now() : 0;
    const durationMs = planDealMs(remaining);
    const plan = buildDealPlan(roundKey, durationMs);
    planRef.current = plan;
    startRef.current = performance.now();
    cueRef.current = durationMs <= 0 ? plan.cues.length : 0;
    gestureRef.current = { deal: false, reveal: false };

    targets.current = plan.cards.map((c) => {
      const anchor = rig.handAnchors[c.hand];
      return new THREE.Vector3(
        anchor.x + (c.slot - 1) * rig.handSpread + c.skew,
        anchor.y + CARD_THICKNESS * (c.order + 1),
        anchor.z,
      );
    });

    plan.cards.forEach((c, i) => {
      const rigCard = cards[i];
      if (!rigCard) return;
      const values = c.hand === "A" ? deal.handACards : deal.handBCards;
      const value = values?.[c.slot];
      if (rigCard.front && typeof value === "number") {
        setCardFace(rigCard.front, value);
      }
      applyPose(rigCard, c, plan, targets.current[i], rig.shoeExit, scratch.current, durationMs <= 0 ? 1 : 0);
    });

    if (durationMs > 0) {
      audioRef.current?.onDealStart?.();
    } else if (doneRef.current !== roundKey) {
      doneRef.current = roundKey;
      settledRef.current?.(roundKey);
    }
    invalidate();
  }, [rig, deal, roundKey, revealEndsAt, invalidate]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        resumedAtRef.current = performance.now();
        invalidate();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [invalidate]);

  useFrame((_, delta) => {
    // A hidden tab can hand back a huge delta; the mixer must not jump.
    rig.mixer?.update(Math.min(delta, 0.05));

    const plan = planRef.current;
    if (!plan || plan.durationMs <= 0 || !deal) return;
    const now = performance.now();
    const t = Math.min(1, (now - startRef.current) / plan.durationMs);

    plan.cards.forEach((c, i) => {
      const rigCard = rig.cards[i];
      const target = targets.current[i];
      if (!rigCard || !target) return;
      applyPose(rigCard, c, plan, target, rig.shoeExit, scratch.current, t);
    });

    // Dealer gestures, driven by the same curve as the cards.
    if (!gestureRef.current.deal && t >= plan.dealGesture.start) {
      gestureRef.current.deal = true;
      playGesture(
        rig.actions.deal,
        rig.actions.idle,
        (plan.dealGesture.end - plan.dealGesture.start) * plan.durationMs,
      );
    }
    if (!gestureRef.current.reveal && t >= plan.revealGesture.start) {
      gestureRef.current.reveal = true;
      playGesture(
        rig.actions.reveal,
        rig.actions.idle,
        (plan.revealGesture.end - plan.revealGesture.start) * plan.durationMs,
      );
    }

    // Cues ride the animation. Anything that "happened" while the tab was
    // hidden or the main thread stalled is dropped instead of fired in a burst.
    const fresh = now - resumedAtRef.current > 250;
    while (cueRef.current < plan.cues.length && t >= plan.cues[cueRef.current].t) {
      const cue = plan.cues[cueRef.current++];
      const lateBy = (t - cue.t) * plan.durationMs;
      if (!fresh || lateBy > 180) continue;
      if (cue.kind === "deal") audioRef.current?.onCardLand?.(cueRef.current - 1);
      else audioRef.current?.onCardFlip?.();
    }

    if (t >= 1 && doneRef.current !== roundKey) {
      doneRef.current = roundKey;
      if (fresh) audioRef.current?.onReveal?.();
      settledRef.current?.(roundKey);
      if (rig.actions.idle) fadeToIdle(rig.actions.idle, rig.actions.reveal);
    }
  });

  return null;
}

function applyPose(
  card: CardRig,
  plan: DealPlan["cards"][number],
  _full: DealPlan,
  target: THREE.Vector3,
  shoeExit: THREE.Vector3,
  scratch: THREE.Vector3,
  t: number,
) {
  const pose = cardPose(plan, t);
  card.group.visible = pose.dealt;
  if (!pose.dealt) return;
  scratch.lerpVectors(shoeExit, target, pose.travel);
  card.group.position.set(scratch.x, scratch.y + pose.lift, scratch.z);
  // rotation.x = π is face-down; the card turns over its short edge, the way
  // a dealer flips it toward the players.
  card.group.rotation.set(
    Math.PI * (1 - pose.faceUp) + (1 - pose.travel) * 0.22,
    pose.yaw,
    0,
  );
}

function playGesture(
  action: THREE.AnimationAction | null,
  idle: THREE.AnimationAction | null,
  windowMs: number,
) {
  if (!action) return;
  const clipSeconds = action.getClip().duration;
  const windowSeconds = Math.max(0.35, windowMs / 1000);
  action.reset();
  action.timeScale = Math.min(2.5, Math.max(0.4, clipSeconds / windowSeconds));
  action.setEffectiveWeight(1);
  if (idle) idle.crossFadeTo(action, 0.25, false);
  action.play();
}

function fadeToIdle(
  idle: THREE.AnimationAction,
  from: THREE.AnimationAction | null,
) {
  idle.reset();
  idle.setEffectiveWeight(1);
  idle.play();
  if (from) from.crossFadeTo(idle, 0.4, false);
}

/* ── Winning spot ─────────────────────────────────────────────────────── */

function SpotGlow({
  rig,
  spot,
}: {
  rig: Rig;
  spot: TeenPattiSpot | null;
}) {
  const baseRef = useRef(new Map<TeenPattiSpot, number>());
  useEffect(() => {
    for (const [key, mat] of rig.spotMaterials) {
      if (!baseRef.current.has(key)) {
        baseRef.current.set(key, mat.emissiveIntensity ?? 0);
      }
    }
    return () => {
      for (const [key, mat] of rig.spotMaterials) {
        mat.emissiveIntensity = baseRef.current.get(key) ?? 0;
      }
    };
  }, [rig]);

  useFrame(() => {
    const pulse = 0.45 + 0.3 * Math.sin(performance.now() * 0.005);
    for (const [key, mat] of rig.spotMaterials) {
      if (key === spot) {
        mat.emissive.setHex(0xf5c451);
        mat.emissiveIntensity = pulse;
      } else {
        mat.emissiveIntensity = baseRef.current.get(key) ?? 0;
      }
    }
  });
  return null;
}

/* ── Scene ────────────────────────────────────────────────────────────── */

interface SceneProps {
  deal: TeenPattiDeal | null;
  roundKey: string;
  revealEndsAt: number | null;
  chips: SpotAmounts;
  /** Winning spot to light up — null until the cards are actually face up. */
  winningSpot: TeenPattiSpot | null;
  audio?: DealAudio;
  onSettled?: (roundId: string) => void;
  onContextLost?: () => void;
  onReady?: () => void;
}

function LiveTable(props: SceneProps) {
  const gltfs = useLoader(GLTFLoader, [
    tableAssetUrls.table,
    tableAssetUrls.cards,
    tableAssetUrls.chips,
    tableAssetUrls.shoe,
    tableAssetUrls.dealer,
  ]) as unknown as GLTF[];

  const rig = useMemo(() => buildRig(gltfs), [gltfs]);
  useEffect(() => () => rig.dispose(), [rig]);
  useEffect(() => {
    props.onReady?.();
  }, [rig, props.onReady]);

  return (
    <>
      <primitive object={rig.root} />
      <ChipStacks rig={rig} chips={props.chips} />
      <Deal
        rig={rig}
        deal={props.deal}
        roundKey={props.roundKey}
        revealEndsAt={props.revealEndsAt}
        audio={props.audio}
        onSettled={props.onSettled}
      />
      <SpotGlow rig={rig} spot={props.winningSpot} />
    </>
  );
}

/** Keeps the five felt spots and the dealer framed on any viewport shape. */
function CameraRig() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const width = useThree((s) => s.size.width);
  const height = useThree((s) => s.size.height);
  useLayoutEffect(() => {
    const aspect = width / Math.max(1, height);
    camera.fov = aspect < 1.15 ? 58 : aspect < 1.5 ? 51 : 45;
    camera.position.set(0, 1.62, aspect < 1.15 ? 1.72 : 1.55);
    camera.lookAt(0, 0.9, -0.45);
    camera.updateProjectionMatrix();
  }, [camera, width, height]);
  return null;
}

export default function TeenPattiScene(props: SceneProps) {
  // Rendering stops entirely while the tab is hidden; the closed-form
  // choreography means the first frame back is already in the right place.
  const [frameloop, setFrameloop] = useState<"always" | "never">(() =>
    typeof document !== "undefined" && document.visibilityState === "hidden"
      ? "never"
      : "always",
  );
  useEffect(() => {
    const onVisible = () =>
      setFrameloop(document.visibilityState === "hidden" ? "never" : "always");
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  return (
    <Canvas
      frameloop={frameloop}
      shadows
      dpr={[1, 1.75]}
      camera={{ position: [0, 1.62, 1.55], fov: 45, near: 0.05, far: 24 }}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      onCreated={({ gl, camera }) => {
        camera.lookAt(0, 0.9, -0.45);
        gl.domElement.addEventListener("webglcontextlost", (e) => {
          e.preventDefault();
          props.onContextLost?.();
        });
      }}
      data-testid="teen-patti-canvas"
    >
      <color attach="background" args={["#0a0710"]} />
      <fogExp2 attach="fog" args={["#0a0710", 0.24]} />

      {/* Lighting matched to the rest of the casino: warm key over the felt,
          cool bounce from the room, a gold rim along the rail. */}
      <ambientLight intensity={0.55} color="#e8ddf5" />
      <hemisphereLight args={["#cbd5f5", "#100a18", 0.5]} />
      <directionalLight
        castShadow
        position={[0.9, 2.6, 1.4]}
        intensity={2.1}
        color="#fff3dc"
        shadow-mapSize={[1024, 1024]}
        shadow-camera-near={0.5}
        shadow-camera-far={7}
        shadow-camera-left={-1.6}
        shadow-camera-right={1.6}
        shadow-camera-top={1.6}
        shadow-camera-bottom={-1.6}
        shadow-bias={-0.0008}
      />
      <pointLight
        position={[0, 1.72, -0.15]}
        intensity={2.6}
        color="#ffd9a0"
        distance={4.5}
        decay={2}
      />
      <pointLight
        position={[-1.5, 1.3, -1.2]}
        intensity={2.2}
        color="#7c3aed"
        distance={5}
        decay={2}
      />

      {/* Floor, so the dealer is standing in a room and not in the void. */}
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <circleGeometry args={[4, 48]} />
        <meshStandardMaterial color="#1a1020" roughness={0.95} metalness={0} />
      </mesh>

      <CameraRig />
      <Suspense fallback={null}>
        <LiveTable {...props} />
      </Suspense>
    </Canvas>
  );
}
