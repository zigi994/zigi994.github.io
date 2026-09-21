/* ============================================================
   hero-scale.js — from one pixel to a room

   One restrained WebGL scene, tied to the portfolio's actual thesis:
   nested apertures expand from a single pixel into an architectural
   chamber. It is not a perpetual screensaver. Desktop gets one short
   opening sequence, then the scene only redraws while the pointer is
   moving; touch, reduced-motion and background tabs hold a still frame.
   ============================================================ */

(() => {
  "use strict";

  const canvas = document.querySelector("[data-hero-scale]");
  const hero = canvas?.closest(".hero");
  if (!canvas || !hero) return;

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
  const compact = window.matchMedia("(max-width: 759px), (max-height: 519px)");

  const contextOptions = {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    preserveDrawingBuffer: false,
    powerPreference: "low-power",
    failIfMajorPerformanceCaveat: true,
  };

  let gl;
  try {
    gl =
      canvas.getContext("webgl", contextOptions) ||
      canvas.getContext("experimental-webgl", contextOptions);
  } catch {
    gl = null;
  }

  if (!gl) {
    canvas.remove();
    return;
  }

  const vertexSource = `
attribute vec2 a_position;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

  const fragmentSource = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform vec2 u_resolution;
uniform vec2 u_pointer;
uniform float u_intro;
uniform vec3 u_ink0;
uniform vec3 u_ink1;
uniform vec3 u_paper;
uniform vec3 u_accent;

float sdRoundRect(vec2 p, vec2 halfSize, float radius) {
  vec2 q = abs(p) - halfSize + radius;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - radius;
}

float sdSegment(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 0.00001), 0.0, 1.0);
  return length(pa - ba * h);
}

float stroke(float distance, float halfWidth, float aa) {
  return 1.0 - smoothstep(halfWidth, halfWidth + aa, abs(distance));
}

float hash21(vec2 p) {
  p = fract(p * vec2(0.1031, 0.11369));
  p += dot(p, p.yx + 19.19);
  return fract((p.x + p.y) * p.x);
}

void main() {
  vec2 screen = gl_FragCoord.xy / u_resolution;
  vec2 uv = vec2(screen.x, 1.0 - screen.y);
  float aspect = u_resolution.x / u_resolution.y;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  float px = 1.0 / u_resolution.y;

  float portrait = 1.0 - smoothstep(0.78, 1.05, aspect);
  vec2 vanishing = vec2(
    aspect * mix(0.225, 0.175, portrait),
    mix(-0.055, -0.165, portrait)
  );
  vec2 outerCenter = vec2(
    aspect * mix(0.205, 0.100, portrait),
    mix(0.025, -0.010, portrait)
  );

  /* Pointer parallax grows toward the viewer. The vanishing point hardly
     moves; the nearest frame moves most, which reads as a camera shift rather
     than a flat graphic following the cursor. */
  vanishing += vec2(u_pointer.x, u_pointer.y) * vec2(0.012, 0.009);
  outerCenter += vec2(u_pointer.x, u_pointer.y) * vec2(0.072, 0.052);

  vec2 outerHalf = vec2(
    aspect * mix(0.365, 0.43, portrait),
    mix(0.415, 0.360, portrait)
  );
  vec2 coreHalf = vec2(0.0105, 0.007);

  vec3 color = u_ink0;

  /* A barely lifted chamber floor: geometric and bounded, not a radial glow.
     It gives the lines somewhere to live while keeping the hero near-black. */
  float outerDistance = sdRoundRect(p - outerCenter, outerHalf, 0.045);
  float inRoom = 1.0 - smoothstep(-px * 2.0, px * 2.0, outerDistance);
  float plane = inRoom * (0.075 + 0.035 * clamp(uv.x, 0.0, 1.0));
  color = mix(color, u_ink1, plane);

  /* One directional wash gives the section physical depth. It stays bound to
     the chamber geometry instead of becoming an atmospheric page gradient. */
  float roomWash = inRoom * smoothstep(0.42, 0.98, uv.x)
    * (0.018 + 0.020 * (1.0 - uv.y));
  color = mix(color, u_paper, roomWash);

  /* Keep small nav copy and the large left-aligned headline quiet. The chamber
     remains continuous behind the type, but its lines spend most of their
     contrast on the right where there is actual negative space. */
  float typeClear = mix(
    smoothstep(0.48, 0.76, uv.x),
    smoothstep(0.30, 0.62, uv.x),
    portrait
  );
  float navClear = smoothstep(0.075, 0.145, uv.y);
  float lineVisibility = mix(mix(0.12, 0.42, portrait), 1.0, typeClear)
    * navClear;

  /* Four perspective rails turn the nested frames into a volume. Their start
     is the single-pixel core; the outer corners are intentionally cropped by
     the viewport so the room feels larger than the frame. */
  vec2 cornerA = outerCenter + vec2(-outerHalf.x, -outerHalf.y);
  vec2 cornerB = outerCenter + vec2( outerHalf.x, -outerHalf.y);
  vec2 cornerC = outerCenter + vec2( outerHalf.x,  outerHalf.y);
  vec2 cornerD = outerCenter + vec2(-outerHalf.x,  outerHalf.y);

  float rails = 0.0;
  rails += stroke(sdSegment(p, vanishing, cornerA), px * 0.72, px * 1.25);
  rails += stroke(sdSegment(p, vanishing, cornerB), px * 0.72, px * 1.25);
  rails += stroke(sdSegment(p, vanishing, cornerC), px * 0.72, px * 1.25);
  rails += stroke(sdSegment(p, vanishing, cornerD), px * 0.72, px * 1.25);
  rails = min(rails, 1.0) * u_intro * lineVisibility;
  color = mix(color, u_paper, rails * 0.22);

  /* The accent frame settles at the human-scale end of the sequence. During
     the opening it travels outward once; afterwards pointer x moves it only
     slightly, so interaction changes depth without becoming a toy. */
  float introEase = 1.0 - pow(1.0 - u_intro, 3.0);
  float settledDepth = mix(0.69, 0.48, portrait);
  float scanDepth = mix(0.06, settledDepth, introEase)
    + u_pointer.x * 0.035;

  for (int i = 0; i < 13; i++) {
    float z = float(i) / 12.0;
    float depth = pow(z, 1.52);
    float reveal = smoothstep(depth * 0.58, depth * 0.58 + 0.24, u_intro);

    vec2 center = mix(vanishing, outerCenter, depth);
    center += vec2(u_pointer.x, u_pointer.y) * vec2(0.018, 0.014) * depth;

    vec2 finalHalf = mix(coreHalf, outerHalf, depth);
    vec2 halfSize = mix(coreHalf * 0.42, finalHalf, reveal);
    float radius = mix(0.0025, 0.044, depth) * reveal;
    float distance = sdRoundRect(p - center, halfSize, radius);

    float selected = exp(-pow((depth - scanDepth) * 13.0, 2.0));
    float frameLine = stroke(
      distance,
      px * (mix(0.70, 1.05, depth) + selected * 1.65),
      px * 1.35
    ) * reveal * lineVisibility;

    vec3 lineColor = mix(u_paper, u_accent, selected * 0.94);
    float strength = mix(0.14, 0.34, depth) + selected * 0.72;
    color = mix(color, lineColor, frameLine * strength);
  }

  /* The origin stays a literal square, not a glow: one visible pixel is the
     conceptual and geometric source of the whole chamber. */
  float coreDistance = sdRoundRect(p - vanishing, coreHalf, 0.0015);
  float core = 1.0 - smoothstep(-px, px * 1.3, coreDistance);
  color = mix(color, u_accent, core * (0.58 + 0.42 * u_intro));

  float tickH = stroke(
    sdSegment(p, vanishing + vec2(-0.034, 0.0), vanishing + vec2(0.034, 0.0)),
    px * 0.55,
    px
  );
  float tickV = stroke(
    sdSegment(p, vanishing + vec2(0.0, -0.024), vanishing + vec2(0.0, 0.024)),
    px * 0.55,
    px
  );
  float ticks = min(tickH + tickV, 1.0) * (1.0 - core) * u_intro;
  color = mix(color, u_paper, ticks * 0.2);

  /* Static sub-LSB dither keeps the near-black plane from banding without
     introducing animated grain. */
  color += (hash21(gl_FragCoord.xy) - 0.5) * (1.15 / 255.0);
  gl_FragColor = vec4(max(color, 0.0), 1.0);
}
`;

  const compile = (type, source) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.warn("[hero-scale]", gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  };

  const vertex = compile(gl.VERTEX_SHADER, vertexSource);
  const fragment = vertex && compile(gl.FRAGMENT_SHADER, fragmentSource);
  if (!vertex || !fragment) {
    canvas.remove();
    return;
  }

  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn("[hero-scale]", gl.getProgramInfoLog(program));
    canvas.remove();
    return;
  }

  gl.useProgram(program);

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 3, -1, -1, 3]),
    gl.STATIC_DRAW
  );

  const position = gl.getAttribLocation(program, "a_position");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

  const uniforms = {
    resolution: gl.getUniformLocation(program, "u_resolution"),
    pointer: gl.getUniformLocation(program, "u_pointer"),
    intro: gl.getUniformLocation(program, "u_intro"),
    ink0: gl.getUniformLocation(program, "u_ink0"),
    ink1: gl.getUniformLocation(program, "u_ink1"),
    paper: gl.getUniformLocation(program, "u_paper"),
    accent: gl.getUniformLocation(program, "u_accent"),
  };

  const fallback = {
    "--ink-0": [18, 17, 13],
    "--ink-1": [25, 23, 19],
    "--fg-0": [244, 238, 226],
    "--accent": [238, 92, 54],
  };

  const readColor = (name) => {
    const value = getComputedStyle(document.documentElement)
      .getPropertyValue(name)
      .trim();
    let rgb = fallback[name];
    const hex = /^#([0-9a-f]{6})$/i.exec(value);
    const fn = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(value);
    if (hex) {
      const number = parseInt(hex[1], 16);
      rgb = [(number >> 16) & 255, (number >> 8) & 255, number & 255];
    } else if (fn) {
      rgb = [+fn[1], +fn[2], +fn[3]];
    }
    return rgb.map((channel) => channel / 255);
  };

  gl.uniform3fv(uniforms.ink0, readColor("--ink-0"));
  gl.uniform3fv(uniforms.ink1, readColor("--ink-1"));
  gl.uniform3fv(uniforms.paper, readColor("--fg-0"));
  gl.uniform3fv(uniforms.accent, readColor("--accent"));

  const MAX_PIXELS = 1.65e6;
  let cssWidth = 1;
  let cssHeight = 1;
  let visible = true;
  let frameRequest = 0;
  let introStart = 0;
  let intro = reducedMotion.matches || compact.matches ? 1 : 0;
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };

  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    cssWidth = Math.max(1, Math.round(rect.width));
    cssHeight = Math.max(1, Math.round(rect.height));
    let dpr = Math.min(window.devicePixelRatio || 1, compact.matches ? 1.2 : 1.6);
    const budget = Math.sqrt(MAX_PIXELS / (cssWidth * cssHeight * dpr * dpr));
    if (budget < 1) dpr *= budget;

    const width = Math.max(1, Math.round(cssWidth * dpr));
    const height = Math.max(1, Math.round(cssHeight * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
    }
    wake();
  };

  const draw = () => {
    gl.uniform2f(uniforms.resolution, canvas.width, canvas.height);
    gl.uniform2f(uniforms.pointer, pointer.x, pointer.y);
    gl.uniform1f(uniforms.intro, intro);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    canvas.classList.add("is-live");
  };

  const frame = (now) => {
    frameRequest = 0;
    if (!visible || document.hidden) return;

    if (intro < 1) {
      if (!introStart) introStart = now;
      intro = Math.min(1, (now - introStart) / 2300);
    }

    pointer.x += (pointer.tx - pointer.x) * 0.085;
    pointer.y += (pointer.ty - pointer.y) * 0.085;
    draw();

    const unsettled =
      intro < 1 ||
      Math.abs(pointer.tx - pointer.x) > 0.0007 ||
      Math.abs(pointer.ty - pointer.y) > 0.0007;
    if (unsettled) frameRequest = requestAnimationFrame(frame);
  };

  function wake() {
    if (!visible || document.hidden || frameRequest) return;
    frameRequest = requestAnimationFrame(frame);
  }

  if (finePointer.matches && !reducedMotion.matches) {
    hero.addEventListener("pointermove", (event) => {
      const rect = hero.getBoundingClientRect();
      pointer.tx = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
      pointer.ty = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
      wake();
    }, { passive: true });

    hero.addEventListener("pointerleave", () => {
      pointer.tx = 0;
      pointer.ty = 0;
      wake();
    }, { passive: true });
  }

  const observer = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible) wake();
    else if (frameRequest) {
      cancelAnimationFrame(frameRequest);
      frameRequest = 0;
    }
  }, { rootMargin: "10%" });
  observer.observe(hero);

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);
  window.addEventListener("orientationchange", resize, { passive: true });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) wake();
  });

  canvas.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    if (frameRequest) cancelAnimationFrame(frameRequest);
    frameRequest = 0;
    canvas.classList.remove("is-live");
  });

  resize();
})();
