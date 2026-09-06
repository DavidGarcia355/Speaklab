import * as T from "three";
import { createCharacter } from "./character";
import { createStudio } from "./studio";
import type { LandData } from "./textures";
import { simulatedEnergy, type SceneInput } from "./state";

export async function createHablaManScene(
  host: HTMLElement,
  input: SceneInput,
  onFailure: () => void,
  signal: AbortSignal,
) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("webgl2", {
    alpha: false,
    antialias: true,
    powerPreference: "high-performance",
  });
  if (!context) throw new Error("WebGL unavailable");
  const renderer = new T.WebGLRenderer({
    canvas,
    context,
    antialias: true,
    alpha: false,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(
    Math.min(devicePixelRatio, host.clientWidth < 700 ? 1.5 : 1.75),
  );
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.domElement.setAttribute("aria-hidden", "true");
  renderer.domElement.dataset.hablaman = "scene";
  host.appendChild(renderer.domElement);
  const scene = new T.Scene();
  scene.background = new T.Color("#edf4ef");
  scene.fog = new T.Fog("#edf4ef", 15, 35);
  const camera = new T.PerspectiveCamera(34, 1, 0.1, 80);
  const hemisphere = new T.HemisphereLight("#f4fcff", "#658467", 1.2);
  scene.add(hemisphere);
  const key = new T.DirectionalLight("#fff6e3", 2.4);
  key.position.set(-3, 6, 5);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -5;
  key.shadow.camera.right = 5;
  key.shadow.camera.top = 6;
  key.shadow.camera.bottom = -3;
  key.shadow.normalBias = 0.035;
  key.shadow.bias = -0.0003;
  key.shadow.blurSamples = 8;
  scene.add(key);
  const rim = new T.DirectionalLight("#a7ebff", 1.8);
  rim.position.set(3, 4, -2);
  scene.add(rim);
  const fill = new T.DirectionalLight("#ffe7bf", 0.4);
  fill.position.set(2, 2, 6);
  scene.add(fill);
  let buckle: T.Texture | undefined;
  let land: LandData;
  try {
    buckle = await new T.TextureLoader().loadAsync("/tryhabla-belt-mark.png");
    signal.throwIfAborted();
    buckle.colorSpace = T.SRGBColorSpace;
    const response = await fetch("/labs/hablaman/land.geojson", { signal });
    if (!response.ok) throw new Error("Unable to load studio assets");
    land = (await response.json()) as LandData;
    signal.throwIfAborted();
  } catch (error) {
    buckle?.dispose();
    renderer.dispose();
    renderer.domElement.remove();
    throw error;
  }
  const character = createCharacter(buckle, land);
  scene.add(character.root);
  const studio = createStudio();
  scene.add(studio.root);
  let width = host.clientWidth,
    height = host.clientHeight;
  let mobile = width < 760;
  let qualityReduced = false;
  function resize() {
    width = host.clientWidth;
    height = host.clientHeight;
    mobile = width < 760;
    renderer.setPixelRatio(
      qualityReduced ? 1 : Math.min(devicePixelRatio, mobile ? 1.5 : 1.75),
    );
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    character.root.position.x = mobile ? 0 : 1.3;
    studio.root.position.x = mobile ? 0 : 1.3;
  }
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();
  let destroyed = false,
    last = performance.now(),
    time = 0,
    intro = 0,
    lastReplay = input.replay,
    energy = 0;
  let cameraDepth = mobile ? Math.max(12.4, 7 / camera.aspect) : 9.7;
  let cameraAim = mobile ? 1.07 : 1.15;
  let staticSignature = "";
  let frame = 0,
    slowFrames = 0;
  function render(now: number) {
    if (destroyed) return;
    frame = requestAnimationFrame(render);
    if (document.hidden) {
      last = now;
      return;
    }
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    const staticMode = input.reducedMotion || input.paused;
    const signature = [
      input.state,
      input.replay,
      staticMode,
      width,
      height,
    ].join(":");
    if (staticMode && signature === staticSignature) return;
    staticSignature = staticMode ? signature : "";
    if (!staticMode) time += dt;
    if (lastReplay !== input.replay) {
      intro = 0;
      lastReplay = input.replay;
    }
    intro = staticMode ? 4 : Math.min(intro + dt, 4);
    const entrance = T.MathUtils.smoothstep(intro, 0.1, 2.8);
    const landing = 1 - Math.pow(1 - entrance, 3);
    character.root.position.y = staticMode
      ? 0
      : (1 - landing) * 1.8 - Math.sin(landing * Math.PI) * 0.05;
    character.root.rotation.y = (1 - landing) * -0.8;
    const desired =
      input.state === "listening"
        ? input.energy < 0
          ? simulatedEnergy(time)
          : input.energy
        : input.state === "thinking"
          ? 0.17
          : 0;
    energy = staticMode
      ? input.state === "listening"
        ? 0.35
        : 0
      : T.MathUtils.damp(energy, desired, 8, dt);
    character.update(
      time,
      dt,
      input.state,
      energy,
      input.pointer,
      staticMode,
      entrance,
    );
    studio.update(time, energy, input.state, staticMode, mobile);
    studio.root.scale.setScalar(mobile ? 0.86 : 1);
    const z =
      (mobile ? Math.max(12.4, 7 / camera.aspect) : 9.7) *
      (mobile && input.state === "feedback" ? (width < 375 ? 1.9 : 1.8) : 1);
    const close = input.state === "listening" && !mobile ? 0.3 : 0;
    const targetX = mobile ? 0 : -0.15;
    const aim = mobile ? (input.state === "feedback" ? -1.15 : 1.07) : 1.15;
    cameraDepth = staticMode ? z : T.MathUtils.damp(cameraDepth, z, 3.8, dt);
    cameraAim = staticMode ? aim : T.MathUtils.damp(cameraAim, aim, 3.8, dt);
    camera.position.set(
      targetX + (staticMode ? 0 : input.pointer.x * 0.035),
      mobile ? 3.0 : 3.25,
      cameraDepth + (1 - entrance) * 2 - close,
    );
    camera.lookAt(targetX, cameraAim, 0);
    (scene.fog as T.Fog).near = cameraDepth + 6;
    (scene.fog as T.Fog).far = cameraDepth + 26;
    key.intensity = 1.1 + entrance * 1.3;
    renderer.render(scene, camera);
    if (dt > 0.037) slowFrames++;
    else slowFrames = Math.max(0, slowFrames - 1);
    if (slowFrames > 100 && !qualityReduced) {
      renderer.setPixelRatio(1);
      renderer.shadowMap.enabled = false;
      qualityReduced = true;
    }
  }
  function contextLost(event: Event) {
    event.preventDefault();
    dispose();
    onFailure();
  }
  renderer.domElement.addEventListener("webglcontextlost", contextLost);
  frame = requestAnimationFrame(render);
  function dispose() {
    if (destroyed) return;
    destroyed = true;
    cancelAnimationFrame(frame);
    observer.disconnect();
    renderer.domElement.removeEventListener("webglcontextlost", contextLost);
    const geometries = new Set<T.BufferGeometry>();
    const materials = new Set<T.Material>();
    const textures = new Set<T.Texture>();
    scene.traverse((object) => {
      if (object instanceof T.Mesh || object instanceof T.Points) {
        geometries.add(object.geometry);
        (Array.isArray(object.material)
          ? object.material
          : [object.material]
        ).forEach((mat) => {
          materials.add(mat);
          for (const value of Object.values(mat))
            if (value instanceof T.Texture) textures.add(value);
        });
      }
    });
    geometries.forEach((g) => g.dispose());
    materials.forEach((m) => m.dispose());
    textures.forEach((t) => t.dispose());
    key.shadow.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  }
  return { dispose };
}
