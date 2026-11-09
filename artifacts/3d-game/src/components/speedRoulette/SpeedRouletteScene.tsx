import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { EUROPEAN_WHEEL_ORDER, type PlacedBet } from "../roulette/wheelData";
import { coveredNumbers, spotCenter, type Spot, type BetPreview } from "./layout";
import { PHOTO, SPINDLE_OUTLINE, photoBoardPoint, photoBoardSpot, photoTrackSelection, photoPolygon } from "./photographicTable";
import { createWheelRotor } from "./wheelVisual";
import { WHEEL, WheelMotion } from "./wheelMotion";
import { createWoodenResultMarker } from "./WoodenResultMarker";
import { createTableSelections } from "./TableSelections";

interface Props {
  roundId: string | null; phase: string | null; pocket: number | null; landingDeadline: number;
  bets: PlacedBet[]; result: number | null; disabled: boolean; neighbours: number;
  onPlace: (spots: Spot[]) => void; onLanded: (pocket: number, roundId: string) => void;
  onPreview: (preview: BetPreview | null) => void;
}
const TAU = Math.PI * 2;
const plateUrl = `${import.meta.env.BASE_URL}media/speed-auto-roulette/table-photoreal-v2.png`;

export default function SpeedRouletteScene(props: Props) {
  const host = useRef<HTMLDivElement>(null), latest = useRef(props), updateMarks = useRef<() => void>(() => {});
  latest.current = props;
  const [failed, setFailed] = useState(false);
  useEffect(() => { updateMarks.current(); }, [props.bets, props.result, props.disabled, props.neighbours, props.roundId]);
  useEffect(() => {
    const root = host.current!;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" }); } catch { setFailed(true); return; }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = .9; root.appendChild(renderer.domElement);
    const scene = new THREE.Scene(), camera = new THREE.OrthographicCamera(0, PHOTO.width, 0, PHOTO.height, .1, 2000); camera.position.z = 1000;
    const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
    const ownGeometry = <T extends THREE.BufferGeometry>(g: T) => { geometries.add(g); return g; };
    const ownMaterial = <T extends THREE.Material>(m: T) => { materials.add(m); return m; };
    const ownTexture = <T extends THREE.Texture>(t: T) => { textures.add(t); return t; };
    const basic = (options: THREE.MeshBasicMaterialParameters) => ownMaterial(new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, toneMapped: false, ...options }));
    let disposed = false, loaded = false, hoverPoint: [number, number] | null = null, hoverSignature = "", previewSignature = "";
    const selection = createTableSelections(); scene.add(selection.group);
    const winningMarker = createWoodenResultMarker(); scene.add(winningMarker.group);
    const hoveredSelection = () => {
      if (!hoverPoint || latest.current.disabled) return { spot: null, track: null };
      const [x, y] = hoverPoint, spot = photoBoardSpot(x, y);
      return { spot, track: spot ? null : photoTrackSelection(x, y, latest.current.neighbours) };
    };
    updateMarks.current = () => {
      const p = latest.current;
      const hover = hoveredSelection(); hoverSignature = JSON.stringify(hover);
      const nextPreview = JSON.stringify(hover.track);
      if (nextPreview !== previewSignature) { previewSignature = nextPreview; p.onPreview?.(hover.track); }
      const selectedNumbers = coveredNumbers(p.bets), previewNumbers = coveredNumbers(hover.track?.spots ?? (hover.spot ? [hover.spot] : []));
      root.dataset.selectedNumbers = JSON.stringify(selectedNumbers); root.dataset.previewNumbers = JSON.stringify(previewNumbers);
      selection.sync(p.bets, hover.track?.spots ?? (hover.spot ? [hover.spot] : []), p.result, p.roundId, p.disabled);
      const winningPoint = p.result !== null ? photoBoardPoint(...spotCenter({ type: "straight", numbers: [p.result] })) : undefined;
      winningMarker.setResult(p.result, winningPoint);
      if (p.result !== null && winningPoint) { root.dataset.winningMarker = String(p.result); root.dataset.markerX = String(winningPoint[0]); root.dataset.markerY = String(winningPoint[1]); }
      else { delete root.dataset.winningMarker; delete root.dataset.markerX; delete root.dataset.markerY; }
    };
    // Tilt actual geometry to match the fixed photographic camera. Height in
    // the wheel now changes both occlusion and the ball's projected position.
    const wheelFrame = new THREE.Group(); wheelFrame.position.set(PHOTO.wheelX, PHOTO.wheelY, 200); wheelFrame.rotation.x = Math.acos(PHOTO.wheelScaleY); scene.add(wheelFrame);
    const wheel = createWheelRotor(); wheelFrame.add(wheel.rotor);
    const environmentScene = new RoomEnvironment(), pmrem = new THREE.PMREMGenerator(renderer);
    const environment = pmrem.fromScene(environmentScene, .04); scene.environment = environment.texture; environmentScene.dispose(); pmrem.dispose();
    new THREE.TextureLoader().load(plateUrl, map => {
      if (disposed) { map.dispose(); return; }
      ownTexture(map); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      wheel.setPhotographicFloor(map.image as HTMLImageElement);
      scene.add(new THREE.Mesh(ownGeometry(photoPolygon([[0, 0], [PHOTO.width, 0], [PHOTO.width, PHOTO.height], [0, PHOTO.height]])), basic({ map })));
      const spindle = new THREE.Mesh(ownGeometry(photoPolygon(SPINDLE_OUTLINE)), basic({ map })); spindle.position.z = 400; scene.add(spindle);
      loaded = true; root.dataset.ready = "true"; root.dataset.presentation = "reference-camera"; updateMarks.current();
    }, undefined, () => { if (!disposed) setFailed(true); });
    const ball = new THREE.Mesh(ownGeometry(new THREE.SphereGeometry(WHEEL.ballRadius, 32, 20)), ownMaterial(new THREE.MeshStandardMaterial({ color: "#fff4dc", roughness: .19, metalness: .03, envMapIntensity: .6 }))); wheelFrame.add(ball);
    scene.add(new THREE.AmbientLight(0xffffff, .7)); const light = new THREE.DirectionalLight(0xffefcf, 2); light.position.set(-300, -500, 900); scene.add(light);
    const shadowMaterial = basic({ color: "#17100a", transparent: true, opacity: .5, depthWrite: false });
    const shadow = new THREE.Mesh(ownGeometry(new THREE.CircleGeometry(5, 32)), shadowMaterial); wheelFrame.add(shadow);
    const pointerPosition = (e: PointerEvent): [number, number] => { const rect = renderer.domElement.getBoundingClientRect(); return [camera.left + (e.clientX - rect.left) / rect.width * (camera.right - camera.left), camera.top + (e.clientY - rect.top) / rect.height * (camera.bottom - camera.top)]; };
    let down: { x: number; y: number } | null = null;
    const pointerDown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY }; };
    const pointerUp = (e: PointerEvent) => {
      const start = down; down = null; if (!start || Math.hypot(e.clientX - start.x, e.clientY - start.y) > 12 || latest.current.disabled || !loaded) return;
      const [x, y] = pointerPosition(e), spot = photoBoardSpot(x, y), bets = spot ? [spot] : photoTrackSelection(x, y, latest.current.neighbours)?.spots ?? [];
      if (bets.length) latest.current.onPlace(bets);
      hoverPoint = null; updateMarks.current();
    };
    const pointerMove = (e: PointerEvent) => {
      hoverPoint = pointerPosition(e); const next = hoveredSelection();
      if (JSON.stringify(next) !== hoverSignature) updateMarks.current();
      renderer.domElement.style.cursor = next.spot || next.track ? "pointer" : "default";
    };
    const pointerLeave = () => { hoverPoint = null; down = null; updateMarks.current(); };
    const contextLost = (e: Event) => { e.preventDefault(); setFailed(true); };
    renderer.domElement.addEventListener("pointerdown", pointerDown); renderer.domElement.addEventListener("pointerup", pointerUp); renderer.domElement.addEventListener("pointermove", pointerMove); renderer.domElement.addEventListener("pointerleave", pointerLeave); renderer.domElement.addEventListener("webglcontextlost", contextLost);
    const resize = () => {
      const w = Math.max(1, root.clientWidth), h = Math.max(1, root.clientHeight); renderer.setSize(w, h, false);
      const viewWidth = Math.max(1651, PHOTO.height * w / h), viewHeight = viewWidth * h / w;
      camera.left = (PHOTO.width - viewWidth) / 2; camera.right = camera.left + viewWidth; camera.top = (PHOTO.height - viewHeight) / 2; camera.bottom = camera.top + viewHeight; camera.updateProjectionMatrix();
      root.dataset.photoViewport = JSON.stringify({ left: camera.left, top: camera.top, width: viewWidth, height: viewHeight });
    };
    const observer = new ResizeObserver(resize); observer.observe(root); resize();
    let raf = 0, lastRender = 0, lastRound: string | null = null, completed = false;
    const motion = new WheelMotion(performance.now()), worldBall = new THREE.Vector3(), localBall = new THREE.Vector3(), worldPocket = new THREE.Vector3();
    const frame = (now: number) => {
      const p = latest.current;
      winningMarker.update(now);
      root.dataset.selectionAnimating = String(selection.update(now));
      if (p.roundId !== lastRound) { lastRound = p.roundId; completed = false; delete root.dataset.landedPocket; delete root.dataset.physicalPocket; }
      const pose = motion.sample(now, { ...p, remainingMs: p.landingDeadline - Date.now() });
      wheel.rotor.rotation.z = pose.rotorAngle;
      const x = Math.sin(pose.ballAngle) * pose.radius, y = -Math.cos(pose.ballAngle) * pose.radius * pose.aspect;
      ball.position.set(x, y, pose.elevation); shadow.position.set(x + .8, y + .8, pose.floor + .12);
      const airborne = Math.max(0, pose.elevation - pose.floor - WHEEL.ballRadius); shadow.scale.setScalar(1 + airborne * .035); shadowMaterial.opacity = .48 / (1 + airborne * .16);
      ball.visible = shadow.visible = loaded && pose.stage !== "hidden";
      wheelFrame.updateMatrixWorld(true); ball.getWorldPosition(worldBall);
      root.dataset.ballStage = pose.stage; root.dataset.ballVisible = String(ball.visible);
      root.dataset.ballAngle = String(pose.ballAngle); root.dataset.rotorAngle = String(wheel.rotor.rotation.z);
      root.dataset.ballX = String(worldBall.x); root.dataset.ballY = String(worldBall.y);
      root.dataset.ballRadius = String(Math.hypot(ball.position.x, ball.position.y / pose.aspect)); root.dataset.ballHeight = String(ball.position.z);
      if (pose.stage === "seated" && pose.pocket !== null) {
        // Derive the displayed pocket from the actual scene transforms, not the
        // animation's requested outcome, so camera/rotation regressions show up.
        localBall.copy(worldBall); wheel.rotor.worldToLocal(localBall);
        const localAngle = Math.atan2(localBall.x, -localBall.y) - WHEEL.zeroAngle;
        const index = Math.round(((localAngle % TAU + TAU) % TAU) / (TAU / 37)) % 37;
        root.dataset.physicalPocket = String(EUROPEAN_WHEEL_ORDER[index]);
        wheel.anchors[index].getWorldPosition(worldPocket); root.dataset.pocketDistance = String(worldPocket.distanceTo(worldBall));
        if (loaded && !completed && p.roundId) { completed = true; root.dataset.landedPocket = String(pose.pocket); p.onLanded(pose.pocket, p.roundId); }
      }
      if (!document.hidden && now - lastRender > 16) { renderer.render(scene, camera); lastRender = now; }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      disposed = true; cancelAnimationFrame(raf); observer.disconnect(); updateMarks.current = () => {};
      renderer.domElement.removeEventListener("pointerdown", pointerDown); renderer.domElement.removeEventListener("pointerup", pointerUp); renderer.domElement.removeEventListener("pointermove", pointerMove); renderer.domElement.removeEventListener("pointerleave", pointerLeave); renderer.domElement.removeEventListener("webglcontextlost", contextLost);
      selection.dispose(); winningMarker.dispose(); wheel.dispose(); environment.dispose(); geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); textures.forEach(t => t.dispose()); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
    };
  }, []);
  return <div ref={host} className="sar-scene" data-testid="speed-roulette-scene">{failed && <div className="sar-render-error">3D view unavailable. Use “Table bets” below to play, or reload to restore the table.</div>}</div>;
}
