import * as T from "three";

/** Original AI presenter footage, keyed in real time; it never contains game balls. */
export function createPresenter(scene: T.Scene, canvas: HTMLCanvasElement) {
  let disposed = false,
    playing = false,
    lastCue = "";
  const still = new T.TextureLoader().load(
    "/media/mega-ball/presenter-green.png",
  );
  const video = document.createElement("video");
  video.src = "/media/mega-ball/presenter-host.mp4";
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  video.preload = "auto";
  video.setAttribute("aria-hidden", "true");
  const movie = new T.VideoTexture(video);
  const material = new T.ShaderMaterial({
    uniforms: {
      plate: { value: still },
      lightTint: { value: new T.Vector3(1, 1, 1) },
    },
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    vertexShader: `varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader: `uniform sampler2D plate; uniform vec3 lightTint; varying vec2 vUv; void main(){vec4 c=texture2D(plate,vUv);float green=c.g-max(c.r,c.b);float a=1.-smoothstep(.10,.34,green);if(a<.015)discard;c.g=min(c.g,max(c.r,c.b)+.035);gl_FragColor=vec4(c.rgb*lightTint,a);}`,
  });
  const geometry = new T.PlaneGeometry(2.53, 4.5);
  const host = new T.Mesh(geometry, material);
  host.position.set(-3.45, 2, 0.35);
  scene.add(host);
  const ready = () => {
    if (!disposed) {
      material.uniforms.plate.value = movie;
      canvas.dataset.presenter = "animated";
    }
  };
  const failed = () => {
    if (!disposed) {
      material.uniforms.plate.value = still;
      canvas.dataset.presenter = "portrait";
    }
  };
  video.addEventListener("loadeddata", ready);
  video.addEventListener("error", failed);
  canvas.dataset.presenter = "portrait";
  return {
    update(motion: boolean, visible: boolean, cue = "", bonus = false) {
      material.uniforms.lightTint.value.lerp(
        new T.Vector3(bonus ? 0.94 : 1, bonus ? 0.93 : 1, bonus ? 1.035 : 1),
        0.07,
      );
      if (cue !== lastCue && video.readyState >= 1) {
        if (cue.endsWith(":multiplier-opening")) video.currentTime = 4;
        if (cue.endsWith(":result")) video.currentTime = 0;
        lastCue = cue;
      }
      const shouldPlay = motion && visible && !document.hidden;
      if (playing === shouldPlay) return;
      playing = shouldPlay;
      if (shouldPlay)
        void video.play().catch(() => {
          playing = false;
        });
      else video.pause();
    },
    dispose() {
      disposed = true;
      video.pause();
      video.removeEventListener("loadeddata", ready);
      video.removeEventListener("error", failed);
      video.removeAttribute("src");
      video.load();
      still.dispose();
      movie.dispose();
      geometry.dispose();
      material.dispose();
      scene.remove(host);
    },
  };
}
