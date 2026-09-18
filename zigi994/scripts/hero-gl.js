/* ============================================================
   hero-gl.js — one refractive body behind the home hero

   Hand-written fragment shader, no library. The brief was "sumi ink
   in water / light through dark lacquer", and two things separate
   that from the stock-render look:

   1. Where the light lives. A glow is brightest in the middle of a
      shape and falls off radially — there is not a single radial
      falloff in this file. A refractive body is brightest at grazing
      angles, on thin folds, and splits colour as it bends light. So
      the material is built as a height field, a normal is taken from
      it, and everything visible after that is a Fresnel term, a
      refracted sample, or a crease. Nothing is emissive.

   2. Containment. The references (resn.co.nz, unseen.co) both put
      ONE bounded object on a mostly empty ground; neither is a
      full-viewport noise field. A field that covers every pixel is a
      texture, and this page's real strength is enormous Chinese type
      on almost nothing. So the material is gated by a silhouette —
      a signed distance function — and outside that silhouette the
      output is *exactly* --ink-0, the same colour as the page body.
      The empty ground is not a faded field, it is untouched.

   The silhouette also pays for itself: the heavy noise sits behind a
   branch, so the ~94% of the frame that is empty costs almost nothing.

   Standalone on purpose. It does not import motion.js: this layer is
   decorative and must never be able to take the interaction layer
   down with it, and it needs to genuinely cancel its own rAF when the
   hero leaves the viewport, which a shared ticker with other
   permanent subscribers cannot do.
   ============================================================ */

(() => {
  "use strict";

  /* Which composition the hero renders. All three are written below and
     selected by the preprocessor, so the two you are not using are not
     compiled and cost nothing at runtime — switching is a one-word edit.

       "droplet"  one contained refractive body, upper right. The closest
                  to Resn: a single object, hard-ish silhouette, and it
                  clears the headline block almost entirely.
       "ribbon"   a column of dispersing ink entering from above and
                  thinning out before the foot content, like a dropped
                  ribbon of pigment.
       "shard"    a large mass of dark glass cropped by the right edge,
                  level with the headline. Reads as an object the frame
                  is too small for rather than one floating in it. */
  const COMPOSITION = "shard";

  const canvas = document.querySelector("[data-hero-gl]");
  if (!canvas) return;

  /* Removing the node, not just hiding it, is the only degradation that
     leaves the hero byte-for-byte what it is today. Called for every
     failure path: no context, no compile, lost context, metered link. */
  let teardown = () => canvas.remove();
  const retire = () => {
    const fn = teardown;
    teardown = () => {};
    fn();
  };

  /* ---- guards ---------------------------------------------------- */

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");

  /* Same test navigation.js uses before it spends bandwidth on prefetch.
     A shader is a worse deal than a prefetch on a metered link: it costs
     battery for as long as the hero is on screen. */
  const conn =
    navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (conn && (conn.saveData || /(^|-)2g$/.test(conn.effectiveType || ""))) {
    retire();
    return;
  }

  /* Phones get one frame, not a loop — see renderOnce below. Height is in
     the test as well as width so a handset held sideways, which is wide
     enough to pass a width-only check, is still treated as a phone. */
  const isCompact = () => window.innerWidth < 760 || window.innerHeight < 520;

  /* ---- palette --------------------------------------------------- */

  /* Read from tokens.css rather than duplicated here, so the shader cannot
     drift from the palette and so the per-section accent reassignment is
     picked up for free. Fallbacks are the token values as of writing. */
  const FALLBACK = {
    "--ink-0": [0x12, 0x11, 0x0d],
    "--ink-1": [0x19, 0x17, 0x13],
    "--ink-2": [0x21, 0x1e, 0x18],
    "--accent": [0xee, 0x5c, 0x36],
    "--fg-0": [0xf4, 0xee, 0xe2],
  };

  function readColor(name) {
    const raw = getComputedStyle(document.documentElement)
      .getPropertyValue(name)
      .trim();

    let rgb = FALLBACK[name];

    const hex = /^#([0-9a-f]{6})$/i.exec(raw);
    const fn = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(raw);

    if (hex) {
      const v = parseInt(hex[1], 16);
      rgb = [(v >> 16) & 255, (v >> 8) & 255, v & 255];
    } else if (fn) {
      rgb = [+fn[1], +fn[2], +fn[3]];
    }

    /* Left in sRGB deliberately. CSS composites the surrounding page in
       sRGB too, so mixing here in the same space is what keeps the ground
       outside the silhouette identical to the --ink-0 body background. */
    return [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255];
  }

  /* ---- shaders --------------------------------------------------- */

  const VERT = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

  const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform vec2  u_res;
uniform float u_time;
uniform vec2  u_tilt;

uniform vec3 u_ink0;
uniform vec3 u_ink1;
uniform vec3 u_ink2;
uniform vec3 u_accent;
uniform vec3 u_paper;

/* Irrational-ish rotation between octaves. Without it every octave stacks
   on the same lattice and the result has a visible weave. */
const mat2 ROT = mat2(0.80, 0.60, -0.60, 0.80);

/* ~20°, and its transpose. GLSL ES 1.0 has no transpose(). */
const mat2 TILT = mat2(0.94, 0.34, -0.34, 0.94);
const mat2 TILT_T = mat2(0.94, -0.34, 0.34, 0.94);

float hash21(vec2 p) {
  p = fract(p * vec2(0.3183099, 0.3678794));
  p += dot(p, p + 19.19);
  return fract(p.x * p.y * 95.4337);
}

vec2 grad(vec2 i) {
  float a = hash21(i) * 6.2831853;
  return vec2(cos(a), sin(a));
}

/* Gradient noise, not value noise. Value noise keeps axis-aligned square
   artefacts, and once the domain is warped at all those squares smear into
   visible digital streaks. */
float gnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);

  float a = dot(grad(i + vec2(0.0, 0.0)), f - vec2(0.0, 0.0));
  float b = dot(grad(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0));
  float c = dot(grad(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0));
  float d = dot(grad(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0));

  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 1.42;
}

