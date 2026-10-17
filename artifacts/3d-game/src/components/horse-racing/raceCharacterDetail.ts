import * as THREE from "three";

/** Store the actual skinned rest positions, not the imported mesh/bind units. */
export function characterRestSpace(root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  const inverse = root.matrixWorld.clone().invert();
  const point = new THREE.Vector3();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    if (object.geometry.hasAttribute("raceRest")) return;
    if (object instanceof THREE.SkinnedMesh) object.skeleton.update();
    const transform = new THREE.Matrix4().multiplyMatrices(
      inverse,
      object.matrixWorld,
    );
    const values = new Float32Array(
      object.geometry.attributes.position.count * 3,
    );
    for (let i = 0; i < values.length / 3; i++) {
      object
        .getVertexPosition(i, point)
        .applyMatrix4(transform)
        .toArray(values, i * 3);
    }
    object.geometry.setAttribute(
      "raceRest",
      new THREE.BufferAttribute(values, 3),
    );
  });
}

export const racewearAccents = [
  "#eeeadd",
  "#22251e",
  "#f0e8d8",
  "#23394e",
  "#e8d9ad",
  "#2c2536",
  "#f2eee1",
  "#d7ba74",
];

const skinTints = [
  "#e8c4a7",
  "#c49470",
  "#eccbb6",
  "#ac7956",
  "#dbc2ac",
  "#cba384",
  "#efd3bd",
  "#bd9478",
];

/** Eight tailored uniforms retain the same runner colours used by the UI. */
export function dressRider(rider: THREE.Object3D, id: number, color: string) {
  const primary = new THREE.Color(color),
    accent = new THREE.Color(racewearAccents[id - 1]);
  const skin = new THREE.Color(skinTints[id - 1]);
  const materials = new Map<THREE.Material, THREE.MeshStandardMaterial>();
  rider.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    o.frustumCulled = false;
    o.castShadow = o.receiveShadow = true;
    const source = o.material as THREE.MeshStandardMaterial;
    const isSilk = source.name === "RaceSilk";
    const m =
      materials.get(source) ??
      (isSilk
        ? new THREE.MeshPhysicalMaterial({
            name: "RaceSilk",
            color: "#ffffff",
            normalMap: source.normalMap,
            roughness: 0.51,
            sheen: 0.24,
            sheenRoughness: 0.7,
            sheenColor: primary,
            specularIntensity: 0.32,
          })
        : source.clone());
    materials.set(source, m);
    o.material = m;
    if (isSilk) {
      m.normalScale.setScalar(0.24);
      m.onBeforeCompile = (shader) => {
        shader.uniforms.silkPrimary = { value: primary };
        shader.uniforms.silkAccent = { value: accent };
        shader.uniforms.silkStyle = { value: id };
        shader.vertexShader =
          `attribute vec3 raceRest; varying vec3 silkP;\n${shader.vertexShader}`.replace(
            "#include <begin_vertex>",
            "#include <begin_vertex>\nsilkP=raceRest;",
          );
        shader.fragmentShader =
          `uniform vec3 silkPrimary, silkAccent; uniform float silkStyle; varying vec3 silkP;\n${shader.fragmentShader}`.replace(
            "#include <map_fragment>",
            `#include <map_fragment>
            float x=silkP.x, z=silkP.z;
            float aa=max(fwidth(x)+fwidth(z),.0015);
            float pattern=0.;
            if(silkStyle<1.5) {
              float chevron=min(abs(z-(.32+abs(x)*.95)),abs(z-(.49+abs(x)*.95)));
              pattern=1.-smoothstep(.034-aa,.034+aa,chevron);
            } else if(silkStyle<2.5) {
              pattern=1.-smoothstep(.065-aa,.065+aa,abs(z-.42-x*1.6));
            } else if(silkStyle<3.5) {
              vec2 diamonds=abs(fract(vec2(x*7.,z*5.5))-.5);
              pattern=1.-smoothstep(.29-aa*7.,.29+aa*7.,diamonds.x+diamonds.y);
            } else if(silkStyle<4.5) {
              pattern=max(smoothstep(.18-aa,.18+aa,abs(x)),1.-smoothstep(.043-aa,.043+aa,abs(z-.42)));
            } else if(silkStyle<5.5) {
              pattern=1.-smoothstep(.060-aa,.060+aa,abs(x));
            } else if(silkStyle<6.5) {
              pattern=smoothstep(-aa,aa,x*(z-.42));
            } else if(silkStyle<7.5) {
              pattern=1.-smoothstep(.038-aa,.038+aa,min(abs(z-.3),abs(z-.52)));
            } else {
              float chevron=abs(z-(.41+abs(x)*1.35));
              pattern=1.-smoothstep(.060-aa,.060+aa,chevron);
            }
            // Solid contrast cuffs and subtle underarm panels ground the graphic
            // in sewn racing silks, instead of painting triangles on the model.
            float cuff=smoothstep(.19,.23,abs(x))*smoothstep(.79,.86,z);
            pattern=max(pattern,cuff);
            diffuseColor.rgb *= mix(silkPrimary,silkAccent,clamp(pattern,0.,1.));
            float seam=1.-smoothstep(.002,.006,abs(abs(x)-.205));
            diffuseColor.rgb *= 1.-seam*.10;
          `,
          );
      };
      m.customProgramCacheKey = () => "tailored-race-silks-v2";
    } else if (m.name === "VitPants") {
      m.color.set(id === 2 || id === 7 ? "#d5cbb7" : "#dedbd2");
      m.roughness = 0.83;
      m.normalScale.setScalar(0.16);
    } else if (m.name === "VitSkin" || m.name === "VitBody") {
      m.color.copy(skin);
      m.roughness = 0.61;
      m.normalScale.setScalar(0.48);
      if (m.name === "VitSkin") {
        // Modest facial proportions provide individual human faces while the
        // eye positions and mounted skeleton remain compatible with the gear.
        const geometry = o.geometry.clone();
        const p = geometry.attributes.position;
        const rest = geometry.attributes.raceRest;
        const width = [1, 0.96, 1.025, 0.975, 1.015, 0.955, 1.02, 0.99][id - 1];
        const restToLocal = new THREE.Matrix4().multiplyMatrices(
          o.matrixWorld.clone().invert(),
          rider.matrixWorld,
        );
        const directionToLocal = new THREE.Matrix3().setFromMatrix4(
          restToLocal,
        );
        const localShift = new THREE.Vector3();
        for (let i = 0; i < p.count; i++) {
          const y = rest.getY(i),
            x = rest.getX(i);
          const jaw =
            (1 - THREE.MathUtils.smoothstep(y, 3.03, 3.13)) *
            THREE.MathUtils.smoothstep(y, 2.88, 2.96);
          localShift
            .set(x * (width - 1) * jaw, 0, 0)
            .applyMatrix3(directionToLocal);
          p.setXYZ(
            i,
            p.getX(i) + localShift.x,
            p.getY(i) + localShift.y,
            p.getZ(i) + localShift.z,
          );
        }
        geometry.computeVertexNormals();
        o.geometry = geometry;
      }
    } else if (m.name === "RaceBootLeather" || m.name === "RaceGloves") {
      m.color.set(id === 2 || id === 7 ? "#33291f" : "#191b1c");
      m.roughness = m.name === "RaceGloves" ? 0.53 : 0.38;
      m.metalness = 0;
    }
  });
}
