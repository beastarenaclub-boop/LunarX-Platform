import { cardFace } from "./cardFace";
import { recordedCardQuads, type Quad } from "./dealerTimeline";

export type StudioCard = { card: number; quad: Quad; winner?: boolean };
const FULL: Quad = [0, 0, 1430, 0, 1430, 610, 0, 610];
const VIEW: Quad = [0, 45, 1430, 45, 1430, 610, 0, 610];
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
    void main(){coord=uv; vec2 p=(position-vec2(0.,45.))/vec2(1430.,565.); gl_Position=vec4((p*vec2(2.,-2.)+vec2(-1.,1.))*perspective,0.,perspective);}`,
  );
  const fragment = shader(
    gl.FRAGMENT_SHADER,
    `precision highp float;
    varying vec2 coord; uniform sampler2D video; uniform sampler2D plate; uniform sampler2D card; uniform sampler2D previous;
    uniform int mode; uniform float highlight; uniform float dissolve;
    uniform vec4 cuts[6]; uniform vec4 covers[3];
    float patch(vec2 p,vec4 box){vec2 d=min(p-box.xy,box.zw-p);return clamp(min(d.x,d.y)/2.,0.,1.);}
    float edge(vec2 p,vec2 a,vec2 b){vec2 d=b-a;return (d.x*(p.y-a.y)-d.y*(p.x-a.x))/max(1.,length(d));}
    float paper(vec2 p,vec4 top,vec4 bottom){if(top.x<0.)return 0.;return clamp(min(min(edge(p,top.xy,top.zw),edge(p,top.zw,bottom.xy)),min(edge(p,bottom.xy,bottom.zw),edge(p,bottom.zw,top.xy)))+1.5,0.,1.);}
    void main(){
      if(mode==4){gl_FragColor=vec4(texture2D(previous,vec2(coord.x,1.-coord.y)).rgb,dissolve);return;}
      if(mode==2){vec4 ink=texture2D(card,coord); if(highlight>.5&&(min(min(coord.x,1.-coord.x),min(coord.y,1.-coord.y))<.018))ink.rgb=vec3(1.,.88,.59);gl_FragColor=ink;return;}
      if(mode==3){gl_FragColor=vec4(.16,.12,.06,.28);return;}
      vec2 p=coord*vec2(1430.,610.); vec2 local=p-vec2(690.,476.);
      bool area=local.x>=0.&&local.x<350.&&local.y>=0.&&local.y<134.;
      // Erase only recorded card footprints. The rest of the hand, cuff,
      // table texture and moving shadows stay in the original video pixels.
      float erased=max(max(paper(p,cuts[0],cuts[1]),paper(p,cuts[2],cuts[3])),max(paper(p,cuts[4],cuts[5]),max(patch(p,vec4(840.,537.,933.,598.)),patch(p,vec4(932.,508.,1025.,566.)))));
      float covered=max(erased,max(patch(p,covers[0]),max(patch(p,covers[1]),patch(p,covers[2]))));
      if(mode==1){if(!area||covered<=0.||(local.x>235.&&local.y>32.))discard;float a=texture2D(video,(vec2(0.,610.)+local)/vec2(1430.,744.)).r;
        gl_FragColor=vec4(texture2D(video,p/vec2(1430.,744.)).rgb,smoothstep(.04,.96,a)*covered);return;}
      vec2 source=p;if(source.x<20.)source.x=22.;vec3 color=texture2D(video,source/vec2(1430.,744.)).rgb;
      if(erased>0.)color=mix(color,texture2D(plate,coord).rgb,erased);
      if(p.x>=656.&&p.x<772.&&p.y>=582.)color=texture2D(plate,(p-vec2(120.,0.))/vec2(1430.,610.)).rgb;
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
    emptyCardTexture = texture(2),
    transitionTexture = texture(3);
  for (const [name, unit] of [
    ["video", 0],
    ["plate", 1],
    ["card", 2],
    ["previous", 3],
  ] as const)
    gl.uniform1i(gl.getUniformLocation(program, name), unit);
  const mode = gl.getUniformLocation(program, "mode"),
    highlight = gl.getUniformLocation(program, "highlight"),
    dissolve = gl.getUniformLocation(program, "dissolve");
  const cuts = gl.getUniformLocation(program, "cuts[0]"),
    covers = gl.getUniformLocation(program, "covers[0]");
  const data = new Float32Array(30),
    order = [0, 1, 2, 0, 2, 3],
    coords = [0, 0, 1, 0, 1, 1, 0, 1];
  gl.bufferData(gl.ARRAY_BUFFER, data.byteLength, gl.DYNAMIC_DRAW);
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
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);
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
  let ready = false,
    transitionAt = -Infinity;
  return {
    // Like Lucky 7, dissolve waiting-shot edits only. Card turns join at a
    // matched pose and never blend fingers or card faces during handling.
    beginWaitingTransition() {
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, transitionTexture);
      gl.copyTexImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGB,
        0,
        0,
        canvas.width,
        canvas.height,
        0,
      );
      transitionAt = performance.now();
    },
    resize(displayWidth: number) {
      // Keep recorded pixels at native resolution, but draw card edges and
      // ranks directly at the display's physical pixel density.
      const width = Math.min(maxWidth, Math.max(1430, Math.ceil(displayWidth)));
      const height = Math.round((width * 565) / 1430);
      if (canvas.width === width && canvas.height === height) return false;
      canvas.width = width;
      canvas.height = height;
      transitionAt = -Infinity;
      gl.viewport(0, 0, width, height);
      return true;
    },
    setPlate(img: HTMLImageElement) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, plateTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      ready = true;
    },
    render(
      video: HTMLVideoElement,
      cards: StudioCard[],
      decodedTime = video.currentTime,
    ) {
      if (!ready || video.videoHeight !== 744 || gl.isContextLost())
        return false;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video);
      gl.uniform4fv(
        cuts,
        new Float32Array(
          recordedCardQuads(decodedTime).flatMap(
            (q) => q ?? Array(8).fill(-1000),
          ),
        ),
      );
      const bounds = [
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
      ];
      for (const { quad: q } of cards) {
        const xs = [q[0], q[2], q[4], q[6]],
          ys = [q[1], q[3], q[5], q[7]];
        const at = q[0] > 820 ? 0 : q[1] < 530 ? 1 : 2;
        const b = bounds[at],
          x = Math.min(...xs) - 3,
          y = Math.min(...ys) - 3;
        bounds[at] = [
          b[0] ? Math.min(b[0], x) : x,
          b[1] ? Math.min(b[1], y) : y,
          Math.max(b[2], ...xs) + 3,
          Math.max(b[3], ...ys) + 3,
        ];
      }
      gl.uniform4fv(covers, new Float32Array(bounds.flat()));
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
            cardFace(entry.card),
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
      // The foreground pass only touches the hand/card area, even on retina
      // displays. Avoid running the matte shader over the entire studio twice.
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(
        Math.floor((690 / 1430) * canvas.width),
        0,
        Math.ceil((351 / 1430) * canvas.width),
        Math.ceil((134 / 565) * canvas.height),
      );
      gl.uniform1i(mode, 1);
      quad(FULL);
      gl.disable(gl.SCISSOR_TEST);
      const remaining = 1 - (performance.now() - transitionAt) / 120;
      if (remaining > 0) {
        gl.uniform1i(mode, 4);
        gl.uniform1f(dissolve, Math.min(1, remaining));
        quad(VIEW);
      }
      return true;
    },
    dispose() {
      for (const t of [
        sourceTexture,
        plateTexture,
        emptyCardTexture,
        transitionTexture,
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
