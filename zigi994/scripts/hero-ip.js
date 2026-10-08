/* ============================================================
   hero-ip.js — the new character, in the old figure slot

   The clip is a 16:9 studio plate. Each frame the character is
   measured, keyed off the grey ground, and fitted into the portrait
   column the layout reserved. The plate itself is never drawn.
   Pointer movement still drags the figure, the way the previous
   hero did: a decaying velocity field, not a second video.
   ============================================================ */

(() => {
  "use strict";

  const canvas = document.querySelector("[data-hero-fluid]");
  const hero = canvas?.closest(".hero");
  const figure = hero?.querySelector("[data-hero-figure]");
  const video = hero?.querySelector("[data-hero-video]");
  if (!canvas || !hero || !figure || !video) return;

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");

  const gl = canvas.getContext("webgl", {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: false,
    powerPreference: "low-power",
  });
  if (!gl) {
    video.classList.add("is-fallback");
    canvas.remove();
    return;
  }

  const vertexSource = `
attribute vec2 a_position;
varying vec2 vUv;
void main() {
  vUv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

  const fragmentSource = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uVideo;
uniform sampler2D uFlow;
uniform vec4 uFigure;
uniform vec4 uCrop;
uniform float uRel;
uniform vec3 uInk;

void main() {
  vec2 flow = texture2D(uFlow, vUv).xy;
  vec2 off = flow * 0.085;
  float mag = length(off);
  off *= min(1.0, 0.045 / max(mag, 0.00001));

  vec3 color = uInk;
  vec2 p = (vUv - off - uFigure.xy) / max(uFigure.zw, vec2(0.0001));
  vec2 fit = p;
  if (uRel > 1.0) fit.y = (p.y - 0.5) * uRel + 0.5;
  else fit.x = (p.x - 0.5) / max(uRel, 0.001) + 0.5;

  if (fit.x >= 0.0 && fit.x <= 1.0 && fit.y >= 0.0 && fit.y <= 1.0 &&
      p.x >= -0.2 && p.x <= 1.2 && p.y >= -0.2 && p.y <= 1.2) {
    vec2 src = uCrop.xy + fit * uCrop.zw;
    if (src.x >= 0.0 && src.x <= 1.0 && src.y >= 0.0 && src.y <= 1.0) {
      vec4 tex = texture2D(uVideo, src);
      float badge = (1.0 - smoothstep(0.0, 0.16, src.x)) * smoothstep(0.80, 0.94, src.y);
      float frameFade = smoothstep(0.0, 0.035, src.x) * smoothstep(1.0, 0.965, src.x)
        * smoothstep(0.0, 0.04, src.y) * smoothstep(1.0, 0.96, src.y);
      float alpha = tex.a * (1.0 - badge) * frameFade;
      float speed = clamp(length(flow) * 1.4, 0.0, 1.0);
      vec3 lacquer = vec3(0.62, 0.22, 0.11);
      vec3 rgb = mix(tex.rgb, lacquer, speed * 0.18 * (1.0 - alpha));
      color = mix(color, rgb, alpha);
      color = mix(color, lacquer, speed * 0.16 * (1.0 - alpha));
    }
  }
  gl_FragColor = vec4(color, 1.0);
}
`;

  const flowSource = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uFlow;
uniform vec3 uSplat;
uniform vec2 uPoint;
uniform float uRadius;
uniform float uDecay;

void main() {
  vec3 prev = texture2D(uFlow, vUv).xyz * uDecay;
  vec2 d = vUv - uPoint;
  d.x *= uSplat.z;
  float stamp = exp(-dot(d, d) / uRadius);
  gl_FragColor = vec4(prev.xy + uSplat.xy * stamp, 0.0, 1.0);
}
`;

  const compile = (type, source) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.warn("[hero-ip]", gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  };

  const link = (fragment) => {
    const vertex = compile(gl.VERTEX_SHADER, vertexSource);
    const frag = vertex && compile(gl.FRAGMENT_SHADER, fragment);
    if (!vertex || !frag) return null;
    const program = gl.createProgram();
    gl.attachShader(program, vertex);
    gl.attachShader(program, frag);
    gl.bindAttribLocation(program, 0, "a_position");
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(frag);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.warn("[hero-ip]", gl.getProgramInfoLog(program));
      return null;
    }
    const uniforms = {};
    const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < count; i += 1) {
      const info = gl.getActiveUniform(program, i);
      uniforms[info.name] = gl.getUniformLocation(program, info.name);
    }
    return { program, uniforms };
  };

  const drawProgram = link(fragmentSource);
  const flowProgram = drawProgram && link(flowSource);
  if (!drawProgram || !flowProgram) {
    video.classList.add("is-fallback");
    canvas.remove();
    return;
  }

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const makeTarget = (width, height) => {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { texture, fbo, width, height };
  };

  const flowA = makeTarget(160, 90);
  const flowB = makeTarget(160, 90);
  let flowRead = flowA;
  let flowWrite = flowB;

  const videoTexture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, videoTexture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([18, 17, 13, 255]));
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

  const matteW = 640;
  const matteH = 360;
  const matte = document.createElement("canvas");
  matte.width = matteW;
  matte.height = matteH;
  const matteCtx = matte.getContext("2d", { willReadFrequently: true });
  const matteBg = new Uint8Array(matteW * matteH);
  const matteQueue = new Int32Array(matteW * matteH);

  /* Black plate, lifted from the edges so the eyes stay. A grey key left
     a halo because the old plate was light; this one is actually black. */
  const keyMatte = () => {
    matteCtx.drawImage(video, 0, 0, matteW, matteH);
    const image = matteCtx.getImageData(0, 0, matteW, matteH);
    const data = image.data;
    matteBg.fill(0);
    let head = 0;
    let tail = 0;
    const consider = (index) => {
      if (matteBg[index]) return;
      const offset = index * 4;
      const r = data[offset];
      const g = data[offset + 1];
      const b = data[offset + 2];
      const max = r > g ? (r > b ? r : b) : (g > b ? g : b);
      const min = r < g ? (r < b ? r : b) : (g < b ? g : b);
      if (max > 42 || max - min > 18) return;
      matteBg[index] = 1;
      matteQueue[tail++] = index;
    };
    for (let x = 0; x < matteW; x += 1) {
      consider(x);
      consider((matteH - 1) * matteW + x);
    }
    for (let y = 0; y < matteH; y += 1) {
      consider(y * matteW);
      consider(y * matteW + matteW - 1);
    }
    while (head < tail) {
      const index = matteQueue[head++];
      const x = index % matteW;
      const y = (index / matteW) | 0;
      if (x > 0) consider(index - 1);
      if (x < matteW - 1) consider(index + 1);
      if (y > 0) consider(index - matteW);
      if (y < matteH - 1) consider(index + matteW);
    }
    for (let index = 0; index < matteW * matteH; index += 1) {
      const offset = index * 4;
      if (matteBg[index]) {
        data[offset + 3] = 0;
        continue;
      }
      const x = index % matteW;
      const y = (index / matteW) | 0;
      let close = false;
      for (let dy = -3; dy <= 3 && !close; dy += 1) {
        for (let dx = -3; dx <= 3; dx += 1) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= matteW || yy >= matteH) continue;
          if (matteBg[yy * matteW + xx]) {
            close = true;
            break;
          }
        }
      }
      if (!close) {
        data[offset + 3] = 255;
        continue;
      }
      const r = data[offset];
      const g = data[offset + 1];
      const b = data[offset + 2];
      const max = r > g ? (r > b ? r : b) : (g > b ? g : b);
      const min = r < g ? (r < b ? r : b) : (g < b ? g : b);
      const luma = 0.299 * r + 0.587 * g + 0.114 * b;
      if (max - min > 48 && luma > 110) {
        data[offset + 3] = 255;
        continue;
      }
      const alpha = Math.min(1, Math.max(0, (luma - 16) / 78));
      if (alpha > 0.04 && alpha < 1) {
        data[offset] = Math.min(255, r / alpha);
        data[offset + 1] = Math.min(255, g / alpha);
        data[offset + 2] = Math.min(255, b / alpha);
      }
      data[offset + 3] = Math.round(alpha * 255);
    }
    matteCtx.putImageData(image, 0, 0);
  };
  const scanW = 160;
  const scanH = 90;
  const scan = document.createElement("canvas");
  scan.width = scanW;
  scan.height = scanH;
  const scanCtx = scan.getContext("2d", { willReadFrequently: true });
  const box = [0.55, 0.08, 0.28, 0.72];
  const crop = { x: 0.2, y: 0.1, w: 0.5, h: 0.75, rel: 1, ready: false };
  let frameRequest = 0;
  let visible = true;
  let aspect = 1;

  const isCharacter = (r, g, b) => {
    const neutral = Math.abs(r - g) + Math.abs(g - b) + Math.abs(b - r);
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    return neutral > 46 && luma > 28 && luma < 252;
  };

  const measure = () => {
    if (video.readyState < 2) return;
    scanCtx.drawImage(video, 0, 0, scanW, scanH);
    const data = scanCtx.getImageData(0, 0, scanW, scanH).data;
    let minX = scanW;
    let minY = scanH;
    let maxX = 0;
    let maxY = 0;
    let count = 0;
    for (let y = 0; y < scanH; y += 1) {
      for (let x = 0; x < scanW; x += 1) {
        if (x < 24 && y < 16) continue;
        const i = (y * scanW + x) * 4;
        if (!isCharacter(data[i], data[i + 1], data[i + 2])) continue;
        count += 1;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
    if (count < 12) return;
    const padX = Math.max(4, (maxX - minX) * 0.08);
    const padY = Math.max(4, (maxY - minY) * 0.08);
    minX = Math.max(0, minX - padX);
    minY = Math.max(0, minY - padY);
    maxX = Math.min(scanW - 1, maxX + padX);
    maxY = Math.min(scanH - 1, maxY + padY);
    const next = {
      x: minX / scanW,
      y: 1 - (maxY + 1) / scanH,
      w: (maxX - minX + 1) / scanW,
      h: (maxY - minY + 1) / scanH,
    };
    const blend = crop.ready ? 0.22 : 1;
    crop.x += (next.x - crop.x) * blend;
    crop.y += (next.y - crop.y) * blend;
    crop.w += (next.w - crop.w) * blend;
    crop.h += (next.h - crop.h) * blend;
    crop.ready = true;
  };

  const readFigure = () => {
    const canvasRect = canvas.getBoundingClientRect();
    const fig = figure.getBoundingClientRect();
    if (canvasRect.width < 1 || fig.width < 1) return;
    box[0] = (fig.left - canvasRect.left) / canvasRect.width;
    box[1] = 1 - ((fig.top - canvasRect.top) + fig.height) / canvasRect.height;
    box[2] = fig.width / canvasRect.width;
    box[3] = fig.height / canvasRect.height;
    const cropAspect = (crop.w * video.videoWidth) / Math.max(1, crop.h * video.videoHeight);
    const figAspect = fig.width / Math.max(1, fig.height);
    crop.rel = cropAspect / Math.max(0.001, figAspect);
  };

  const drawFlow = (splat) => {
    gl.useProgram(flowProgram.program);
    gl.bindFramebuffer(gl.FRAMEBUFFER, flowWrite.fbo);
    gl.viewport(0, 0, flowWrite.width, flowWrite.height);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, flowRead.texture);
    const u = flowProgram.uniforms;
    gl.uniform1i(u.uFlow, 0);
    gl.uniform1f(u.uDecay, splat ? 0.9 : 0.96);
    gl.uniform1f(u.uRadius, 0.012);
    gl.uniform3f(u.uSplat, splat ? splat.x : 0, splat ? splat.y : 0, aspect);
    gl.uniform2f(u.uPoint, splat ? splat.px : 0.5, splat ? splat.py : 0.5);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const swap = flowRead;
    flowRead = flowWrite;
    flowWrite = swap;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  };

  function draw(splat) {
    if (video.readyState < 2) return;
    measure();
    readFigure();
    if (!reducedMotion.matches) drawFlow(splat);
    try {
      gl.useProgram(drawProgram.program);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.activeTexture(gl.TEXTURE0);
      keyMatte();
      gl.bindTexture(gl.TEXTURE_2D, videoTexture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, matte);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, flowRead.texture);
      const u = drawProgram.uniforms;
      gl.uniform1i(u.uVideo, 0);
      gl.uniform1i(u.uFlow, 1);
      gl.uniform4f(u.uFigure, box[0], box[1], box[2], box[3]);
      gl.uniform4f(u.uCrop, crop.x, crop.y, crop.w, crop.h);
      gl.uniform1f(u.uRel, crop.rel);
      gl.uniform3f(u.uInk, 0.071, 0.067, 0.051);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      canvas.classList.add("is-live");
    } catch (err) {
      /* One undecoded frame should not stop the loop. */
    }
  }

  const tick = () => {
    frameRequest = 0;
    if (!visible || document.hidden) return;
    draw(null);
    if (!video.paused && !video.ended) frameRequest = requestAnimationFrame(tick);
  };

  const wake = () => {
    if (frameRequest || !visible || document.hidden) return;
    frameRequest = requestAnimationFrame(tick);
  };

  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    aspect = rect.width / Math.max(1, rect.height);
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
    draw(null);
  };

  const letters = [...hero.querySelectorAll("[data-hero-letter]")];
  if (finePointer.matches && !reducedMotion.matches) {
    hero.addEventListener("pointermove", (event) => {
      const rect = canvas.getBoundingClientRect();
      const stop = figure.getBoundingClientRect().left - 12;
      letters.forEach((letter) => {
        const bounds = letter.getBoundingClientRect();
        const prev = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(letter.style.transform);
        const prevX = prev ? Number(prev[1]) : 0;
        const prevY = prev ? Number(prev[2]) : 0;
        const restLeft = bounds.left - prevX;
        const restTop = bounds.top - prevY;
        const dx = event.clientX - (restLeft + bounds.width / 2);
        const dy = event.clientY - (restTop + bounds.height / 2);
        const pull = Math.max(0, 1 - Math.hypot(dx, dy) / 520);
        let tx = dx * pull * 0.06;
        const ty = dy * pull * 0.1;
        const limit = Math.max(0, stop - (restLeft + bounds.width));
        if (tx > limit) tx = limit;
        letter.style.transform = `translate(${tx.toFixed(2)}px, ${ty.toFixed(2)}px)`;
      });
      if (!event.movementX && !event.movementY) return;
      draw({
        px: (event.clientX - rect.left) / rect.width,
        py: 1 - (event.clientY - rect.top) / rect.height,
        x: event.movementX * 0.035,
        y: -event.movementY * 0.035,
      });
      wake();
    }, { passive: true });
    hero.addEventListener("pointerleave", () => {
      letters.forEach((letter) => {
        letter.style.transform = "";
      });
    });
  }

  video.addEventListener("loadeddata", () => {
    if (reducedMotion.matches) {
      video.pause();
      draw(null);
      return;
    }
    video.play().then(wake).catch(() => draw(null));
  });
  video.addEventListener("play", wake);
  video.addEventListener("ended", () => {
    video.currentTime = 0;
    video.play().catch(() => {});
  });

  const observer = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (!visible) {
      video.pause();
      if (frameRequest) cancelAnimationFrame(frameRequest);
      frameRequest = 0;
    } else if (!reducedMotion.matches && video.readyState >= 2) {
      video.play().then(wake).catch(() => draw(null));
    } else {
      draw(null);
    }
  }, { rootMargin: "10%" });
  observer.observe(hero);

  new ResizeObserver(resize).observe(canvas);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) video.pause();
    else if (visible && !reducedMotion.matches) video.play().then(wake).catch(() => {});
  });

  if (video.readyState >= 2) video.dispatchEvent(new Event("loadeddata"));
})();
