import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { loadBroadcastAssets, type BroadcastAssets } from "./BroadcastAssets";
import { buildFootballScene } from "./FootballScene";
import UnitySportsScene, { type SportsSceneProps } from "./UnitySportsScene";
import type { Sport } from "../../../../../lib/virtual-sports/catalog.mjs";
import type { Round } from "../../../../../lib/virtual-sports/store.mjs";

type V3 = [number, number, number];
interface Athlete {
  group: THREE.Group;
  limbs: THREE.Group[];
  home: V3;
  team: number;
  shirt: THREE.MeshStandardMaterial;
  kit: THREE.MeshStandardMaterial;
  mixer: THREE.AnimationMixer;
  run: THREE.AnimationAction;
  idle: THREE.AnimationAction;
  strike: THREE.AnimationAction;
  hands: THREE.Object3D[];
  arms: THREE.Object3D[];
  previous: THREE.Vector3;
}
const UP = new THREE.Vector3(0, 1, 0);

// All assets are bundled locally; rounds have no third-party asset dependency.
function buildScene(
  host: HTMLDivElement,
  sport: Sport,
  quality: string,
  assets: BroadcastAssets,
  read: () => { round?: Round; time: number; camera: string },
  onReady: () => void,
) {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(
    Math.min(devicePixelRatio, quality === "high" ? 2 : quality === "balanced" ? 1 : 1.5),
  );
  renderer.shadowMap.enabled = quality !== "balanced";
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(
    sport.id === "basketball" ? "#11151a" : "#87969d",
  );
  scene.fog = new THREE.Fog(
    sport.id === "basketball" ? "#11151a" : "#87969d",
    110,
    310,
  );
  scene.environment = assets.daylight;
  scene.environmentIntensity = sport.id === "basketball" ? 0.35 : 0.55;
  const camera = new THREE.PerspectiveCamera(37, 1, 0.1, 450);
  const materials: THREE.Material[] = [],
    textures: THREE.Texture[] = [];
  const material = (
    color: THREE.ColorRepresentation,
    roughness = 0.7,
    metalness = 0,
  ) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness, metalness });
    materials.push(m);
    return m;
  };
  const white = material("#e7ece2"),
    dark = material("#15232b"),
    concrete = material("#626660"),
    trim = material("#b2b7b6", 0.48, 0.48);
  const glow = new THREE.MeshBasicMaterial({ color: "#e8f8ff" });
  materials.push(glow);
  const make = (
    geometry: THREE.BufferGeometry,
    mat: THREE.Material,
    pos: V3,
    parent: THREE.Object3D = scene,
  ) => {
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.position.set(...pos);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };
  const box = (
    size: V3,
    pos: V3,
    mat: THREE.Material = white,
    parent: THREE.Object3D = scene,
  ) => make(new THREE.BoxGeometry(...size), mat, pos, parent);
  const sphere = (
    r: number,
    pos: V3,
    mat = white,
    parent: THREE.Object3D = scene,
  ) => make(new THREE.SphereGeometry(r, 16, 12), mat, pos, parent);
  const rod = (
    a: V3,
    b: V3,
    radius: number,
    mat = white,
    parent: THREE.Object3D = scene,
  ) => {
    const start = new THREE.Vector3(...a),
      end = new THREE.Vector3(...b);
    const d = end.clone().sub(start);
    const m = make(
      new THREE.CylinderGeometry(radius, radius, d.length(), 8),
      mat,
      start.add(end).multiplyScalar(0.5).toArray() as V3,
      parent,
    );
    m.quaternion.setFromUnitVectors(UP, d.normalize());
    return m;
  };
  const line = (
    points: V3[],
    color = "#e7eee0",
    parent: THREE.Object3D = scene,
  ) => {
    const mat = new THREE.LineBasicMaterial({ color });
    materials.push(mat);
    const l = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(
        points.map((p) => new THREE.Vector3(...p)),
      ),
      mat,
    );
    parent.add(l);
    return l;
  };
  const circle = (rx: number, rz: number, x = 0, z = 0, color = "#e7eee0") =>
    line(
      Array.from(
        { length: 129 },
        (_, i) =>
          [
            x + Math.cos((i / 128) * Math.PI * 2) * rx,
            0.085,
            z + Math.sin((i / 128) * Math.PI * 2) * rz,
          ] as V3,
      ),
      color,
    );
  const rect = (w: number, h: number, x = 0, z = 0) =>
    line([
      [x - w / 2, 0.09, z - h / 2],
      [x + w / 2, 0.09, z - h / 2],
      [x + w / 2, 0.09, z + h / 2],
      [x - w / 2, 0.09, z + h / 2],
      [x - w / 2, 0.09, z - h / 2],
    ]);
  const textureCanvas = (w: number, h: number) => {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    return canvas;
  };
  const field = textureCanvas(2048, 2048),
    ctx = field.getContext("2d")!;
  const indoor = sport.id === "basketball",
    court = sport.id === "tennis";
  ctx.fillStyle = indoor ? "#ba8a4e" : court ? "#397f9a" : "#28734c";
  ctx.fillRect(0, 0, 2048, 2048);
  for (let i = 0; i < (indoor ? 64 : 16); i++) {
    ctx.fillStyle = indoor
      ? i % 3
        ? "#c99c60"
        : "#be9055"
      : i % 2
        ? "#2c8051"
        : "#328957";
    if (!court)
      ctx.fillRect(i * (indoor ? 32 : 128), 0, indoor ? 31 : 128, 2048);
  }
  let seed = 12;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < 45000; i++) {
    ctx.fillStyle = `rgba(${indoor ? "40,24,0" : "190,240,140"},${rand() * 0.1})`;
    ctx.fillRect(rand() * 2048, rand() * 2048, 1, indoor ? 40 : 3);
  }
  if (indoor) {
    ctx.strokeStyle = "rgba(64,37,10,.2)";
    ctx.lineWidth = 1;
    for (let row = 0; row < 64; row++)
      for (let j = 0; j < 8; j++) {
        const y = j * 300 + (row % 3) * 95;
        ctx.beginPath();
        ctx.moveTo(row * 32, y);
        ctx.lineTo(row * 32 + 32, y);
        ctx.stroke();
      }
  }
  const fieldMap = new THREE.CanvasTexture(field);
  fieldMap.colorSpace = THREE.SRGBColorSpace;
  fieldMap.anisotropy = 8;
  textures.push(fieldMap);
  const turf = new THREE.MeshStandardMaterial({
    color: indoor ? "#e9c895" : court ? "#63858a" : "#78b96c",
    map: indoor || court ? fieldMap : assets.grass,
    normalMap: indoor || court ? null : assets.normal,
    normalScale: new THREE.Vector2(0.32, 0.32),
    roughness: indoor ? 0.28 : 0.93,
  });
  if (!indoor && !court)
    turf.onBeforeCompile = (shader) => {
      shader.vertexShader =
        "varying vec3 vField;\n" +
        shader.vertexShader.replace(
          "#include <begin_vertex>",
          "#include <begin_vertex>\nvField=position;",
        );
      shader.fragmentShader =
        "varying vec3 vField;\n" +
        shader.fragmentShader.replace(
          "#include <map_fragment>",
          "#include <map_fragment>\ndiffuseColor.rgb *= mix(0.83,1.04,step(.5,fract(vField.x/7.5)));",
        );
    };
  materials.push(turf);
  const size: [number, number] =
    sport.id === "formula"
      ? [100, 70]
      : sport.id === "football"
        ? [70, 46]
        : sport.id === "cricket"
          ? [72, 56]
          : [44, 32];
  box([300, 0.8, 260], [0, -1, 0], material("#494c46"));
  box([size[0], 0.2, size[1]], [0, -0.12, 0], turf);
  scene.add(new THREE.HemisphereLight("#d5e6f1", "#4f513b", 0.5));
  const sun = new THREE.DirectionalLight("#fff2db", indoor ? 1.8 : 2.6);
  sun.position.set(-34, 58, 28);
  sun.castShadow = true;
  sun.shadow.mapSize.set(
    quality === "high" ? 4096 : 2048,
    quality === "high" ? 4096 : 2048,
  );
  sun.shadow.camera.left = -60;
  sun.shadow.camera.right = 60;
  sun.shadow.camera.top = 50;
  sun.shadow.camera.bottom = -50;
  sun.shadow.normalBias = 0.025;
  sun.shadow.bias = -0.0001;
  sun.shadow.radius = 3;
  scene.add(sun);
  const rim = new THREE.DirectionalLight("#c4ddff", 0.55);
  rim.position.set(20, 20, -30);
  scene.add(rim);

  // Terraced stands, individual seats, advertising fascia and floodlight towers.
  const stadiumW = size[0] / 2 + 5,
    stadiumH = size[1] / 2 + 5;
  const seats = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.65, 0.65, 0.8),
    material("#466275"),
    6000,
  );
  const crowdMaterial = new THREE.MeshStandardMaterial({
    map: assets.crowd,
    roughness: 1,
    color: indoor ? "#aeb3c0" : "#e1e3de",
    side: THREE.DoubleSide,
  });
  materials.push(crowdMaterial);
  const dummy = new THREE.Object3D();
  let seatIndex = 0,
    crowdIndex = 0;
  for (let side = 0; side < 4; side++) {
    const horizontal = side < 2,
      length = horizontal ? stadiumW * 2 : stadiumH * 2;
    for (let row = 0; row < 7; row++) {
      const outward = row * 1.5,
        level = 1 + row * 0.95,
        sign = side % 2 ? -1 : 1;
      box(
        horizontal
          ? [length + outward * 2, 0.9, 1.7]
          : [1.7, 0.9, length + outward * 2],
        horizontal
          ? [0, level - 0.6, sign * (stadiumH + outward)]
          : [sign * (stadiumW + outward), level - 0.6, 0],
        concrete,
      );
      for (let s = -length / 2 - outward; s < length / 2 + outward; s += 0.98) {
        if (Math.abs(s % 17) < 1.1 || seatIndex >= 6000) continue;
        dummy.position.set(
          ...((horizontal
            ? [s, level, sign * (stadiumH + outward)]
            : [sign * (stadiumW + outward), level, s]) as V3),
        );
        dummy.rotation.y = horizontal ? 0 : Math.PI / 2;
        dummy.updateMatrix();
        seats.setMatrixAt(seatIndex, dummy.matrix);
        seats.setColorAt(
          seatIndex++,
          new THREE.Color(
            ["#465d70", "#617887", "#a3b5b4", "#314653", "#849592"][
              Math.floor(rand() * 5)
            ],
          ),
        );
        crowdIndex++;
      }
    }
    const sign = side % 2 ? -1 : 1;
    // Full stadium tiers have photographic spectators, concrete aisles, rails,
    // steel roof supports and hospitality glazing. The plate follows each rake.
    for (let tier = 0; tier < 3; tier++) {
      const outer = 3 + tier * 8.5,
        level = 3.4 + tier * 5.7;
      const front = horizontal
        ? new THREE.Vector3(0, level, sign * (stadiumH + outer))
        : new THREE.Vector3(sign * (stadiumW + outer), level, 0);
      for (let section = 0; section < Math.ceil(length / 22); section++) {
        const span = length / Math.ceil(length / 22),
          offset = -length / 2 + span * (section + 0.5);
        const plate = make(
          new THREE.PlaneGeometry(span - 0.5, 10.25),
          crowdMaterial,
          front.toArray() as V3,
        );
        if (horizontal) {
          plate.position.x = offset;
          plate.rotation.set(
            sign > 0 ? 0.98 : -0.98,
            sign > 0 ? Math.PI : 0,
            0,
          );
        } else {
          plate.position.z = offset;
          plate.rotation.y = sign > 0 ? -Math.PI / 2 : Math.PI / 2;
          plate.rotateX(-0.98);
        }
        plate.castShadow = false;
      }
      box(
        horizontal ? [length, 0.2, 0.14] : [0.14, 0.2, length],
        horizontal
          ? [0, level - 2, sign * (stadiumH + outer - 1.6)]
          : [sign * (stadiumW + outer - 1.6), level - 2, 0],
        trim,
      );
    }
    const roofPos: V3 = horizontal
      ? [0, 22, sign * (stadiumH + 16)]
      : [sign * (stadiumW + 16), 22, 0];
    box(
      horizontal ? [length + 18, 0.4, 17] : [17, 0.4, length + 18],
      roofPos,
      material("#d1d0c6", 0.65, 0.25),
    );
    for (let p = -length / 2; p <= length / 2; p += 12) {
      const a: V3 = horizontal
        ? [p, 3, sign * (stadiumH + 25)]
        : [sign * (stadiumW + 25), 3, p];
      const b: V3 = horizontal
        ? [p, 22, sign * (stadiumH + 25)]
        : [sign * (stadiumW + 25), 22, p];
      const c: V3 = horizontal
        ? [p, 21, sign * (stadiumH + 7)]
        : [sign * (stadiumW + 7), 21, p];
      rod(a, b, 0.16, trim);
      rod(b, c, 0.12, trim);
      for (let j = 0; j < 4; j++) {
        const d = new THREE.Vector3(...b).lerp(new THREE.Vector3(...c), j / 4);
        const e = new THREE.Vector3(...b).lerp(
          new THREE.Vector3(...c),
          (j + 1) / 4,
        );
        e.y -= 1.4;
        rod(d.toArray() as V3, e.toArray() as V3, 0.055, trim);
      }
    }
    box(
      horizontal ? [length + 24, 0.5, 4] : [4, 0.5, length + 24],
      horizontal
        ? [0, 9, sign * (stadiumH + 11)]
        : [sign * (stadiumW + 11), 9, 0],
      trim,
    );
  }
  seats.count = 0;
  seats.receiveShadow = true;
  scene.add(seats);
  const ad = textureCanvas(1024, 96),
    ac = ad.getContext("2d")!;
  ac.fillStyle = "#0d2224";
  ac.fillRect(0, 0, 1024, 96);
  ac.font = "bold 38px Arial";
  ac.fillStyle = sport.color;
  ac.textAlign = "center";
  ac.fillText(
    "ARENA     /     VIRTUAL SPORTS     /     PLAY THE MOMENT",
    512,
    60,
  );
  const adMap = new THREE.CanvasTexture(ad);
  adMap.colorSpace = THREE.SRGBColorSpace;
  adMap.wrapS = THREE.RepeatWrapping;
  adMap.repeat.x = 4;
  adMap.anisotropy = 8;
  textures.push(adMap);
  const adMat = new THREE.MeshBasicMaterial({ map: adMap });
  materials.push(adMat);
  for (const sign of [-1, 1]) {
    const banner = make(new THREE.PlaneGeometry(stadiumW * 2, 1.6), adMat, [
      0,
      1,
      sign * (stadiumH - 1),
    ]);
    banner.rotation.y = sign > 0 ? Math.PI : 0;
  }
  for (const x of [-1, 1])
    for (const z of [-1, 1]) {
      const px = x * (stadiumW + 6),
        pz = z * (stadiumH + 7);
      rod([px, 0, pz], [px, 23, pz], 0.22, trim);
      box([7, 2, 0.4], [px, 23, pz], dark);
      for (let i = 0; i < 7; i++)
        box([0.7, 1.4, 0.5], [px - 3 + i, 23, pz], glow);
    }
  for (let i = 0; i < 30; i++) {
    const h = 4 + rand() * 25;
    box(
      [3 + rand() * 6, h, 4 + rand() * 7],
      [(i - 15) * 7, h / 2, -stadiumH - 38 - rand() * 22],
      material(i % 2 ? "#203740" : "#1c3039"),
    );
  }

  const athletes: Athlete[] = [];
  function athlete(home: V3, team: number, number: number) {
    const group = new THREE.Group();
    scene.add(group);
    group.position.set(...home);
    const shirt = material(sport.colors[team]);
    const human = cloneSkeleton(assets.athlete!.scene);
    const kit = material(
      sport.id === "cricket"
        ? sport.colors[team]
        : team
          ? "#f3f0e9"
          : "#17232a",
      0.88,
    );
    human.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      o.castShadow = true;
      o.receiveShadow = true;
      const adapt = (original: THREE.Material) => {
        if (original.name === "VitShirt") return shirt;
        if (original.name === "VitPants") return kit;
        if (
          sport.id === "cricket" &&
          /SportsLegs|SportsSocks/.test(original.name)
        )
          return kit;
        const m = original.clone() as THREE.MeshStandardMaterial;
        materials.push(m);
        if (/VitBody|VitSkin/.test(m.name))
          m.color.set(["#ffffff", "#d8ba9e", "#a87d64", "#edc9af"][number % 4]);
        if (m.name === "VitShoes")
          m.color.set(number % 2 ? "#d8e0e4" : "#e6b547");
        return m;
      };
      o.material = Array.isArray(o.material)
        ? o.material.map(adapt)
        : adapt(o.material);
    });
    // The source faces +Z after glTF's Y-up conversion; natural human proportions
    // are retained. Basketball athletes are slightly taller than other players.
    const heightScale = sport.id === "basketball" ? 1.15 : 1.04;
    human.scale.multiplyScalar(heightScale);
    group.add(human);
    const mixer = new THREE.AnimationMixer(human);
    const clips = assets.athlete!.animations;
    const clip = (name: string) =>
      clips.find((c) => c.name === name || c.name.endsWith(name))!;
    const idle = mixer.clipAction(clip("Idle")).play();
    const run = mixer.clipAction(clip("Run")).play();
    run.setEffectiveWeight(0);
    const strike = mixer.clipAction(clip("Strike")).play();
    strike.setEffectiveWeight(0);
    mixer.setTime(number * 0.17 + team * 0.23);
    const limbs: THREE.Group[] = [];
    const hands = [
      human.getObjectByName("mixamorigLeftHand") ??
        human.getObjectByName("mixamorig:LeftHand"),
      human.getObjectByName("mixamorigRightHand") ??
        human.getObjectByName("mixamorig:RightHand"),
    ].filter(Boolean) as THREE.Object3D[];
    const arms = ["LeftArm", "RightArm", "LeftForeArm", "RightForeArm"]
      .map(
        (name) =>
          human.getObjectByName("mixamorig" + name) ??
          human.getObjectByName("mixamorig:" + name),
      )
      .filter(Boolean) as THREE.Object3D[];
    // Visible jersey numbers on the actual torso, with a soft fabric edge.
    const label = textureCanvas(128, 160),
      lc = label.getContext("2d")!;
    lc.fillStyle = sport.colors[team];
    lc.fillRect(0, 0, 128, 160);
    lc.fillStyle = team ? "#13212a" : "#ffffff";
    lc.textAlign = "center";
    lc.font = "bold 74px Arial";
    lc.fillText(String(number + 1), 64, 123);
    lc.font = "bold 15px Arial";
    lc.fillText(sport.tags[team], 64, 36);
    const labelMap = new THREE.CanvasTexture(label);
    labelMap.colorSpace = THREE.SRGBColorSpace;
    textures.push(labelMap);
    const numberMat = new THREE.MeshStandardMaterial({
      map: labelMap,
      roughness: 0.9,
    });
    materials.push(numberMat);
    const badge = make(
      new THREE.PlaneGeometry(0.29, 0.36),
      numberMat,
      [0, 1.28 * heightScale, -0.135],
      group,
    );
    badge.rotation.y = Math.PI;
    badge.castShadow = false;
    if (sport.id === "tennis") {
      const equipment = hands[1] ?? group;
      const racket = make(
        new THREE.TorusGeometry(0.16, 0.018, 8, 32),
        white,
        [0, -0.42, 0.03],
        equipment,
      );
      racket.scale.y = 1.35;
      rod([0, 0, 0], [0, -0.27, 0.03], 0.022, dark, equipment);
      for (let i = -0.12; i <= 0.12; i += 0.04) {
        line(
          [
            [i, -0.58, 0.03],
            [i, -0.28, 0.03],
          ],
          "#aabdbd",
          equipment,
        );
        line(
          [
            [-0.14, -0.42 + i, 0.03],
            [0.14, -0.42 + i, 0.03],
          ],
          "#aabdbd",
          equipment,
        );
      }
    }
    if (sport.id === "cricket" && number < 2) {
      box(
        [0.12, 0.55, 0.055],
        [0, -0.35, 0],
        material("#c6a777", 0.8),
        hands[1] ?? group,
      );
      rod([0, 0, 0], [0, -0.15, 0], 0.024, dark, hands[1] ?? group);
      const helmet = sphere(0.12, [0, 1.72, 0.01], shirt, group);
      helmet.scale.set(1, 1.12, 1.25);
      for (let k = 0; k < 3; k++)
        rod(
          [-0.1, 1.61 + k * 0.035, 0.12],
          [0.1, 1.61 + k * 0.035, 0.12],
          0.006,
          trim,
          group,
        );
    }
    const a = {
      group,
      limbs,
      home,
      team,
      shirt,
      kit,
      mixer,
      run,
      idle,
      strike,
      hands,
      arms,
      previous: new THREE.Vector3(...home),
    };
    athletes.push(a);
    return a;
  }
  const goal = (x: number) => {
    rod([x, 0, -4], [x, 3, -4], 0.09);
    rod([x, 3, -4], [x, 3, 4], 0.09);
    rod([x, 3, 4], [x, 0, 4], 0.09);
    const back = x + Math.sign(x) * 1.8;
    for (let z = -4; z <= 4; z += 0.4)
      line(
        [
          [x, 3, z],
          [back, 2.7, z],
          [back, 0.1, z],
        ],
        "#b3c4bf",
      );
    for (let y = 0.3; y < 3; y += 0.3)
      line(
        [
          [back, y, -4],
          [back, y, 4],
        ],
        "#b3c4bf",
      );
    rod([x, 3, -4], [back, 2.7, -4], 0.05);
    rod([x, 3, 4], [back, 2.7, 4], 0.05);
  };
  if (sport.id === "football") {
    rect(64, 40);
    line([
      [0, 0.09, -20],
      [0, 0.09, 20],
    ]);
    circle(6, 6);
    for (const sign of [-1, 1]) {
      rect(11, 23, sign * 26.5);
      rect(4, 12, sign * 30);
      goal(sign * 32);
      const spot = make(new THREE.CircleGeometry(0.12, 16), white, [
        sign * 22,
        0.09,
        0,
      ]);
      spot.rotation.x = -Math.PI / 2;
    }
    const formation = [
      [29, 0],
      [20, -15],
      [21, -5],
      [21, 5],
      [20, 15],
      [11, -14],
      [10, -4],
      [10, 5],
      [11, 14],
      [3, -6],
      [3, 6],
    ];
    for (let team = 0; team < 2; team++)
      formation.forEach(([x, z], i) =>
        athlete([x * (team ? 1 : -1), 0, z], team, i),
      );
    for (const x of [-32, 32])
      for (const z of [-20, 20]) {
        rod([x, 0, z], [x, 2, z], 0.025);
        box([0.6, 0.35, 0.025], [x + 0.3, 1.8, z], material(sport.color));
      }
  } else if (sport.id === "cricket") {
    circle(32, 24);
    circle(20, 15, 0, 0, "#81ae86");
    const pitchCanvas = textureCanvas(512, 1024),
      pc = pitchCanvas.getContext("2d")!;
    pc.fillStyle = "#c5ad79";
    pc.fillRect(0, 0, 512, 1024);
    for (let i = 0; i < 25000; i++) {
      pc.fillStyle = rand() > 0.5 ? "#8f7d5433" : "#dfc69b33";
      pc.fillRect(rand() * 512, rand() * 1024, 1 + rand() * 3, 1 + rand() * 8);
    }
    pc.strokeStyle = "#806f4933";
    for (let i = 0; i < 45; i++) {
      pc.beginPath();
      pc.moveTo(rand() * 512, rand() * 1024);
      pc.lineTo(rand() * 512, rand() * 1024);
      pc.stroke();
    }
    const pitchMap = new THREE.CanvasTexture(pitchCanvas);
    pitchMap.colorSpace = THREE.SRGBColorSpace;
    textures.push(pitchMap);
    const pitchMat = new THREE.MeshStandardMaterial({
      map: pitchMap,
      bumpMap: pitchMap,
      bumpScale: 0.018,
      roughness: 1,
    });
    materials.push(pitchMat);
    box([3.2, 0.04, 20], [0, 0.02, 0], pitchMat);
    for (const z of [-8, 8]) {
      rect(5, 2, 0, z);
      for (const x of [-0.25, 0, 0.25])
        rod([x, 0.08, z], [x, 1.2, z], 0.045, white);
      rod([-0.3, 1.2, z], [0.3, 1.2, z], 0.035, white);
    }
    athlete([0.8, 0, 7], 0, 0);
    athlete([1, 0, -7], 0, 1);
    athlete([0, 0, -13], 1, 2);
    athlete([0, 0, 10], 1, 3);
    for (let i = 0; i < 9; i++) {
      const angle = (i / 9) * Math.PI * 2;
      athlete([Math.cos(angle) * 23, 0, Math.sin(angle) * 18], 1, i + 4);
    }
  } else if (sport.id === "basketball") {
    box([44, 0.025, 32], [0, 0.015, 0], material("#142d3c", 0.5));
    box([29, 0.03, 16], [0, 0.04, 0], turf);
    rect(28, 15);
    line([
      [0, 0.09, -7.5],
      [0, 0.09, 7.5],
    ]);
    circle(1.8, 1.8);
    for (const sign of [-1, 1]) {
      box([5.8, 0.03, 4.9], [sign * 11, 0.05, 0], material("#375f6a"));
      rect(5.8, 4.9, sign * 11);
      circle(1.8, 1.8, sign * 8);
      const arc = Array.from(
        { length: 65 },
        (_, i) =>
          [
            sign * (12 - Math.cos(-Math.PI / 2 + (i / 64) * Math.PI) * 6.6),
            0.09,
            Math.sin(-Math.PI / 2 + (i / 64) * Math.PI) * 6.6,
          ] as V3,
      );
      line(arc);
      rod([sign * 15, 0, 0], [sign * 15, 4, 0], 0.18, trim);
      rod([sign * 15, 4, 0], [sign * 12, 4, 0], 0.12, trim);
      const glass = new THREE.MeshPhysicalMaterial({
        color: "#b9d0d8",
        roughness: 0.12,
        transparent: true,
        opacity: 0.24,
        metalness: 0.1,
      });
      materials.push(glass);
      box([0.1, 1.4, 2.3], [sign * 12, 3.6, 0], glass);
      for (const y of [2.9, 4.3])
        rod([sign * 12, y, -1.15], [sign * 12, y, 1.15], 0.035, white);
      for (const z of [-1.15, 1.15])
        rod([sign * 12, 2.9, z], [sign * 12, 4.3, z], 0.035, white);
      line(
        [
          [sign * 11.93, 3.1, -0.55],
          [sign * 11.93, 3.75, -0.55],
          [sign * 11.93, 3.75, 0.55],
          [sign * 11.93, 3.1, 0.55],
        ],
        "#ffffff",
      );
      const hoop = make(
        new THREE.TorusGeometry(0.45, 0.045, 8, 24),
        material("#f17b38"),
        [sign * 11.4, 3.05, 0],
      );
      hoop.rotation.x = Math.PI / 2;
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        line([
          [sign * 11.4 + Math.cos(a) * 0.45, 3.05, Math.sin(a) * 0.45],
          [
            sign * 11.4 + Math.cos(a + 0.2) * 0.3,
            2.45,
            Math.sin(a + 0.2) * 0.3,
          ],
        ]);
      }
    }
    for (let team = 0; team < 2; team++)
      for (let i = 0; i < 5; i++)
        athlete(
          [(team ? 1 : -1) * (3 + (i % 2) * 4), 0, (i - 2) * 2.5],
          team,
          i,
        );
  } else if (sport.id === "tennis") {
    const courtMaterial = new THREE.MeshStandardMaterial({
      color: "#275990",
      map: fieldMap,
      roughness: 0.88,
    });
    materials.push(courtMaterial);
    box([24, 0.035, 11], [0, 0.015, 0], courtMaterial);
    rect(24, 11);
    rect(24, 8);
    rect(12.8, 8);
    line([
      [-6.4, 0.09, 0],
      [6.4, 0.09, 0],
    ]);
    rod([0, 0, -6], [0, 1.2, -6], 0.06);
    rod([0, 0, 6], [0, 1.2, 6], 0.06);
    rod([0, 1.15, -6], [0, 1.15, 6], 0.035);
    for (let z = -6; z <= 6; z += 0.2)
      line(
        [
          [0, 0.1, z],
          [0, 1.15, z],
        ],
        "#263331",
      );
    for (let y = 0.2; y < 1.2; y += 0.15)
      line(
        [
          [0, y, -6],
          [0, y, 6],
        ],
        "#263331",
      );
    athlete([-10, 0, 0], 0, 0);
    athlete([10, 0, 0], 1, 1);
    for (const x of [-1.9, -1.2])
      for (const z of [-7.6, -8.2]) rod([x, 0, z], [x, 2.2, z], 0.045, trim);
    box([1, 0.15, 1], [-1.55, 2.2, -7.9], dark);
    box([0.1, 0.8, 1], [-2, 2.6, -7.9], dark);
    for (let i = 0; i < 6; i++)
      rod(
        [-1.9, 0.3 + i * 0.3, -7.6],
        [-1.2, 0.3 + i * 0.3, -7.6],
        0.035,
        trim,
      );
  }
  const cars: THREE.Group[] = [];
  if (sport.id === "formula") {
    const roadCanvas = textureCanvas(1024, 1024),
      rc = roadCanvas.getContext("2d")!;
    rc.fillStyle = "#36383b";
    rc.fillRect(0, 0, 1024, 1024);
    for (let i = 0; i < 110000; i++) {
      const v = 30 + Math.floor(rand() * 80);
      rc.fillStyle = `rgba(${v},${v},${v},.35)`;
      rc.fillRect(rand() * 1024, rand() * 1024, 1.5, 1.5);
    }
    const roadMap = new THREE.CanvasTexture(roadCanvas);
    roadMap.colorSpace = THREE.SRGBColorSpace;
    roadMap.wrapS = roadMap.wrapT = THREE.RepeatWrapping;
    roadMap.repeat.set(0.18, 0.18);
    roadMap.anisotropy = 8;
    textures.push(roadMap);
    const roadMat = new THREE.MeshStandardMaterial({
      map: roadMap,
      bumpMap: roadMap,
      bumpScale: 0.025,
      roughness: 0.92,
    });
    materials.push(roadMat);
    const shape = new THREE.Shape(),
      hole = new THREE.Path();
    shape.absellipse(0, 0, 37, 23, 0, Math.PI * 2, false, 0);
    hole.absellipse(0, 0, 27, 13, 0, Math.PI * 2, true, 0);
    shape.holes.push(hole);
    const asphalt = make(
      new THREE.ShapeGeometry(shape, 128),
      roadMat,
      [0, 0.02, 0],
    );
    asphalt.rotation.x = -Math.PI / 2;
    circle(37, 23);
    circle(27, 13);
    // A rubbered-in racing line, safety barriers and trackside catch fencing.
    for (let lane = 0; lane < 9; lane++) {
      const skid = circle(31 + lane * 0.17, 17 + lane * 0.17, 0, 0, "#303236");
      skid.material.transparent = true;
      skid.material.opacity = 0.16;
    }
    for (let i = 0; i < 100; i++) {
      const a = (i / 100) * Math.PI * 2,
        b = ((i + 1) / 100) * Math.PI * 2;
      for (const y of [0.5, 0.85, 1.2])
        rod(
          [Math.cos(a) * 39, y, Math.sin(a) * 25],
          [Math.cos(b) * 39, y, Math.sin(b) * 25],
          0.07,
          trim,
        );
      rod(
        [Math.cos(a) * 39, 0, Math.sin(a) * 25],
        [Math.cos(a) * 39, 3, Math.sin(a) * 25],
        0.035,
        trim,
      );
      if (i % 5 === 0)
        for (const y of [1.7, 2.3, 2.9])
          line(
            [
              [Math.cos(a) * 39, y, Math.sin(a) * 25],
              [Math.cos(a + 0.3) * 39, y, Math.sin(a + 0.3) * 25],
            ],
            "#757b7e",
          );
    }
    for (let i = 0; i < 160; i++) {
      const a = (i / 160) * Math.PI * 2;
      const kerb = box(
        [1.3, 0.11, 0.7],
        [Math.cos(a) * 27, 0.05, Math.sin(a) * 13],
        i % 2 ? white : material("#d25b4f"),
      );
      kerb.rotation.y = -Math.atan2(13 * Math.cos(a), -27 * Math.sin(a));
    }
    for (let i = 0; i < 10; i++)
      for (let j = 0; j < 2; j++)
        box(
          [1, 0.025, 0.6],
          [27.5 + i, 0.09, j * 0.6],
          (i + j) % 2 ? dark : white,
        );
    box([14, 1, 5], [0, 0.5, 0], dark);
    box([14, 0.4, 5], [0, 4, 0], trim);
    for (const x of [-6, 6]) rod([x, 1, 0], [x, 4, 0], 0.16, trim);
    for (let team = 0; team < 4; team++) {
      const car = new THREE.Group();
      scene.add(car);
      const paint = new THREE.MeshPhysicalMaterial({
        color: sport.colors[team],
        roughness: 0.27,
        metalness: 0.4,
        clearcoat: 1,
        clearcoatRoughness: 0.16,
      });
      materials.push(paint);
      const carbon = material("#111216", 0.52, 0.25),
        rubber = material("#18191b", 0.95),
        alloy = material("#969a9f", 0.28, 0.9);
      const smooth = (s: V3, p: V3, m: THREE.Material) =>
        make(new RoundedBoxGeometry(...s, 3, 0.07), m, p, car);
      smooth([1.3, 0.2, 3.4], [0, 0.25, -0.25], carbon);
      const body = sphere(0.7, [0, 0.58, -0.55], paint, car);
      body.scale.set(0.7, 0.58, 2.3);
      const nose = make(
        new THREE.CylinderGeometry(0.16, 0.32, 1.8, 20),
        paint,
        [0, 0.45, 1.15],
        car,
      );
      nose.rotation.x = Math.PI / 2;
      for (const side of [-1, 1]) {
        smooth([0.48, 0.46, 1.7], [side * 0.64, 0.54, -0.55], paint);
        smooth([0.4, 0.22, 0.12], [side * 0.65, 0.65, 0.3], carbon);
        smooth([0.08, 0.45, 0.6], [side * 1.03, 0.47, 2.15], paint);
        smooth([0.07, 0.55, 0.7], [side * 0.94, 0.9, -1.9], paint);
        for (const z of [-1.35, 1.35]) {
          rod(
            [side * 0.32, 0.4, z - 0.3],
            [side * 0.9, 0.44, z],
            0.032,
            carbon,
            car,
          );
          rod(
            [side * 0.32, 0.4, z + 0.3],
            [side * 0.9, 0.44, z],
            0.032,
            carbon,
            car,
          );
          rod(
            [side * 0.26, 0.65, z],
            [side * 0.9, 0.44, z],
            0.027,
            carbon,
            car,
          );
        }
      }
      for (let blade = 0; blade < 4; blade++) {
        smooth(
          [2, 0.035, 0.13],
          [0, 0.27 + blade * 0.042, 2.35 - blade * 0.13],
          blade % 2 ? paint : carbon,
        );
        smooth(
          [1.86, 0.055, 0.2],
          [0, 1.02 + blade * 0.05, -1.8 - blade * 0.09],
          paint,
        );
      }
      const cockpit = sphere(0.36, [0, 0.79, -0.15], carbon, car);
      cockpit.scale.set(0.73, 0.22, 1.25);
      const helmet = sphere(
        0.18,
        [0, 0.91, -0.2],
        material("#e6e3d3", 0.22, 0.2),
        car,
      );
      const visor = sphere(
        0.185,
        [0, 0.92, -0.18],
        material("#152531", 0.12, 0.72),
        car,
      );
      visor.scale.set(0.98, 0.32, 1);
      const halo = make(
        new THREE.TorusGeometry(0.29, 0.025, 8, 32, Math.PI * 1.55),
        carbon,
        [0, 1.04, -0.05],
        car,
      );
      halo.rotation.x = Math.PI / 2;
      halo.scale.y = 1.45;
      rod([0, 0.69, 0.42], [0, 1.04, 0.28], 0.025, carbon, car);
      smooth([0.12, 0.44, 0.25], [0, 0.86, -0.86], paint);
      for (const x of [-0.96, 0.96])
        for (const z of [-1.35, 1.35]) {
          const wheel = make(
            new THREE.CylinderGeometry(0.39, 0.39, 0.4, 32),
            rubber,
            [x, 0.4, z],
            car,
          );
          wheel.rotation.z = Math.PI / 2;
          const hub = make(
            new THREE.CylinderGeometry(0.21, 0.21, 0.415, 20),
            alloy,
            [x, 0.4, z],
            car,
          );
          hub.rotation.z = Math.PI / 2;
          const tireStripe = make(
            new THREE.TorusGeometry(0.29, 0.012, 6, 32),
            material("#d7b94a"),
            [x + Math.sign(x) * 0.208, 0.4, z],
            car,
          );
          tireStripe.rotation.y = Math.PI / 2;
          const cap = sphere(
            0.1,
            [x + Math.sign(x) * 0.214, 0.4, z],
            carbon,
            car,
          );
          cap.scale.x = 0.15;
        }
      const decalCanvas = textureCanvas(128, 64),
        dc = decalCanvas.getContext("2d")!;
      dc.fillStyle = sport.colors[team];
      dc.fillRect(0, 0, 128, 64);
      dc.font = "bold 38px Arial";
      dc.textAlign = "center";
      dc.fillStyle = "#10181d";
      dc.fillText(String(team + 1).padStart(2, "0"), 64, 47);
      const decal = new THREE.CanvasTexture(decalCanvas);
      decal.colorSpace = THREE.SRGBColorSpace;
      textures.push(decal);
      const dm = new THREE.MeshStandardMaterial({ map: decal });
      materials.push(dm);
      const number = make(
        new THREE.PlaneGeometry(0.35, 0.25),
        dm,
        [0, 0.68, 1.05],
        car,
      );
      number.rotation.x = -Math.PI / 2;
      cars.push(car);
    }
  }
  const ball = sphere(
    sport.id === "basketball"
      ? 0.125
      : sport.id === "tennis"
        ? 0.04
        : sport.id === "cricket"
          ? 0.04
          : 0.115,
    [0, 0.3, 0],
    material(
      sport.id === "basketball"
        ? "#d88430"
        : sport.id === "tennis"
          ? "#dfed4d"
          : sport.id === "cricket"
            ? "#f4474e"
            : "#f1eee4",
    ),
  );
  if (sport.id === "formula") ball.visible = false;
  if (sport.id === "football")
    for (let i = 0; i < 6; i++) {
      const patch = box([0.055, 0.009, 0.05], [0, 0, 0], dark, ball);
      patch.position.set(Math.sin(i) * 0.105, Math.cos(i) * 0.105, 0);
      patch.lookAt(0, 0, 0);
    }
  if (sport.id === "basketball")
    for (let i = 0; i < 3; i++) {
      const seam = make(
        new THREE.TorusGeometry(0.127, 0.003, 4, 32),
        dark,
        [0, 0, 0],
        ball,
      );
      seam.rotation.set((i * Math.PI) / 2, i === 2 ? Math.PI / 2 : 0, 0);
    }
  const shadow = make(
    new THREE.CircleGeometry(
      sport.id === "cricket" || sport.id === "tennis" ? 0.045 : 0.12,
      24,
    ),
    new THREE.MeshBasicMaterial({
      color: "#10221b",
      transparent: true,
      opacity: 0.25,
    }),
    [0, 0.11, 0],
  );
  materials.push(shadow.material);
  shadow.rotation.x = -Math.PI / 2;
  let raf = 0,
    disposed = false;
  const started = performance.now();
  let lastFrame = started;
  const look = new THREE.Vector3(0, 0, 0),
    desired = new THREE.Vector3();
  const resize = () => {
    const w = host.clientWidth,
      h = host.clientHeight;
    renderer.setSize(w, h);
    camera.aspect = w / Math.max(h, 1);
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  resize();
  let first = true;
  const animate = () => {
    if (disposed) return;
    const { round, time, camera: mode } = read();
    const frameNow = performance.now(),
      dt = Math.min(0.05, (frameNow - lastFrame) / 1000);
    lastFrame = frameNow;
    const t = (performance.now() - started) / 1000,
      live = round?.phase === "live";
    const matchTime = round ? Math.max(0, (time - round.closes) / 1000) : 0;
    const progress = Math.min(1, matchTime / 43),
      event = round?.events.at(-1),
      since = event ? matchTime - event.at / 1000 : 99;
    const active = live ? matchTime : t * 0.12,
      direction = event?.team === 1 ? -1 : 1;
    const scale =
      sport.id === "football" ||
      sport.id === "cricket" ||
      sport.id === "formula"
        ? 1
        : 0.68;
    const follow = new THREE.Vector3(
      ball.position.x * 0.65,
      0.75,
      ball.position.z * 0.25,
    );
    if (sport.id === "cricket") follow.set(0, 1, 6.5);
    if (sport.id === "tennis") follow.set(0, 0.6, 0);
    if (sport.id === "formula") {
      follow.set(0, 0, 0);
      cars.forEach((c) => follow.add(c.position));
      follow.multiplyScalar(1 / Math.max(cars.length, 1)).setY(0.7);
    }
    const mobileZoom = camera.aspect < 1.35 ? 1.3 : 1;
    if (mode === "overhead") {
      desired.set(1, 85 * scale, 5);
      follow.set(0, 0, 0);
    } else if (mode === "cinematic") {
      desired.set(
        follow.x + Math.sin(t * 0.075) * 23 * scale,
        8 * scale,
        follow.z + Math.cos(t * 0.075) * 25 * scale,
      );
    } else if (sport.id === "tennis")
      desired.set(-24 * mobileZoom, 10 * mobileZoom, 5);
    else if (sport.id === "cricket")
      desired.set(1.1, 4.5 * mobileZoom, -23 * mobileZoom);
    else if (sport.id === "formula")
      desired.set(follow.x + 16, 9, follow.z + 24 * mobileZoom);
    else
      desired.set(
        follow.x + 3,
        18 * scale * mobileZoom,
        40 * scale * mobileZoom,
      );
    camera.position.lerp(desired, first ? 1 : 1 - Math.exp(-dt * 2));
    look.lerp(follow, first ? 1 : 1 - Math.exp(-dt * 2.4));
    camera.lookAt(look);
    first = false;
    for (let i = 0; i < athletes.length; i++) {
      const a = athletes[i],
        speed = live ? 1 : 0,
        f = active * 2.8 + i * 1.8;
      if (sport.id === "cricket") {
        const batting = event?.team ?? 0;
        a.shirt.color.set(sport.colors[i < 2 ? batting : 1 - batting]);
        a.kit.color.copy(a.shirt.color);
      }
      let x = a.home[0],
        z = a.home[2];
      if (sport.id === "tennis") {
        z = Math.sin(active * 1.7 + i * Math.PI) * 3.7;
        x += Math.sin(active * 0.9) * 0.65;
      } else if (sport.id === "cricket") {
        if (i === 2) z += Math.sin(active * 2) * 2;
        else if (i > 3) {
          x += Math.sin(active + i) * 0.8;
          z += Math.cos(active + i) * 0.8;
        }
      } else {
        x +=
          Math.sin(active * 0.65 + i) *
          (sport.id === "football" ? 3 : 1.8) *
          speed;
        z += Math.cos(active * 0.9 + i) * 1.4 * speed;
      }
      a.group.position.set(x, 0, z);
      const velocity =
        a.group.position.distanceTo(a.previous) / Math.max(dt, 0.001);
      const running = live ? Math.min(1, velocity / 1.6) : 0;
      a.run.setEffectiveWeight(running);
      a.idle.setEffectiveWeight(1 - running);
      a.run.setEffectiveTimeScale(Math.max(0.65, Math.min(1.6, velocity / 2)));
      a.mixer.update(dt);
      const motion = a.group.position.clone().sub(a.previous);
      const heading =
        sport.id === "tennis"
          ? a.team
            ? -Math.PI / 2
            : Math.PI / 2
          : Math.atan2(ball.position.x - x, ball.position.z - z);
      const facing =
        sport.id === "football" && running > 0.3
          ? Math.atan2(motion.x, motion.z)
          : heading;
      const turn = Math.atan2(
        Math.sin(facing - a.group.rotation.y),
        Math.cos(facing - a.group.rotation.y),
      );
      a.group.rotation.y += turn * Math.min(1, dt * 9);
      a.previous.copy(a.group.position);
      a.strike.setEffectiveWeight(
        sport.id === "football" &&
          live &&
          since < 0.8 &&
          event?.team === a.team &&
          i % 5 === 0
          ? 0.6
          : 0,
      );
      if (live && a.arms.length === 4) {
        if (sport.id === "tennis") {
          const swing = Math.max(
            0,
            Math.sin((active / 1.4) * Math.PI + i * Math.PI),
          );
          a.arms[1].rotateX(-0.8 * swing);
          a.arms[1].rotateZ(-0.55 * swing);
          a.arms[3].rotateY(swing * 0.7);
        } else if (sport.id === "cricket") {
          const bowl = (active % 3) / 3;
          if (i === 2) {
            a.arms[1].rotateX(-Math.PI * 2 * bowl);
          }
          if (i === 0) {
            const hit = Math.max(0, Math.sin((bowl - 0.4) * Math.PI * 2));
            a.arms[1].rotateX(-hit * 1.4);
            a.arms[0].rotateX(-hit * 0.9);
          }
        } else if (
          sport.id === "basketball" &&
          event?.team === a.team &&
          i % 5 === 0 &&
          since < 1.8
        ) {
          const shoot = Math.sin(Math.min(1, since / 1.8) * Math.PI);
          a.arms[0].rotateX(-shoot * 2);
          a.arms[1].rotateX(-shoot * 2);
        }
      }
    }
    if (sport.id === "football") {
      const flight = Math.min(1, Math.max(0, since / 1.9));
      if (live && since < 2.7)
        ball.position.set(
          direction * (12 + flight * 20),
          0.3 + Math.sin(flight * Math.PI) * 3,
          Math.sin(active) * 2,
        );
      else {
        const pattern = [5, 7, 9, 18, 16, 20, 10, 8];
        const pass = active / 2.4,
          index = Math.floor(pass),
          blend = THREE.MathUtils.smoothstep(pass % 1, 0.15, 0.85);
        const from = athletes[pattern[index % pattern.length]].group.position,
          to = athletes[pattern[(index + 1) % pattern.length]].group.position;
        ball.position.copy(from).lerp(to, blend);
        ball.position.y = 0.12 + Math.sin(blend * Math.PI) * 0.16;
      }
    } else if (sport.id === "basketball") {
      const flight = Math.min(1, Math.max(0, since / 1.8));
      if (live && since < 2.2)
        ball.position.set(
          direction * (4 + flight * 7.4),
          1.5 + (3.05 - 1.5) * flight + Math.sin(flight * Math.PI) * 5,
          0,
        );
      else {
        const carrier =
          athletes[Math.floor(active / 4) % athletes.length].group.position;
        ball.position.set(
          carrier.x + 0.4,
          0.25 + Math.abs(Math.sin(active * 6)) * 1.05,
          carrier.z + 0.3,
        );
      }
    } else if (sport.id === "tennis") {
      const rally = active / 1.4,
        phase = rally % 1,
        server = Math.floor(rally) % 2;
      const from = athletes[server].group.position,
        to = athletes[1 - server].group.position;
      ball.position.copy(from).lerp(to, phase);
      ball.position.y = 0.55 + Math.sin(phase * Math.PI) * 1.3;
    } else if (sport.id === "cricket") {
      const f = (active % 3) / 3;
      if (f < 0.55)
        ball.position.set(
          0.1,
          0.4 + Math.sin(f * Math.PI * 2) * 0.6,
          -12 + (f / 0.55) * 19,
        );
      else
        ball.position.set(
          (f - 0.55) * 40,
          0.4 + Math.sin(((f - 0.55) / 0.45) * Math.PI) * 7,
          7 - (f - 0.55) * 55,
        );
    }
    if (!live && sport.id !== "formula")
      ball.position.set(
        0,
        sport.id === "football" || sport.id === "basketball" ? 0.13 : 0.05,
        0,
      );
    ball.rotation.x = t * 2;
    ball.rotation.z = t;
    shadow.position.set(ball.position.x, 0.11, ball.position.z);
    shadow.visible = ball.visible;
    cars.forEach((car, i) => {
      const order = round?.order ?? [0, 1, 2, 3],
        rank = order.indexOf(i),
        lanes = 16.5 + i * 0.9;
      // Progress to the server's reported lap order; the final leader agrees with the race result.
      const p = live ? progress : round?.phase === "result" ? 1 : 0;
      const angle = p * Math.PI * 6 - rank * 0.18;
      car.position.set(Math.cos(angle) * 32, 0.05, Math.sin(angle) * lanes);
      car.rotation.y = Math.atan2(
        -32 * Math.sin(angle),
        lanes * Math.cos(angle),
      );
    });
    renderer.render(scene, camera);
    host.dataset.athletes = String(athletes.length);
    host.dataset.vehicles = String(cars.length);
    host.dataset.triangles = String(renderer.info.render.triangles);
    onReady();
    raf = requestAnimationFrame(animate);
  };
  animate();
  const lost = (e: Event) => {
    e.preventDefault();
  };
  renderer.domElement.addEventListener("webglcontextlost", lost);
  return () => {
    disposed = true;
    cancelAnimationFrame(raf);
    ro.disconnect();
    renderer.domElement.removeEventListener("webglcontextlost", lost);
    scene.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Line)
        o.geometry.dispose();
    });
    materials.forEach((m) => m.dispose());
    textures.forEach((t) => t.dispose());
    athletes.forEach((a) => {
      a.mixer.stopAllAction();
      a.mixer.uncacheRoot(a.mixer.getRoot());
    });
    assets.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    renderer.domElement.remove();
  };
}

