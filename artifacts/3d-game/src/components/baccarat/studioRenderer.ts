import { cardFace } from "../andarbaharlive/cardFace";
import type { Quad } from "./studioTimeline";

export type StudioCard = { card: number; quad: Quad; winner?: boolean };
const FULL: Quad = [0, 0, 1200, 0, 1200, 480, 0, 480];
/** One hardware-decoded texture, no getImageData or CPU hand segmentation. */
export function createStudioRenderer(canvas: HTMLCanvasElement) {
  const gl = canvas.getContext("webgl", {
    alpha: false,
    antialias: true,
    depth: false,
    stencil: false,
    preserveDrawingBuffer: true,
    powerPreference: "high-performance",
  });
  if (!gl) throw new Error("Studio graphics unavailable");
  const shader = (kind: number, code: string) => {
    const s = gl.createShader(kind)!;
    gl.shaderSource(s, code);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
      throw new Error(gl.getShaderInfoLog(s) ?? "Studio shader failed");
    return s;
  };
  const vertex = shader(
    gl.VERTEX_SHADER,
    `attribute vec2 position; attribute vec2 uv; attribute float perspective; varying vec2 coord;
    void main(){coord=uv; vec2 p=position/vec2(1200.,480.); gl_Position=vec4((p*vec2(2.,-2.)+vec2(-1.,1.))*perspective,0.,perspective);}`,
  );
  const fragment = shader(
    gl.FRAGMENT_SHADER,
    `precision highp float;
    varying vec2 coord; uniform sampler2D video; uniform sampler2D plate; uniform sampler2D card;
    uniform int mode; uniform int sourceDealing; uniform float highlight;
    float patch(vec2 p,vec4 box){vec2 d=min(p-box.xy,box.zw-p);return clamp(min(d.x,d.y)/3.,0.,1.);}
    void main(){
      if(mode==2){vec4 ink=texture2D(card,coord);if(highlight>.5&&(min(min(coord.x,1.-coord.x),min(coord.y,1.-coord.y))<.018))ink.rgb=vec3(1.,.88,.59);gl_FragColor=ink;return;}
      if(mode==3){gl_FragColor=vec4(.04,.03,.02,.4);return;}
      vec2 p=coord*vec2(1200.,480.);vec2 local=p-vec2(390.,350.);
      // Hide every source card and countdown before drawing authoritative faces.
      float cardArea=max(patch(p,vec4(421.,416.,558.,477.)),patch(p,vec4(648.,408.,790.,477.)));
      float timerArea=patch(p,vec4(565.,394.,640.,477.));
      // The full table is visible above the dock; remove the recorded status
      // at its bottom edge as well, leaving the live round label to the UI.
      float sourceStatus=patch(p,vec4(520.,465.,686.,490.));
      float erased=max(sourceDealing==1?cardArea:timerArea,sourceStatus);
      if(mode==1){if(local.x<0.||local.x>=410.||local.y<0.||local.y>=130.)discard;
        float a=texture2D(video,(vec2(0.,480.)+local)/vec2(1200.,610.)).r;
        float foreground=max(cardArea,sourceDealing==0&&p.y<401.?timerArea:0.);
        gl_FragColor=vec4(texture2D(video,p/vec2(1200.,610.)).rgb,smoothstep(.04,.96,a)*foreground);return;}
      vec3 color=texture2D(video,p/vec2(1200.,610.)).rgb;
      color=mix(color,texture2D(plate,coord).rgb,erased);
      gl_FragColor=vec4(color,1.);
    }`,
  );
  const program = gl.createProgram()!;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS))
    throw new Error("Studio graphics program failed");
  gl.useProgram(program);
  const buffer = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  const position = gl.getAttribLocation(program, "position"),
    uv = gl.getAttribLocation(program, "uv"),
    perspective = gl.getAttribLocation(program, "perspective");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 20, 0);
  gl.enableVertexAttribArray(uv);
  gl.vertexAttribPointer(uv, 2, gl.FLOAT, false, 20, 8);
  gl.enableVertexAttribArray(perspective);
  gl.vertexAttribPointer(perspective, 1, gl.FLOAT, false, 20, 16);
  const texture = (unit: number) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array([0, 0, 0, 255]),
    );
    return t;
  };
  const sourceTexture = texture(0),
    plateTexture = texture(1),
    emptyCardTexture = texture(2);
  for (const [name, unit] of [
    ["video", 0],
    ["plate", 1],
    ["card", 2],
  ] as const)
    gl.uniform1i(gl.getUniformLocation(program, name), unit);
  const mode = gl.getUniformLocation(program, "mode"),
    highlight = gl.getUniformLocation(program, "highlight");
  const sourceDealing = gl.getUniformLocation(program, "sourceDealing");

  const data = new Float32Array(30),
    order = [0, 1, 2, 0, 2, 3],
    coords = [0, 0, 1, 0, 1, 1, 0, 1];
  const quad = (q: Quad) => {
    // Homogeneous vertex weights give both triangles one continuous plane.
    const dx1 = q[2] - q[4],
      dx2 = q[6] - q[4],
      dx3 = q[0] - q[2] + q[4] - q[6];
    const dy1 = q[3] - q[5],
      dy2 = q[7] - q[5],
      dy3 = q[1] - q[3] + q[5] - q[7];
    const det = dx1 * dy2 - dx2 * dy1;
    const g = Math.abs(det) > 0.001 ? (dx3 * dy2 - dx2 * dy3) / det : 0;
    const h = Math.abs(det) > 0.001 ? (dx1 * dy3 - dx3 * dy1) / det : 0;
    for (let i = 0; i < 6; i++) {
      const p = order[i];
      data[i * 5] = q[p * 2];
      data[i * 5 + 1] = q[p * 2 + 1];
      data[i * 5 + 2] = coords[p * 2];
      data[i * 5 + 3] = coords[p * 2 + 1];
      data[i * 5 + 4] = 1 + g * coords[p * 2] + h * coords[p * 2 + 1];
    }
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  };
  const faces = new Map<number, WebGLTexture>();
  // A card lies nearly flat on the table, so its texture is compressed much
  // more vertically than horizontally. Isotropic mipmaps blur the ranks.
  const anisotropy = gl.getExtension("EXT_texture_filter_anisotropic");
  const cardAnisotropy = anisotropy
    ? Math.min(8, gl.getParameter(anisotropy.MAX_TEXTURE_MAX_ANISOTROPY_EXT))
    : 1;
  const maxWidth = Math.min(3840, gl.getParameter(gl.MAX_RENDERBUFFER_SIZE));
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  let ready = false;
  return {
    resize(displayWidth: number) {
      // Keep recorded pixels at native resolution, but draw card edges and
      // ranks directly at the display's physical pixel density.
      const width = Math.min(maxWidth, Math.max(1200, Math.ceil(displayWidth)));
      const height = Math.round((width * 480) / 1200);
      if (canvas.width === width && canvas.height === height) return false;
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
      return true;
    },
    setPlate(img: HTMLImageElement) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, plateTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      ready = true;
    },
    render(video: HTMLVideoElement, cards: StudioCard[]) {
      if (!ready || video.videoHeight !== 610 || gl.isContextLost())
        return false;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video);
      gl.uniform1i(sourceDealing, video.currentTime >= 18.9 ? 1 : 0);
      gl.uniform1i(mode, 0);
      quad(FULL);
      for (const entry of cards) {
        let face = faces.get(entry.card);
        if (!face) {
          face = texture(2);
          gl.texImage2D(
            gl.TEXTURE_2D,
            0,
            gl.RGBA,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            cardFace(entry.card % 52),
          );
          gl.generateMipmap(gl.TEXTURE_2D);
          gl.texParameteri(
            gl.TEXTURE_2D,
            gl.TEXTURE_MIN_FILTER,
            gl.LINEAR_MIPMAP_LINEAR,
          );
          if (anisotropy)
            gl.texParameterf(
              gl.TEXTURE_2D,
              anisotropy.TEXTURE_MAX_ANISOTROPY_EXT,
              cardAnisotropy,
            );
          faces.set(entry.card, face);
        }
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, face);
        gl.uniform1i(mode, 3);
        quad(entry.quad.map((n, i) => n + (i % 2 ? 1.1 : 0)) as Quad);
        gl.uniform1i(mode, 2);
        gl.uniform1f(highlight, entry.winner ? 1 : 0);
        quad(entry.quad);
      }
      gl.uniform1i(mode, 1);
      quad(FULL);
      return true;
    },
    dispose() {
      for (const t of [
        sourceTexture,
        plateTexture,
        emptyCardTexture,
        ...faces.values(),
      ])
        gl.deleteTexture(t);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
    },
  };
}
