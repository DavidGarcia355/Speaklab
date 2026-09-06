import {
  ease,
  flightPoint,
  imageBox,
  lerp,
  studentDestination,
  type Box,
  motionScore,
  LANDING_PROGRESS,
  progressBeforeArrival,
} from "./contracts";
import { drawPuppet, loadPuppet } from "./puppet";

const liveScene = () =>
  document.querySelector<HTMLElement>(".site-shell [data-student-scene]");
const avatar = (scene: HTMLElement | null) =>
  scene?.querySelector<HTMLImageElement>("[data-student-avatar]") ?? null;

export async function createDirector() {
  const parts = await loadPuppet();
  const canvas = document.createElement("canvas");
  canvas.className = "student-flight-canvas";
  canvas.setAttribute("aria-hidden", "true");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  const snapshot = document.createElement("div");
  snapshot.className = "student-flight-snapshot student-motion-scope";
  snapshot.setAttribute("aria-hidden", "true");
  snapshot.inert = true;
  document.body.append(snapshot, canvas);
  let frame = 0,
    active = false,
    target = "",
    started = 0,
    arrived = 0,
    routeCommitted = false,
    resumeProgress = 0,
    landingAt = 0;
  let sourceImage: HTMLImageElement | null = null,
    destinationImage: HTMLImageElement | null = null;
  let sourceBox: Box = { x: 0, y: 0, width: 0, height: 0 },
    destinationBox = sourceBox;
  let hiddenImages: HTMLImageElement[] = [],
    animations: Animation[] = [];
  let width = innerWidth,
    height = innerHeight,
    direction = 1;
  let score = motionScore("classes");
  let approachBox = sourceBox;
  const trail: { x: number; y: number }[] = [];

  function restore() {
    hiddenImages.forEach((image) => image.style.removeProperty("visibility"));
    hiddenImages = [];
    animations.forEach((animation) => animation.cancel());
    animations = [];
    snapshot.replaceChildren();
    snapshot.style.removeProperty("clip-path");
    snapshot.hidden = true;
    canvas.hidden = true;
    ctx!.clearRect(0, 0, width, height);
    delete document.documentElement.dataset.studentFlight;
  }
  function stop(focus = false) {
    active = false;
    cancelAnimationFrame(frame);
    restore();
    if (focus && document.activeElement === document.body) {
      const heading = liveScene()?.querySelector("h1");
      if (heading) {
        heading.tabIndex = -1;
        heading.focus({ preventScroll: true });
      }
    }
  }
  function hide(image: HTMLImageElement | null) {
    if (!image || hiddenImages.includes(image)) return;
    hiddenImages.push(image);
    image.style.visibility = "hidden";
  }
  function resize() {
    width = innerWidth;
    height = innerHeight;
    const dpr = Math.min(devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function ready(now: number) {
    if (!routeCommitted || arrived) return;
    const scene = liveScene();
    if (!scene || scene.dataset.studentReady === "false") return;
    if (scene.dataset.studentReady === "error") {
      stop(true);
      return;
    }
    destinationImage = avatar(scene);
    if (
      destinationImage &&
      (!destinationImage.complete || !destinationImage.naturalWidth)
    )
      return;
    arrived = now;
    resumeProgress = progressBeforeArrival(now - started, score);
    landingAt = now + (LANDING_PROGRESS - resumeProgress) * score.flight;
    destinationBox = destinationImage
      ? imageBox(destinationImage)
      : { x: width - 240, y: 120, width: 190, height: 190 };
    hide(destinationImage);
    const targets = scene.querySelectorAll<HTMLElement>(
      "[data-student-copy], .student-class-row, .student-assignment-row, .student-console-card",
    );
    targets.forEach((element, i) => {
      animations.push(
        element.animate(
          [
            { transform: `translate(${direction * 24}px, 8px)`, opacity: 0.65 },
            { transform: "none", opacity: 1 },
          ],
          {
            duration: 420,
            delay: Math.min(i * 35, 140),
            easing: "cubic-bezier(.18,.8,.2,1)",
          },
        ),
      );
    });
  }
  function draw(now: number) {
    if (!active) return;
    ready(now);
    if (!active) return;
    const elapsed = now - started;
    // A slow route holds a gentle bank, never a blank interstitial. Navigation
    // itself is never delayed; after arrival the destination is immediately live.
    const progress = arrived
      ? Math.min(
          resumeProgress +
            Math.max(0, now - Math.max(arrived, started + score.anticipation)) /
              score.flight,
          LANDING_PROGRESS,
        )
      : progressBeforeArrival(elapsed, score);
    const landing = arrived
      ? ease(
          (now -
            Math.max(
              landingAt,
              started + score.anticipation + LANDING_PROGRESS * score.flight,
            )) /
            score.landing,
        )
      : 0;
    const travel = landing > 0 ? lerp(LANDING_PROGRESS, 1, landing) : progress;
    ctx!.clearRect(0, 0, width, height);
    const end = arrived ? destinationBox : approachBox;
    // The path is established at launch. Route readiness cannot teleport him
    // to a differently sized destination hero halfway through the flight.
    const position = flightPoint(
      sourceBox,
      approachBox,
      Math.min(travel, LANDING_PROGRESS),
      width,
      height,
      score.arc,
    );
    if (landing > 0) {
      const settle = ease(landing / 0.52);
      position.x = lerp(position.x, end.x + end.width / 2, settle);
      position.y = lerp(position.y, end.y + end.height / 2, settle);
    }
    const startSize = sourceBox.width;
    const heroSize = (width < 600 ? 245 : 430) * score.scale;
    const flyingSize = lerp(
      startSize,
      heroSize,
      Math.sin(Math.min(travel, LANDING_PROGRESS) * Math.PI),
    );
    const targetSize =
      end.height * (studentDestination(target) === "classes" ? 1.8 : 1.05);
    const size =
      landing > 0
        ? lerp(flyingSize, targetSize, ease(landing / 0.52))
        : flyingSize;
    trail.push(position);
    if (trail.length > 18) trail.shift();
    if (progress > 0.1 && landing < 0.7) {
      ctx!.save();
      ctx!.lineCap = "round";
      ctx!.lineJoin = "round";
      for (const [offset, color, thickness] of [
        [0, "#f87927", 16],
        [16, "#198dbc", 5],
        [25, "#f6c247", 3],
      ] as const) {
        ctx!.strokeStyle = color;
        ctx!.lineWidth = thickness * Math.sin(travel * Math.PI);
        ctx!.globalAlpha = 0.32;
        ctx!.beginPath();
        trail.forEach((point, i) =>
          i
            ? ctx!.lineTo(point.x + offset, point.y + size * 0.16)
            : ctx!.moveTo(point.x + offset, point.y + size * 0.16),
        );
        ctx!.stroke();
      }
      ctx!.restore();
    }
    if (arrived) {
      const revealAt = Math.max(
        arrived,
        started + score.anticipation + Math.min(180, score.flight * 0.18),
      );
      const reveal = ease(
        (now - revealAt) / Math.min(340, score.flight * 0.42),
      );
      snapshot.style.clipPath = `polygon(0 0, ${100 - reveal * 120}% 0, ${120 - reveal * 120}% 100%, 0 100%)`;
      const outgoing = snapshot.firstElementChild as HTMLElement | null;
      if (outgoing)
        outgoing.style.transform = `translateX(${-direction * reveal * 64}px)`;
      if (reveal === 1) snapshot.hidden = true;
    }
    ctx!.save();
    if (elapsed < score.anticipation && sourceImage) {
      const anticipation = Math.sin((elapsed / score.anticipation) * Math.PI);
      ctx!.translate(
        sourceBox.x + sourceBox.width / 2,
        sourceBox.y + sourceBox.height / 2,
      );
      ctx!.rotate(-anticipation * 0.05);
      ctx!.scale(1 + anticipation * 0.035, 1 - anticipation * 0.045);
      ctx!.drawImage(
        sourceImage,
        -sourceBox.width / 2,
        -sourceBox.height / 2,
        sourceBox.width,
        sourceBox.height,
      );
    } else if (landing > 0.52 && destinationImage) {
      // A narrow, edge-on turn changes the view of the character, then opens
      // directly into the original destination artwork without a pose crossfade.
      const unfold = ease((landing - 0.52) / 0.48);
      ctx!.translate(end.x + end.width / 2, end.y + end.height / 2);
      ctx!.scale(Math.max(0.015, unfold), 1 + (1 - unfold) * 0.08);
      ctx!.drawImage(
        destinationImage,
        -end.width / 2,
        -end.height / 2,
        end.width,
        end.height,
      );
    } else {
      ctx!.translate(position.x, position.y);
      const airborne = ease((travel - 0.1) / 0.64);
      const bank =
        direction * (-0.22 - Math.sin(airborne * Math.PI) * 0.52 * score.arc);
      ctx!.rotate(bank * (1 - landing));
      const turn = landing > 0 ? Math.max(0.015, 1 - landing / 0.52) : 1;
      ctx!.scale(turn, 1);
      drawPuppet(ctx!, parts, elapsed / 1000, airborne, size, direction);
    }
    ctx!.restore();
    canvas.dataset.progress = travel.toFixed(3);
    if (landing === 1 || elapsed > 5000) {
      stop(Boolean(arrived));
      return;
    }
    frame = requestAnimationFrame(draw);
  }
  restore();
  return {
    start(path: string) {
      stop();
      const scene = liveScene();
      sourceImage = avatar(scene);
      if (!scene || !sourceImage?.complete || !sourceImage.naturalWidth) return;
      sourceBox = imageBox(sourceImage);
      if (sourceBox.y + sourceBox.height < 0 || sourceBox.y > innerHeight)
        return;
      const clone = scene.cloneNode(true) as HTMLElement;
      clone
        .querySelectorAll("audio, video, iframe, script")
        .forEach((node) => node.remove());
      clone
        .querySelectorAll("[id]")
        .forEach((node) => node.removeAttribute("id"));
      const cloneAvatar = avatar(clone);
      if (cloneAvatar) cloneAvatar.style.visibility = "hidden";
      const rect = scene.getBoundingClientRect();
      const top = Math.max(0, rect.top);
      snapshot.style.top = `${top}px`;
      snapshot.style.height = `${Math.min(innerHeight - top, rect.height)}px`;
      Object.assign(clone.style, {
        position: "absolute",
        left: `${rect.left}px`,
        top: `${rect.top - top}px`,
        width: `${rect.width}px`,
        margin: "0",
        maxWidth: "none",
      });
      snapshot.append(clone);
      snapshot.hidden = false;
      canvas.hidden = false;
      hide(sourceImage);
      active = true;
      target = path;
      score = motionScore(studentDestination(path)!);
      approachBox = sourceBox;
      started = performance.now();
      arrived = 0;
      routeCommitted = false;
      destinationImage = null;
      trail.length = 0;
      direction = studentDestination(path) === "recordings" ? -1 : 1;
      document.documentElement.dataset.studentFlight = "active";
      resize();
      frame = requestAnimationFrame(draw);
    },
    commit(path: string) {
      if (!active) return;
      if (path === target) routeCommitted = true;
      else stop();
    },
    cancel: () => stop(),
    dispose() {
      stop();
      canvas.remove();
      snapshot.remove();
    },
  };
}