/* Octave counts are fixed per call site: GLSL ES 1.0 wants constant loop
   bounds, and three octaves is the ceiling here. Four gave the fine
   filament frequency that made the whole thing read as marble veining —
   the brief is a few large legible folds, not twenty strands. */
float fbm2(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 2; i++) { s += a * gnoise(p); p = ROT * p * 2.03; a *= 0.5; }
  return s;
}

float fbm3(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 3; i++) { s += a * gnoise(p); p = ROT * p * 2.03; a *= 0.5; }
  return s;
}

/* Ridged fold: 1-|n| creases the field, squaring sharpens the crease into a
   line. Only used for the caustic hairline. */
float ridged(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 3; i++) {
    float n = 1.0 - abs(gnoise(p) * 1.7);
    s += a * n * n;
    p = ROT * p * 2.17;
    a *= 0.5;
  }
  return s;
}

/* Signed distance to an axis-aligned rect, then feathered: 0 inside, 1 once
   you are 'feather' clear of it. Used to deny the material the areas that
   carry type, so legibility does not depend on the form happening to miss
   them at whatever shape the window is. */
float clearOf(vec2 q, vec4 rect, float feather) {
  vec2 c = 0.5 * (rect.xy + rect.zw);
  vec2 hs = 0.5 * (rect.zw - rect.xy);
  vec2 d = abs(q - c) - hs;
  float o = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
  return smoothstep(0.0, feather, o);
}