function LegacySportsScene({
  sport,
  round,
  time,
  camera,
  quality,
}: {
  sport: Sport;
  round?: Round;
  time: number;
  camera: string;
  quality: string;
}) {
  const host = useRef<HTMLDivElement>(null),
    state = useRef({ round, time, camera, sampledAt: performance.now() });
  state.current = { round, time, camera, sampledAt: performance.now() };
  const [error, setError] = useState(false),
    [ready, setReady] = useState(false);
  useEffect(() => {
    setError(false);
    setReady(false);
    let reported = false;
    let cancelled = false,
      cleanup: (() => void) | undefined;
    loadBroadcastAssets(sport.id !== "formula", sport.id === "football")
      .then((assets) => {
        if (cancelled) {
          assets.dispose();
          return;
        }
        try {
          cleanup = (sport.id === "football" ? buildFootballScene : buildScene)(
            host.current!,
            sport,
            quality,
            assets,
            // Interpolate the server clock on every animation frame rather than
            // moving players only when React's countdown timer refreshes.
            () => ({
              ...state.current,
              time:
                state.current.time +
                performance.now() -
                state.current.sampledAt,
            }),
            () => {
              if (!reported) {
                reported = true;
                setReady(true);
              }
            },
          );
        } catch (e) {
          assets.dispose();
          throw e;
        }
      })
      .catch((e) => {
        if (!cancelled) {
          console.error(e);
          setError(true);
        }
      });
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [sport, quality]);
  return (
    <div
      className="vs-scene-host"
      ref={host}
      data-testid="sports-scene"
      data-ready={ready}
    >
      {!ready && !error && (
        <div className="vs-scene-loading">Preparing {sport.venue}…</div>
      )}
      {error && (
        <div className="vs-scene-loading">
          3D is unavailable on this device. Match scores and betting remain
          available.
        </div>
      )}
    </div>
  );
}

export default function SportsScene(props: SportsSceneProps) {
  const [unityAvailable, setUnityAvailable] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/unity-sports/ready.json", {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        if (
          !response.ok ||
          !response.headers.get("content-type")?.includes("application/json")
        )
          return;
        const manifest = await response.json();
        if (
          manifest.engine === "unity" &&
          Array.isArray(manifest.sports) &&
          manifest.sports.length === 5
        )
          setUnityAvailable(true);
      })
      .catch(() => {
        /* Existing renderer remains available until a successful Unity build is deployed. */
      });
    return () => controller.abort();
  }, []);
  return unityAvailable ? (
    <UnitySportsScene {...props} />
  ) : (
    <LegacySportsScene {...props} />
  );
}
