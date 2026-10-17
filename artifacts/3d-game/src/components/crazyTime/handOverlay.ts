/** GPU keying keeps the host's fingers above the wheel without CPU pixel readback. */
export function handOverlay(canvas: HTMLCanvasElement) {
  const gl = canvas.getContext("webgl", {
    alpha: true,
    antialias: false,
    depth: false,
  });
  if (!gl)
    return {
      paint: (_video: HTMLVideoElement) => {},
      clear: () => {},
      dispose: () => {},
    };
  const shader = (type: number, source: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, source);
    gl.compileShader(s);
    return s;
  };
  const vertex = shader(
    gl.VERTEX_SHADER,
    `attribute vec2 position; varying vec2 uv;
    void main(){uv=(position+1.0)*0.5;gl_Position=vec4(position,0.0,1.0);}`,
  );
  const fragment = shader(
    gl.FRAGMENT_SHADER,
    `precision mediump float;
    varying vec2 uv; uniform sampler2D film;
    void main(){
      vec2 p=vec2(uv.x,1.0-uv.y);
      vec2 d=(p-vec2(0.342,0.42725))/vec2(0.2035,0.35075);
      if(p.x<0.47916||p.x>0.57084||p.y<0.12037||p.y>0.69445||dot(d,d)>1.008) discard;
      vec4 c=texture2D(film,uv);
      if(c.g>c.r*1.12&&c.b>c.r*0.9) discard;
      gl_FragColor=c;
    }`,
  );
  const program = gl.createProgram()!;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.useProgram(program);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
    gl.STATIC_DRAW,
  );
  const position = gl.getAttribLocation(program, "position");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  const clear = () => gl.clear(gl.COLOR_BUFFER_BIT);
  return {
    clear,
    paint(video: HTMLVideoElement) {
      if (gl.isContextLost()) return;
      clear();
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        video,
      );
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
    dispose() {
      gl.deleteTexture(texture);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
    },
  };
}
