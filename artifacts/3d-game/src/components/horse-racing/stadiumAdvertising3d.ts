import * as THREE from "three";
import { trackPoint } from "./race3dMath";
import {
  AD_SLOTS,
  activeStadiumCampaign,
  parseStadiumCampaigns,
  type AdSlot,
  type StadiumCampaign,
} from "./stadiumAdvertising";

const CONFIG = "/assets/horse-racing/advertising/campaigns.json";
const ASPECT: Record<AdSlot, number> = {
  trackside: 8,
  infield: 3,
  grandstand: 12,
  finish: 6,
};

/** Physical hoardings. All placements in a slot share one replaceable texture. */
export function stadiumAdvertising(venue: string) {
  const park = venue === "royal";
  const group = new THREE.Group();
  group.name = "stadium-advertising";
  const stats = {
    revision: "stadium-hoardings-v2",
    boards: 0,
    groundAds: 0,
    slots: 4,
    activeCampaigns: "",
    loadedImages: 0,
    configStatus: "loading",
  };
  group.userData.advertising = stats;
  const frameMat = new THREE.MeshStandardMaterial({
    color: "#202829",
    roughness: 0.65,
    metalness: 0.65,
  });
  const baseMat = new THREE.MeshStandardMaterial({
    color: "#8a8d82",
    roughness: 0.9,
  });
  const trimMat = new THREE.MeshStandardMaterial({
    color: "#bac2bb",
    roughness: 0.4,
    metalness: 0.75,
  });
  const batches = new Map<THREE.Material, THREE.Matrix4[]>();
  const dummy = new THREE.Object3D();
  const planes = new Map<THREE.Material, THREE.Matrix4[]>();
  const textures = new Map<
    AdSlot,
    {
      canvas: HTMLCanvasElement;
      texture: THREE.CanvasTexture;
      material: THREE.MeshBasicMaterial;
      current: string;
      retryAt: number;
    }
  >();
  function fallback(slot: AdSlot) {
    const { canvas, texture } = textures.get(slot)!;
    const c = canvas.getContext("2d")!,
      w = canvas.width,
      h = canvas.height;
    c.fillStyle = slot === "finish" ? "#dbba63" : "#103c35";
    c.fillRect(0, 0, w, h);
    c.fillStyle = slot === "finish" ? "#182b25" : "#fff6dc";
    c.font = `800 ${Math.min(h * 0.48, w / 10)}px Arial`;
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText("WORLD RACING", w / 2, h * 0.48);
    c.font = `600 ${Math.min(h * 0.15, w / 40)}px Arial`;
    c.fillText("STADIUM PARTNER", w / 2, h * 0.81);
    texture.needsUpdate = true;
  }
  for (const slot of AD_SLOTS) {
    const canvas = document.createElement("canvas");
    canvas.width = 1536;
    canvas.height = Math.round(canvas.width / ASPECT[slot]);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      toneMapped: false,
    });
    textures.set(slot, { canvas, texture, material, current: "", retryAt: 0 });
    fallback(slot);
  }
  function add(
    batch: Map<THREE.Material, THREE.Matrix4[]>,
    mat: THREE.Material,
    parent: THREE.Matrix4,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    turn = 0,
  ) {
    dummy.position.set(x, y, z);
    dummy.scale.set(w, h, d);
    dummy.rotation.set(0, turn, 0);
    dummy.updateMatrix();
    const list = batch.get(mat) ?? [];
    list.push(new THREE.Matrix4().multiplyMatrices(parent, dummy.matrix));
    batch.set(mat, list);
  }
  function board(
    slot: AdSlot,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    rotation: number,
    legs = true,
  ) {
    const parent = new THREE.Matrix4()
      .makeRotationY(rotation)
      .setPosition(x, y, z);
    const panel = textures.get(slot)!.material;
    add(batches, frameMat, parent, 0, 0, 0, w + 0.28, h + 0.28, 0.32);
    add(batches, trimMat, parent, 0, -h / 2 - 0.11, 0.01, w + 0.34, 0.08, 0.38);
    add(planes, panel, parent, 0, 0, 0.166, w, h, 1);
    // A separate outward face keeps lettering readable from the reverse camera.
    add(planes, panel, parent, 0, 0, -0.166, w, h, 1, Math.PI);
    if (legs)
      for (const offset of [-w * 0.35, w * 0.35]) {
        const length = y - h / 2;
        add(
          batches,
          frameMat,
          parent,
          offset,
          -h / 2 - length / 2,
          0,
          h > 3 ? 0.34 : 0.14,
          length,
          h > 3 ? 0.4 : 0.22,
        );
        add(batches, baseMat, parent, offset, -y + 0.12, 0, 0.7, 0.24, 0.7);
        if (h > 3) {
          add(
            batches,
            trimMat,
            parent,
            offset,
            h / 2 + 0.38,
            0.1,
            0.08,
            0.5,
            0.08,
          );
          add(
            batches,
            frameMat,
            parent,
            offset,
            h / 2 + 0.64,
            0.3,
            1.15,
            0.14,
            0.48,
          );
        }
      }
    stats.boards++;
  }
  if (park) {
    // A park course uses a few perimeter boards; all campaign slots still work.
    for (const side of [-1, 1]) {
      const rotation = side < 0 ? 0 : Math.PI;
      board("trackside", -45, 1.3, side * 66, 12, 1.5, rotation);
      board("infield", 100, 2.4, side * 70, 12, 4, rotation);
      board("grandstand", -90, 2.4, side * 76, 14.4, 1.2, rotation);
      board("finish", 14, 3, side * 63, 10.8, 1.8, rotation);
    }
  } else {
    // Continuous boards outside the running rail, including both bends.
    for (let i = 0; i < 52; i++) {
      const p = trackPoint(i / 52, (59 - 35) / 2.15);
      board("trackside", p.x, 1.18, p.z, 11.6, 1.45, p.heading - Math.PI / 2);
    }
    // Low inner-rail panels remain below the horses' torsos in trackside shots.
    for (let i = 0; i < 56; i++) {
      const p = trackPoint(i / 56, (29.2 - 35) / 2.15);
      board("trackside", p.x, 0.72, p.z, 8, 1, p.heading - Math.PI / 2);
    }
    // Raised screens above the spectators at both ends of the stadium.
    for (const end of [-1, 1])
      for (const angle of [-Math.PI / 3, 0, Math.PI / 3]) {
        const x = end * (70 + Math.cos(angle) * 82),
          z = Math.sin(angle) * 82;
        board(
          "infield",
          x,
          10.5,
          z,
          16.5,
          5.5,
          Math.atan2(-end * Math.cos(angle), -Math.sin(angle)),
        );
      }
    board("infield", -33, 5.8, -18, 18, 6, Math.PI);
    board("infield", 40, 5.8, 18, 18, 6, 0);
    board("finish", 18, 4.5, -62, 12, 2, 0);
    for (const side of [-1, 1])
      for (let x = -64; x <= 64; x += 16)
        board(
          "grandstand",
          x,
          14.85,
          side * 77.65,
          14.4,
          1.2,
          side === 1 ? Math.PI : 0,
          false,
        );
  }
  const paintMaterials = new Map<AdSlot, THREE.MeshBasicMaterial>();
  function groundAd(
    slot: AdSlot,
    x: number,
    z: number,
    w: number,
    h: number,
    rotation: number,
    elevation = 0.016,
  ) {
    const matrix = new THREE.Matrix4()
      .makeRotationY(rotation)
      .multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2))
      .scale(new THREE.Vector3(w, h, 1))
      .setPosition(x, elevation, z);
    let material = paintMaterials.get(slot);
    if (!material) {
      material = textures.get(slot)!.material.clone();
      material.polygonOffset = true;
      material.polygonOffsetFactor = -2;
      material.polygonOffsetUnits = -4;
      paintMaterials.set(slot, material);
    }
    const batch = planes.get(material) ?? [];
    batch.push(matrix);
    planes.set(material, batch);
    stats.groundAds++;
  }
  const asphalt = new THREE.MeshStandardMaterial({
    color: "#51594f",
    roughness: 0.98,
  });
  const outline = (radius: number) =>
    Array.from({ length: 240 }, (_, i) => {
      const p = trackPoint(i / 240, (radius - 35) / 2.15);
      return new THREE.Vector2(p.x, p.z);
    });
  const apronShape = new THREE.Shape(outline(57.8));
  apronShape.holes.push(new THREE.Path(outline(54.8).reverse()));
  const apron = new THREE.Mesh(new THREE.ShapeGeometry(apronShape), asphalt);
  apron.rotation.x = -Math.PI / 2;
  apron.position.y = -0.015;
  apron.receiveShadow = true;
  if (!park) group.add(apron);
  else {
    apron.geometry.dispose();
    asphalt.dispose();
  }
  for (let i = 0; i < (park ? 0 : 24); i++) {
    const p = trackPoint((i + 0.5) / 24, (56.3 - 35) / 2.15);
    groundAd("trackside", p.x, p.z, 10.4, 1.3, p.heading - Math.PI / 2);
  }
  for (const side of park ? [] : [-1, 1]) {
    // Service/entrance roads behind the grandstands, with sponsor paintwork.
    const road = new THREE.Mesh(new THREE.BoxGeometry(152, 0.2, 9), asphalt);
    road.position.set(0, 0, side * 116);
    road.receiveShadow = true;
    group.add(road);
    for (const x of [-56, -28, 0, 28, 56])
      board("trackside", x, 3.1, side * 110.5, 16, 2, side === 1 ? 0 : Math.PI);
    for (const x of [-48, 0, 48])
      groundAd(
        "trackside",
        x,
        side * 116,
        18,
        2.25,
        side === 1 ? 0 : Math.PI,
        0.116,
      );
    for (const x of [-55, -33, -11, 11, 33, 55])
      groundAd("infield", x, side * 22, 18, 6, side === 1 ? Math.PI : 0);
  }
  for (const [batch, geometry] of [
    [batches, new THREE.BoxGeometry(1, 1, 1)],
    [planes, new THREE.PlaneGeometry(1, 1)],
  ] as const) {
    for (const [mat, matrices] of batch) {
      const mesh = new THREE.InstancedMesh(geometry, mat, matrices.length);
      matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
      mesh.castShadow = batch === batches;
      mesh.receiveShadow = batch === batches;
      if (mat.polygonOffset) mesh.renderOrder = 1;
      mesh.computeBoundingSphere();
      group.add(mesh);
    }
  }

  let disposed = false,
    refreshing = false,
    campaigns: StadiumCampaign[] = [];
  const requests = new Set<AbortController>();
  const loaded = new Set<AdSlot>();
  const generations = new Map<AdSlot, number>();
  async function artwork(slot: AdSlot, campaign: StadiumCampaign | undefined) {
    const surface = textures.get(slot)!;
    const key = campaign ? campaign.id + "|" + campaign.imageUrl : "";
    if (
      surface.current === key &&
      (!surface.retryAt || Date.now() < surface.retryAt)
    )
      return;
    surface.current = key;
    surface.retryAt = 0;
    const generation = (generations.get(slot) ?? 0) + 1;
    generations.set(slot, generation);
    loaded.delete(slot);
    stats.loadedImages = loaded.size;
    fallback(slot);
    if (!campaign) return;
    const controller = new AbortController();
    requests.add(controller);
    const timer = window.setTimeout(() => controller.abort(), 15000);
    let imageUrl: string | undefined;
    const artworkImage = new Image();
    try {
      const response = await fetch(campaign.imageUrl, {
        signal: controller.signal,
        cache: "no-cache",
        credentials: "omit",
      });
      if (!response.ok) throw Error("Artwork unavailable");
      const blob = await response.blob();
      if (blob.size > 8 * 1024 * 1024 || !/^image\//.test(blob.type))
        throw Error("Invalid artwork");
      if (controller.signal.aborted) throw Error("Artwork timed out");
      imageUrl = URL.createObjectURL(blob);
      await new Promise<void>((resolve, reject) => {
        artworkImage.onload = () => resolve();
        artworkImage.onerror = () =>
          reject(Error("Artwork could not be decoded"));
        controller.signal.addEventListener(
          "abort",
          () => {
            artworkImage.src = "";
            reject(Error("Artwork cancelled"));
          },
          { once: true },
        );
        artworkImage.src = imageUrl!;
      });
      if (disposed || generations.get(slot) !== generation) return;
      const { canvas, texture } = surface,
        c = canvas.getContext("2d")!;
      c.fillStyle = "#102c27";
      c.fillRect(0, 0, canvas.width, canvas.height);
      const scale = Math.min(
        canvas.width / artworkImage.naturalWidth,
        canvas.height / artworkImage.naturalHeight,
      );
      c.drawImage(
        artworkImage,
        (canvas.width - artworkImage.naturalWidth * scale) / 2,
        (canvas.height - artworkImage.naturalHeight * scale) / 2,
        artworkImage.naturalWidth * scale,
        artworkImage.naturalHeight * scale,
      );
      texture.needsUpdate = true;
      loaded.add(slot);
      stats.loadedImages = loaded.size;
    } catch {
      if (!disposed && generations.get(slot) === generation)
        surface.retryAt = Date.now() + 60000;
    } finally {
      artworkImage.onload = artworkImage.onerror = null;
      if (imageUrl) URL.revokeObjectURL(imageUrl);
      window.clearTimeout(timer);
      requests.delete(controller);
    }
  }
  function apply() {
    const selected = AD_SLOTS.map((slot) =>
      activeStadiumCampaign(campaigns, slot, venue, Date.now()),
    );
    stats.activeCampaigns = selected
      .filter(Boolean)
      .map((c) => c!.id)
      .join(",");
    AD_SLOTS.forEach((slot, i) => {
      void artwork(slot, selected[i]);
    });
  }
  async function refresh() {
    if (disposed || refreshing) return;
    refreshing = true;
    const controller = new AbortController();
    requests.add(controller);
    const timer = window.setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(CONFIG, {
        signal: controller.signal,
        cache: "no-store",
      });
      if (!response.ok) throw Error("No campaign configuration");
      const input = await response.json();
      if (disposed) return;
      campaigns = parseStadiumCampaigns(input);
      stats.configStatus = "ready";
      apply();
    } catch {
      if (!disposed) stats.configStatus = "fallback";
    } finally {
      window.clearTimeout(timer);
      requests.delete(controller);
      refreshing = false;
    }
  }
  const reloadTimer = window.setInterval(() => {
    void refresh();
  }, 60000);
  const scheduleTimer = window.setInterval(apply, 1000);
  // Let the first heavy WebGL frame compile before starting network deadlines.
  const startupTimer = window.setTimeout(() => {
    void refresh();
  }, 0);
  group.userData.dispose = () => {
    disposed = true;
    window.clearInterval(reloadTimer);
    window.clearInterval(scheduleTimer);
    window.clearTimeout(startupTimer);
    requests.forEach((c) => c.abort());
    requests.clear();
  };
  return group;
}
