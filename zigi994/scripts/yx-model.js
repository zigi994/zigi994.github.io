import * as THREE from "./vendor/three.module.js";
import { OBJLoader } from "./vendor/OBJLoader.js";

const MODEL = "assets/ip/yx/model/";

export function initYxModel(root) {
  const stage = root.querySelector("[data-yx-model]");
  const canvas = stage?.querySelector("[data-yx-canvas]");
  if (!stage || !canvas) return;

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  const wait = stage.querySelector("[data-yx-wait]");
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  } catch (err) {
    if (wait) wait.textContent = "这个浏览器画不出立体模型";
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.01, 40);
  scene.add(new THREE.HemisphereLight(0xfff6ea, 0x2a221b, 1.4));
  const key = new THREE.DirectionalLight(0xfff4e8, 2.6);
  key.position.set(2.4, 3.4, 3.2);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xff9a3c, 1.45);
  rim.position.set(-2.6, 1.8, -2.4);
  scene.add(rim);
  const fill = new THREE.DirectionalLight(0xd5e0ff, 0.5);
  fill.position.set(-1.8, 0.4, 2.8);
  scene.add(fill);

  const rig = new THREE.Group();
  scene.add(rig);

  const spin = { x: 0.12, y: 0.4 };
  let radius = 3;
  let dragging = false;
  let touched = reduced.matches;
  let lastX = 0;
  let lastY = 0;
  let vx = 0;
  let vy = 0;

  const resize = () => {
    const w = stage.clientWidth;
    const h = stage.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(h, 1);
    camera.updateProjectionMatrix();
  };

  const placeCamera = () => {
    camera.position.set(0, 0.08, radius);
    camera.lookAt(0, 0.02, 0);
  };

  const applySpin = () => {
    spin.x = Math.max(-1.2, Math.min(1.2, spin.x));
    rig.rotation.order = "YXZ";
    rig.rotation.y = spin.y;
    rig.rotation.x = spin.x;
  };

  const frame = (object) => {
    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    object.position.sub(center);
    const scale = 1.35 / Math.max(size.y, 0.001);
    object.scale.setScalar(scale);
    object.position.multiplyScalar(scale);
    const fitted = new THREE.Box3().setFromObject(object);
    const fittedSize = fitted.getSize(new THREE.Vector3());
    object.position.y -= fitted.getCenter(new THREE.Vector3()).y;
    const fov = (camera.fov * Math.PI) / 180;
    radius = (Math.max(fittedSize.y, fittedSize.x) * 0.6) / Math.tan(fov / 2);
    placeCamera();
  };

  const textures = new THREE.TextureLoader();
  const mapOf = (file, color) => {
    const tex = textures.load(MODEL + file);
    tex.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    tex.anisotropy = 8;
    return tex;
  };

  /* WebP copies of the Blender maps, made by tools/yx-model.html. */
  const material = new THREE.MeshStandardMaterial({
    map: mapOf("texture_diffuse.webp", true),
    normalMap: mapOf("texture_normal.webp", false),
    roughnessMap: mapOf("texture_roughness.webp", false),
    metalnessMap: mapOf("texture_metallic.webp", false),
    roughness: 0.82,
    metalness: 0.08
  });

  /* base.obj under a .txt name: GitHub Pages serves .obj as application/x-tgif
     and will not gzip it, which is 2.5 MB on the wire instead of 0.7 MB. */
  new OBJLoader().load(MODEL + "base.txt", (obj) => {
    obj.traverse((child) => {
      if (child.isMesh) child.material = material;
    });
    rig.add(obj);
    frame(obj);
    stage.classList.add("is-ready");
  }, undefined, () => {
    if (wait) wait.textContent = "模型没有立起来";
  });

  stage.addEventListener("pointerdown", (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    dragging = true;
    touched = true;
    lastX = e.clientX;
    lastY = e.clientY;
    vx = 0;
    vy = 0;
    stage.classList.add("is-drag");
    try { stage.setPointerCapture(e.pointerId); } catch (err) { /* optional */ }
  });
  stage.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    vx = dx;
    vy = dy;
    spin.y += dx * 0.012;
    spin.x += dy * 0.008;
    applySpin();
  });
  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    stage.classList.remove("is-drag");
  };
  stage.addEventListener("pointerup", endDrag);
  stage.addEventListener("pointercancel", endDrag);
  stage.addEventListener("keydown", (e) => {
    const step = 0.22;
    if (e.key === "ArrowLeft") spin.y -= step;
    else if (e.key === "ArrowRight") spin.y += step;
    else if (e.key === "ArrowUp") spin.x -= step;
    else if (e.key === "ArrowDown") spin.x += step;
    else return;
    e.preventDefault();
    touched = true;
    applySpin();
  });

  const observer = new ResizeObserver(resize);
  observer.observe(stage);
  resize();
  applySpin();

  /* Draws only while the stage is on screen and the tab is showing; otherwise
     a phone kept rendering the model on every frame for the rest of the visit. */
  let inView = false;
  let frameId = 0;
  const tick = () => {
    frameId = 0;
    if (!inView || document.hidden) return;
    if (!dragging && !touched && !reduced.matches) spin.y += 0.004;
    else if (!dragging) {
      spin.y += vx * 0.0022;
      spin.x += vy * 0.0014;
      vx *= 0.9;
      vy *= 0.9;
    }
    applySpin();
    placeCamera();
    renderer.render(scene, camera);
    frameId = requestAnimationFrame(tick);
  };
  const wake = () => {
    if (!frameId && inView && !document.hidden) frameId = requestAnimationFrame(tick);
  };
  new IntersectionObserver(([entry]) => {
    inView = entry.isIntersecting;
    wake();
  }).observe(stage);
  document.addEventListener("visibilitychange", wake);
}
