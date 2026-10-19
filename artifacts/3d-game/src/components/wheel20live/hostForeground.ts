export type HostFormat = "packed" | "green";

/** Decode colour and alpha together, then composite on the GPU. No per-frame
 * pixel readback or main-thread loop on the normal playback path. */
export function createHostForeground(studio: HTMLElement, light = false) {
  let canvas = document.createElement("canvas");
  let gl = canvas.getContext("webgl", {
    alpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: true,
    preserveDrawingBuffer: false,
  });
  let program: WebGLProgram | null = null;
  let texture: WebGLTexture | null = null;
  let buffer: WebGLBuffer | null = null;
  let formatLocation: WebGLUniformLocation | null = null;
  const shaders: WebGLShader[] = [];
  const setup = () => {
    if (!gl) return;
    const shader = (type: number, source: string) => {
      const s = gl!.createShader(type)!;
      shaders.push(s);
      gl!.shaderSource(s, source);
      gl!.compileShader(s);
      if (!gl!.getShaderParameter(s, gl!.COMPILE_STATUS))
        throw new Error("Host shader unavailable");
      return s;
    };
    program = gl.createProgram()!;
    gl.attachShader(
      program,
      shader(
        gl.VERTEX_SHADER,
        `
      attribute vec2 position;
      varying vec2 uv;
      void main() {
        uv = vec2((position.x + 1.0) * 0.5, (1.0 - position.y) * 0.5);
        gl_Position = vec4(position, 0.0, 1.0);
      }`,
      ),
    );
    gl.attachShader(
      program,
      shader(
        gl.FRAGMENT_SHADER,
        `
      precision mediump float;
      varying vec2 uv;
      uniform sampler2D film;
      uniform float green;
      void main() {
        vec3 rgb = texture2D(film, vec2(uv.x, uv.y * mix(0.8, 1.0, green))).rgb;
        float alpha;
        if (green > 0.5) {
          float spill = rgb.g - max(rgb.r, rgb.b);
          alpha = 1.0 - smoothstep(0.06, 0.24, spill);
          rgb.g = min(rgb.g, max(rgb.r, rgb.b));
        } else {
          float matte = texture2D(film, vec2(uv.x, 0.8 + uv.y * 0.2)).r;
          alpha = smoothstep(0.094, 0.922, matte);
        }
        gl_FragColor = vec4(rgb * alpha, alpha);
      }`,
      ),
    );
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      throw new Error("Host program unavailable");
    gl.useProgram(program);
    buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW,
    );
    const position = gl.getAttribLocation(program, "position");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.uniform1i(gl.getUniformLocation(program, "film"), 0);
    formatLocation = gl.getUniformLocation(program, "green");
  };
  const release = () => {
    if (!gl) return;
    gl.deleteTexture(texture);
    gl.deleteBuffer(buffer);
    gl.deleteProgram(program);
    shaders.forEach((s) => gl!.deleteShader(s));
    shaders.length = 0;
  };
  try {
    setup();
  } catch {
    release();
    gl = null;
    canvas = document.createElement("canvas");
  }
  canvas.className = "w20-host-foreground";
  canvas.width = gl ? (light ? 960 : 1280) : 480;
  canvas.height = (canvas.width * 9) / 16;
  canvas.hidden = true;
  canvas.setAttribute("aria-hidden", "true");
  canvas.dataset.renderer = gl ? "webgl" : "canvas";
  const context = gl
    ? null
    : canvas.getContext("2d", { willReadFrequently: true });
  const matte = document.createElement("canvas");
  matte.width = canvas.width;
  matte.height = canvas.height;
  const mask = gl ? null : matte.getContext("2d", { willReadFrequently: true });
  studio.append(canvas);
  let lastVideo: HTMLVideoElement | null = null;
  let lastTime = -1;
  let lastPaint = 0;
  const lost = (event: Event) => {
    event.preventDefault();
    canvas.hidden = true;
  };
  const restored = () => {
    shaders.length = 0;
    setup();
    lastTime = -1;
  };
  canvas.addEventListener("webglcontextlost", lost);
  canvas.addEventListener("webglcontextrestored", restored);
  return {
    hide() {
      canvas.hidden = true;
    },
    draw(video: HTMLVideoElement, time: number, format: HostFormat = "packed") {
      if (!video.videoWidth || (gl && gl.isContextLost())) return;
      if (lastVideo === video && lastTime === time && !canvas.hidden) return;
      const now = performance.now();
      if (!gl && lastVideo === video && !canvas.hidden && now - lastPaint < 66)
        return;
      lastVideo = video;
      lastTime = time;
      lastPaint = now;
      const { width, height } = canvas;
      if (gl) {
        gl.viewport(0, 0, width, height);
        gl.uniform1f(formatLocation, format === "green" ? 1 : 0);
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          video,
        );
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      } else if (context && mask) {
        const rgbHeight = video.videoHeight * (format === "packed" ? 0.8 : 1);
        context.drawImage(
          video,
          0,
          0,
          video.videoWidth,
          rgbHeight,
          0,
          0,
          width,
          height,
        );
        const pixels = context.getImageData(0, 0, width, height);
        let alpha: Uint8ClampedArray | undefined;
        if (format === "packed") {
          mask.drawImage(
            video,
            0,
            rgbHeight,
            video.videoWidth,
            video.videoHeight - rgbHeight,
            0,
            0,
            width,
            height,
          );
          alpha = mask.getImageData(0, 0, width, height).data;
        }
        for (let i = 0; i < pixels.data.length; i += 4) {
          const data = pixels.data;
          const value = alpha
            ? alpha[i] / 255
            : 1 - (data[i + 1] - Math.max(data[i], data[i + 2]) - 15.3) / 45.9;
          data[i + 3] = alpha
            ? value < 0.094
              ? 0
              : value > 0.922
                ? 255
                : value * 255
            : Math.max(0, Math.min(1, value)) * 255;
          if (!alpha)
            data[i + 1] = Math.min(
              data[i + 1],
              Math.max(data[i], data[i + 2]),
            );
        }
        context.putImageData(pixels, 0, 0);
      }
      canvas.dataset.frameTime = time.toFixed(3);
      canvas.dataset.format = format;
      canvas.hidden = false;
    },
    dispose() {
      release();
      canvas.removeEventListener("webglcontextlost", lost);
      canvas.removeEventListener("webglcontextrestored", restored);
      canvas.remove();
    },
  };
}