void main() {
  vec2 st = gl_FragCoord.xy / u_res;

  /* Top-down, so the constants below read the same way the measured CSS
     layout does. sp is 0..1 on both axes; hp is isotropic, one unit = the
     hero's height, so a circle is a circle at any window shape. */
  vec2  sp = vec2(st.x, 1.0 - st.y);
  float aspect = u_res.x / u_res.y;
  vec2  hp = vec2(sp.x * aspect, sp.y);
  float t = u_time;

  /* ---- silhouette ----------------------------------------------
     sd    signed distance to the body, negative inside, height units
     gN    outward unit normal of the silhouette
     thick how deep the body is, for building the dome normal
     soft  width of the edge transition */
  float sd;
  vec2  gN;
  float thick;
  float soft;

#ifdef FORM_DROPLET
  /* One body in the upper right, in the empty band between the nav and the
     headline: a tilted, slightly squashed ellipse, with the space it lives
     in warped by a low-frequency field.

     Displacing the radius as a function of angle is the obvious way to make
     an organic blob and it is the wrong one: sampling noise around a circle
     gives evenly spaced lobes, and the body comes out looking like a cog.
     Distorting the coordinate space instead bends the outline
     asymmetrically, which is what a lens of settled pigment looks like. */
  vec2 warp = vec2(
    fbm2(hp * 1.05 + vec2(0.0, t * 0.021)),
    fbm2(hp * 1.05 + vec2(5.2, -1.1) - t * 0.017)
  );

  vec2 du = hp - vec2(0.735 * aspect, 0.248) + warp * 0.060;
  vec2 dv = TILT * du;
  dv.y *= 1.14;

  float dr = length(dv);

  /* Sized and placed to fit entirely between the nav strip and the top of
     the headline's box — the one variant of the three whose material never
     enters the h1's bounding box at all, not just its glyphs. */
  float R = 0.128;

  /* Exact gradient of |S·T·u| back in hp space, so the rim stays an even
     width right round a shape that is neither round nor axis-aligned. */
  vec2 nd = dv / max(dr, 1e-4);
  nd.y *= 1.14;

  sd = dr - R;
  gN = normalize(TILT_T * nd);
  thick = R;
  soft = 0.006;
#endif

#ifdef FORM_RIBBON
  /* A column of pigment dropped from above. The taper narrows the
     half-width rather than fading the opacity, so the ends come to a point
     like pigment running out instead of crossfading like a gradient.

     It also leans as it falls and comes apart at the bottom. Both of those
     are corrections: held on a straight axis and tapered evenly at both
     ends, this reads as a symmetrical leaf, which is a logo mark and not a
     falling thing.

     The ramp at the top is slow on purpose — between the headline's glyphs
     on the left and the location label on the right there is a corridor
     about 130px wide, and the column has to be at its narrowest crossing
     it. */
  float meander = fbm3(vec2(sp.y * 2.30, t * 0.026)) * 0.055;
  float lean = (sp.y - 0.30) * 0.115;
  float centre = 0.775 * aspect + lean + meander;

  /* The height at which the column runs out varies across its width, so the
     lower end breaks up instead of closing on one clean curve. */
  float outAt = 0.600 + 0.135 * fbm2(vec2(hp.x * 5.0 + 2.0, t * 0.022));

  float taper = smoothstep(0.090, 0.330, sp.y)
              * (1.0 - smoothstep(outAt - 0.16, outAt + 0.13, sp.y));
  soft = 0.018;

  /* The offset is load-bearing, and it has to clear soft. Tapering the
     half-width to exactly zero leaves sd = 0 on the centreline, and an edge
     that fades over ±soft around zero then paints a partial hairline down
     the full height of the canvas — straight through the nav and the scales
     row, which is how it first showed up in the measurements. Pushing the
     width past negative-soft ends the column in a real point. */
  float halfW = 0.098 * (0.86 + 0.80 * fbm2(vec2(sp.y * 3.4 + 11.0, t * 0.018))) * taper
              - (soft + 0.005);

  sd = abs(hp.x - centre) - halfW;
  gN = vec2(hp.x < centre ? -1.0 : 1.0, 0.0);
  thick = max(halfW, 1e-3);
#endif

#ifdef FORM_SHARD
  /* A wedge opening off the right edge: the frame crops it, so it reads as a
     mass too big for the viewport rather than an object floating in it. It is
     bounded by two half-planes, and the upper one is pitched to pass below
     the location label rather than through it, with the apex clear of the
     widest headline line. */
  vec2 apex = vec2(0.752 * aspect, 0.492);
  vec2 e1 = normalize(vec2(1.02 * aspect, 0.288) - apex);
  vec2 e2 = normalize(vec2(1.02 * aspect, 0.730) - apex);
  vec2 n1 = vec2(e1.y, -e1.x);
  vec2 n2 = vec2(-e2.y, e2.x);

  vec2 w = hp - apex;
  float d1 = dot(w, n1);
  float d2 = dot(w, n2);

  /* Smooth max, not max. A hard max of two half-planes has a discontinuous
     gradient along their bisector, and since the surface normal is built
     from that gradient the body came out with a straight seam running from
     the apex to the right edge, visible as a hard horizontal line. Blending
     the two planes over a radius fixes the normal and rounds the apex,
     which a real mass would have anyway. */
  const float SM = 0.100;
  float k = clamp(0.5 + 0.5 * (d1 - d2) / SM, 0.0, 1.0);
  float dw = mix(d2, d1, k) + SM * k * (1.0 - k);

  /* Noise on the boundary so the two straight edges become a single
     irregular one; without it this is a triangle. */
  float warpEdge = fbm3(hp * 1.55 + vec2(0.0, t * 0.024)) * 0.085;

  sd = dw + warpEdge;
  gN = normalize(mix(n2, n1, k));
  thick = 0.200;
  soft = 0.020;
#endif

  float mask = smoothstep(soft, -soft, sd);

  /* Legibility keep-outs, from the measured layout: the nav strip, the
     block the headline glyphs actually occupy, and the small location
     label in the top right. Wide feathers so any interaction is a gentle
     dimming of the silhouette rather than a straight cut through it. */
  mask *= clearOf(sp, vec4(0.000, 0.000, 1.000, 0.055), 0.026);
  mask *= clearOf(sp, vec4(0.030, 0.385, 0.695, 0.730), 0.045);
  mask *= clearOf(sp, vec4(0.858, 0.270, 0.962, 0.324), 0.024);

  /* Outside the body the answer is --ink-0 exactly — the same value as the
     page background, so there is no seam and no faded halo. */
  vec3 col = u_ink0;

  if (mask > 0.002) {
    /* --- body ---------------------------------------------------
       Depth into the silhouette becomes a dome, which gives a real
       surface normal: in-plane and outward at the rim, facing the viewer
       at the core. That is what makes the Fresnel term below read as a
       solid refractive body rather than a lit patch — bright edge, dark
       middle, the way glass actually behaves. */
    float depth = clamp(-sd / thick, 0.0, 1.0);
    float zz = sqrt(clamp(depth * (2.0 - depth), 0.0, 1.0));
    vec3 nBody = normalize(vec3(gN * (1.0 - zz), zz + 0.03));

    /* --- interior folds ----------------------------------------
       One warp pass, not two, and at a low base frequency: each pass
       shears the coordinate by the previous one, which is advection, but
       two passes at this scale produce the fine marbled filaments the
       composition does not want. A few broad folds is the brief. */
    /* Frequency is set against the size of the *body*, not the viewport. The
       body is about a third of the hero's height across, so a base
       wavelength near 1.0 in hero units put less than half a fold inside it
       and the interior came out flat black. At 6.2 it holds two or three
       folds — which is the brief: a couple of legible ones, not twenty
       strands. The advecting field is deliberately coarser than the folds it
       shears, so they bend as a group rather than turning to filigree. */
    vec2 p = hp * 4.4;
    vec2 q = vec2(
      fbm3(p * 0.42 + vec2(0.0, t * 0.060)),
      fbm3(p * 0.42 + vec2(4.3, 1.7) - t * 0.048)
    );
    vec2 wp = p + 1.30 * q;

    float h = fbm3(wp);

    const float E = 0.100;
    float hx = fbm3(wp + vec2(E, 0.0));
    float hy = fbm3(wp + vec2(0.0, E));
    vec2 ng = vec2(h - hx, h - hy) / E;

    /* Folds perturb the body's normal; they do not replace it. The weight is
       low on purpose — at 0.5 the noise gradient overwhelms the dome and the
       Fresnel term stops following the silhouette, which is exactly what
       turns a refractive object back into a soft smudge. */
    vec3 n = normalize(nBody + vec3(ng * 0.17, 0.0));

    /* Pointer tilts the view a couple of degrees, so highlights slide
       across the folds the way they do when you tip a lacquer panel. Built
       from sp, not st: the silhouette normal is in top-down space and the
       two have to agree or the rim lights the wrong edge. */
    /* The in-plane term is small deliberately. At 0.55 the view vector is
       skewed enough that a silhouette normal is near-perpendicular to it on
       one side of the body and near-parallel on the other, so the rim lights
       one edge and abandons the other. A real body's outline is bright all
       the way round, which needs V close to straight-on. */
    vec3 V = normalize(vec3(
      (sp - 0.5) * vec2(aspect, 1.0) * 0.26 + vec2(u_tilt.x, -u_tilt.y),
      1.0
    ));

    /* Schlick, twice. Everything bright is gated on one of these, so light
       can only appear where a surface turns away from the eye.
         fresBody follows the silhouette alone — a clean ring, the way a
                  glass body concentrates light at its outline;
         fres     follows the folds too, for the interior events. */
    float fresBody = pow(1.0 - clamp(dot(nBody, V), 0.0, 1.0), 3.2);
    float fres = pow(1.0 - clamp(dot(n, V), 0.0, 1.0), 3.2);

    float dens = smoothstep(-0.42, 0.40, h);

    /* The body is near-black glass, not a warm mass: its deepest value is
       barely off --ink-0, and what makes it legible as an object is the rim
       and the folds, not an overall lift. A lift is what reads as a stain. */
    vec3 deep = mix(u_ink0, u_ink1, 0.30);
    vec3 lit = mix(u_ink2, u_paper, 0.04);
    vec3 mat = mix(deep, lit, smoothstep(0.30, 0.95, dens));

    /* One fixed light, upper left. A Fresnel term alone gives edges but no
       sense of a surface between them; specular off the warped normal is
       what makes the folds read as wet lacquer rather than as a gradient.
       Two exponents: a tight glint that lands only where a fold turns
       through the mirror angle, and a broad sheen that gives the body a
       direction to be lit from. */
    vec3 L = normalize(vec3(-0.50, -0.45, 0.74));
    vec3 Rv = reflect(-V, n);
    float mirror = max(dot(Rv, L), 0.0);
    float glint = pow(mirror, 48.0);
    float sheen = pow(mirror, 22.0);

    /* --- dispersion --------------------------------------------
       Two densities sampled either side of the refracted direction. They
       are deliberately *not* written to R/G/B — that is how you get
       rainbow iridescence, and an orange/cyan split is the oil-slick
       look. Only their signed difference is used, driving one warm axis
       with no negative blue, so an edge can go amber one way and darker
       umber the other and never becomes a spectrum. Which is also the
       honest result for this material: lacquer absorbs short wavelengths
       heavily, so real dispersion in it shows up as warmth. */
    vec3 rr = refract(-V, n, 0.660);
    vec2 dsp = rr.xy * 0.20;
    float split = (smoothstep(-0.30, 0.50, fbm2(wp + dsp))
                 - smoothstep(-0.30, 0.50, fbm2(wp - dsp * 0.60))) * 0.5;

    mat += vec3(0.115, 0.044, 0.010) * split * (0.30 + 0.70 * fres);

    /* --- edges -------------------------------------------------
       ring is purely geometric: a hairline just inside the outline, which
       is where a refractive body actually concentrates what it bends. It
       is what makes this read as an object with a surface rather than a
       cloud, so it does not depend on the noise at all — only its
       brightness is modulated by the folds, so the ring breaks up along
       its length instead of looking like a stroked circle.

       cst is a crease field thresholded hard to a hairline. Accent
       appears only in these two places and in the Fresnel term — never
       as a fill. */
    float ringCore = smoothstep(0.0075, 0.0012, -sd);
    float ringInner = smoothstep(0.026, 0.005, -sd);

    float fold = ridged(wp * 0.30 + vec2(t * 0.035, -t * 0.026));
    float cst = pow(clamp((fold - 0.80) * 4.2, 0.0, 1.0), 3.0);

    /* Modulated along its length by the folds so the outline is an edge the
       light runs along, not a stroked circle. */
    float along = 0.28 + 0.72 * smoothstep(0.05, 0.85, dens);

    mat += mix(u_accent, u_paper, 0.25) * ringCore * (0.30 + 0.70 * fresBody) * 0.86 * along;
    mat += u_accent * ringInner * fresBody * 0.11 * along;

    /* Caustics are not gated on Fresnel alone: light bent inside a body
       shows up across its face, not only at its edges. */
    mat += mix(u_paper, u_accent, 0.30) * cst * (0.30 + 0.70 * fres) * 0.32;

    mat += u_accent * fres * (0.25 + 0.75 * dens) * 0.065;
    mat += u_paper * glint * 0.34;
    mat += mix(u_ink2, u_paper, 0.45) * sheen * 0.050;

    col = mix(u_ink0, mat, mask);

    /* Eight-bit quantisation is brutal across a ramp this dark — the ink
       surfaces are four levels apart — so break the step with a half-LSB
       dither. Static, not time-seeded: animated dither over a field this
       slow reads as video noise. Scaled by the mask so the empty ground
       stays bit-exact --ink-0. */
    col += (hash21(gl_FragCoord.xy) - 0.5) * (1.6 / 255.0) * mask;
  }

  gl_FragColor = vec4(max(col, 0.0), 1.0);
}
`;

  const FORM_DEFINE = {
    droplet: "#define FORM_DROPLET\n",
    ribbon: "#define FORM_RIBBON\n",
    shard: "#define FORM_SHARD\n",
  };

  /* ---- boot ------------------------------------------------------ */

  function start() {
    const attrs = {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
      powerPreference: "low-power",
      /* A software rasteriser would run this on the CPU behind the
         largest text on the page. Better to have no canvas at all. */
      failIfMajorPerformanceCaveat: true,
    };

    let gl = null;
    try {
      gl =
        canvas.getContext("webgl", attrs) ||
        canvas.getContext("experimental-webgl", attrs);
    } catch (err) {
      gl = null;
    }

    if (!gl) {
      retire();
      return;
    }

    /* --- compile --- */

    const compile = (type, src) => {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        console.warn("[hero-gl]", gl.getShaderInfoLog(sh));
        gl.deleteShader(sh);
        return null;
      }
      return sh;
    };

    const form = FORM_DEFINE[COMPOSITION] || FORM_DEFINE.droplet;

    const vs = compile(gl.VERTEX_SHADER, VERT);
    const fs = vs && compile(gl.FRAGMENT_SHADER, form + FRAG);

    if (!vs || !fs) {
      retire();
      return;
    }

    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);

    /* Detached as soon as the program owns them; the driver keeps what it
       needs and nothing here ever recompiles. */
    gl.deleteShader(vs);
    gl.deleteShader(fs);

    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.warn("[hero-gl]", gl.getProgramInfoLog(prog));
      retire();
      return;
    }

    gl.useProgram(prog);

    /* One triangle covering clip space. A quad would need either an index
       buffer or two more vertices to rasterise the same pixels. */
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW
    );

    const aPos = gl.getAttribLocation(prog, "a_pos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const u = (name) => gl.getUniformLocation(prog, name);
    const uRes = u("u_res");
    const uTime = u("u_time");
    const uTilt = u("u_tilt");

    gl.uniform3fv(u("u_ink0"), readColor("--ink-0"));
    gl.uniform3fv(u("u_ink1"), readColor("--ink-1"));
    gl.uniform3fv(u("u_ink2"), readColor("--ink-2"));
    gl.uniform3fv(u("u_accent"), readColor("--accent"));
    gl.uniform3fv(u("u_paper"), readColor("--fg-0"));

    /* --- sizing --- */

    /* Two independent caps. The DPR cap keeps a 3× phone from asking for
       nine times the fragments of a 1× desktop; the pixel budget keeps a
       wide 2× desktop from asking for eight million. Net effect on any
       display is roughly one shaded sample per CSS pixel. */
    const MAX_PIXELS = 2.0e6;

    let vw = 0;
    let vh = 0;

    /* The composition is a landscape one: it lives in the empty upper right
       of a wide hero, and the regions it is denied are expressed as
       fractions of that hero. On a portrait hero there is no empty upper
       right — every band across it is carrying type — so the material would
       be squeezed into the gaps between text blocks, which looks like an
       accident rather than a composition. On that shape it is not drawn at
       all. Re-evaluated on every resize, so a rotation recovers it. */
    let shapeOk = true;

    /* Dropped once, permanently, if the first second of frames shows this GPU
       cannot hold a reasonable rate — see the sampling block in frame(). */
    let scale = 1;

    function resize() {
      const rect = canvas.getBoundingClientRect();
      const cssW = Math.max(1, Math.round(rect.width));
      const cssH = Math.max(1, Math.round(rect.height));

      shapeOk = cssW / cssH >= 1.15;

      const cap = reduceMotion.matches || isCompact() ? 1.25 : 1.75;
      let dpr = Math.min(window.devicePixelRatio || 1, cap) * scale;

      const budget = Math.sqrt(MAX_PIXELS / (cssW * cssH * dpr * dpr));
      if (budget < 1) dpr *= budget;

      const w = Math.max(1, Math.round(cssW * dpr));
      const h = Math.max(1, Math.round(cssH * dpr));

      if (w === vw && h === vh) return false;

      vw = w;
      vh = h;
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
      gl.uniform2f(uRes, w, h);
      return true;
    }

    /* --- state --- */

    /* Not performance.now(): the clock only advances while we are actually
       drawing, so pausing for a hidden tab or an off-screen hero resumes
       where it left off instead of jumping a minute of noise. */
    let clock = 11.0;
    let last = 0;

    let tiltX = 0;
    let tiltY = 0;
    let targetX = 0;
    let targetY = 0;

    let raf = 0;
    let onScreen = true;
    let live = false;

    function draw() {
      if (!shapeOk) {
        /* Fades out rather than disappearing, and the buffer is left alone:
           at opacity 0 its contents cannot be seen, and not drawing is the
           whole point. */
        if (live) {
          live = false;
          canvas.classList.remove("is-live");
        }
        return;
      }

      gl.uniform1f(uTime, clock);
      gl.uniform2f(uTilt, tiltX, tiltY);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      if (!live) {
        live = true;
        /* Faded in only once a frame exists, so there is never a flash of
           undrawn buffer over the hero. */
        canvas.classList.add("is-live");
      }
    }

    function renderOnce() {
      resize();
      draw();
    }

    /* The cost of this shader is fixed per fragment, so the only lever on a
       GPU that cannot keep up is to shade fewer of them. Judged over a window
       of frames rather than reacting to one slow one, skipping the first few
       while the driver warms up, and applied at most once so it can never
       oscillate. A softer body is a much better outcome than a hero that
       stutters while you read the headline. */
    let sampled = 0;
    let sampledMs = 0;
    let settled = false;

    function frame(now) {
      raf = requestAnimationFrame(frame);

      const dt = last ? Math.min(now - last, 50) : 16;
      last = now;

      clock += dt * 0.001;
      tiltX += (targetX - tiltX) * 0.045;
      tiltY += (targetY - tiltY) * 0.045;

      if (!settled && ++sampled > 20) {
        sampledMs += dt;
        if (sampled >= 110) {
          settled = true;
          if (sampledMs / (sampled - 20) > 22) {
            scale = 0.72;
            vw = 0;
          }
        }
      }

      resize();
      draw();

      /* Nothing to animate on a portrait hero, so give the frame budget back
         instead of spinning. onResize starts it again if the shape changes. */
      if (!shapeOk) stop();
    }

    const stop = () => {
      if (!raf) return;
      cancelAnimationFrame(raf);
      raf = 0;
      last = 0;
    };

    const play = () => {
      if (raf || !onScreen || document.hidden) return;
      if (reduceMotion.matches || isCompact()) return;
      last = 0;
      raf = requestAnimationFrame(frame);
    };

    /* --- lifecycle --- */

    /* Under reduced motion, and on phones, this is a still image: one draw
       and the loop is never entered. Phones because the hero is almost
       entirely filled by the h1 there, so a continuous shader would spend
       battery on a thin margin of visible texture. */
    const staticOnly = () => reduceMotion.matches || isCompact();

    const io =
      "IntersectionObserver" in window
        ? new IntersectionObserver(
            (entries) => {
              onScreen = entries.some((e) => e.isIntersecting);
              if (onScreen) play();
              else stop();
            },
            { rootMargin: "80px" }
          )
        : null;

    const onVisibility = () => (document.hidden ? stop() : play());

    const onMove = (e) => {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      targetX = ((e.clientX - rect.left) / rect.width - 0.5) * 0.11;
      targetY = (0.5 - (e.clientY - rect.top) / rect.height) * 0.11;
    };

    const onLeave = () => {
      targetX = 0;
      targetY = 0;
    };

    /* A resize under staticOnly still has to redraw, otherwise the still
       frame stretches. rAF-coalesced because a phone scrolling the URL bar
       away fires resize continuously. */
    let pending = 0;
    const onResize = () => {
      if (pending) return;
      pending = requestAnimationFrame(() => {
        pending = 0;
        if (staticOnly()) renderOnce();
        /* No-op while the loop is already running; restarts it if a rotation
           out of portrait made the hero drawable again. */
        else play();
      });
    };

    const onMotionChange = () => {
      stop();
      if (staticOnly()) renderOnce();
      else play();
    };

    const onLost = (e) => {
      /* No preventDefault: not asking for a restore. A hero that silently
         goes back to what it was is a better outcome than one that blinks
         back with a fresh context. */
      stop();
      retire();
    };

    canvas.addEventListener("webglcontextlost", onLost, false);

    if (io) io.observe(canvas);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("resize", onResize, { passive: true });

    if (finePointer.matches) {
      window.addEventListener("mousemove", onMove, { passive: true });
      document.addEventListener("mouseleave", onLeave);
    }

    if (reduceMotion.addEventListener) {
      reduceMotion.addEventListener("change", onMotionChange);
    }

    teardown = () => {
      stop();
      if (pending) cancelAnimationFrame(pending);
      if (io) io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseleave", onLeave);
      canvas.removeEventListener("webglcontextlost", onLost, false);
      if (reduceMotion.removeEventListener) {
        reduceMotion.removeEventListener("change", onMotionChange);
      }

      canvas.remove();

      /* Hand the GPU memory back rather than waiting for the context to be
         collected, which is not prompt and is not guaranteed. */
      const kill = gl.getExtension("WEBGL_lose_context");
      if (kill) kill.loseContext();
    };

    /* --- go --- */

    if (staticOnly()) renderOnce();
    else play();
  }

  /* The h1 is the LCP element and has to paint on its own schedule.
     Compiling a shader is synchronous main-thread work, so it waits for
     two frames — guaranteeing at least one paint has been committed — and
     then for an idle slot, with a timeout so a busy page still gets the
     visual. Nothing above this line touches the GPU. */
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (typeof window.requestIdleCallback === "function") {
        window.requestIdleCallback(start, { timeout: 1500 });
      } else {
        setTimeout(start, 240);
      }
    });
  });
})();
