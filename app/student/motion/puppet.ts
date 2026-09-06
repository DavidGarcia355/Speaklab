import { ease, lerp } from "./contracts";

const PARTS = [
  "body",
  "cape",
  "upperRight",
  "upperLeft",
  "fist",
  "point",
  "legLeft",
  "legRight",
] as const;
type Parts = Record<(typeof PARTS)[number], HTMLImageElement>;

export async function loadPuppet(): Promise<Parts> {
  const entries = await Promise.all(
    PARTS.map(async (name) => {
      const image = new Image();
      image.src = `/mascot/motion/${name}.webp`;
      await image.decode();
      return [name, image] as const;
    }),
  );
  return Object.fromEntries(entries) as Parts;
}

export function drawPuppet(
  ctx: CanvasRenderingContext2D,
  parts: Parts,
  time: number,
  progress: number,
  size: number,
  direction: number,
) {
  ctx.save();
  ctx.scale(size / 768, size / 768);
  const launch = ease(progress / 0.28),
    settle = ease((progress - 0.64) / 0.36);
  const tuck = Math.sin(progress * Math.PI);
  const breathe = Math.sin(time * 8) * 2;
  // Cloth deforms below its shoulder anchors; the top never floats off the body.
  const cape = parts.cape,
    strips = 96;
  for (let i = 0; i < strips; i++) {
    const v = i / strips,
      sh = cape.height / strips;
    const flutter = Math.sin(v * 7 - time * 17) * 24 * v * v * (0.3 + tuck);
    const sweep = direction * Math.sin(progress * Math.PI) * 60 * v * v;
    ctx.drawImage(
      cape,
      0,
      i * sh,
      cape.width,
      Math.min(sh + 1, cape.height - i * sh),
      -315 + flutter + sweep,
      -24 + v * 245,
      575,
      245 / strips + 1,
    );
  }
  const leg = (image: HTMLImageElement, x: number, angle: number) => {
    ctx.save();
    ctx.translate(x, 102);
    ctx.rotate(angle);
    ctx.drawImage(image, -48, -10, 108, 190);
    ctx.restore();
  };
  leg(parts.legLeft, -77, lerp(0.28, -0.8, tuck) + settle * 0.12);
  leg(parts.legRight, 63, lerp(-0.2, 0.95, tuck) - settle * 0.1);
  const arm = (side: number, upperAngle: number, foreAngle: number) => {
    ctx.save();
    ctx.translate(side < 0 ? -158 : 143, side < 0 ? -12 : -28);
    ctx.rotate(upperAngle);
    ctx.drawImage(
      side < 0 ? parts.upperLeft : parts.upperRight,
      -12,
      -30,
      112,
      60,
    );
    ctx.translate(87, 0);
    ctx.rotate(foreAngle - upperAngle);
    ctx.drawImage(side < 0 ? parts.fist : parts.point, -22, -34, 136, 68);
    ctx.restore();
  };
  ctx.drawImage(parts.body, -190, -244 + breathe * tuck, 355, 395);
  arm(
    -1,
    lerp(2.8, -2.2, launch) + tuck * 0.35 + settle * 0.8,
    lerp(-1.1, -2.7, launch) + settle * 1.1,
  );
  arm(
    1,
    lerp(-0.48, -0.85, launch) + tuck * 0.2 + settle * 0.45,
    lerp(-0.5, -0.3, launch) - settle * 0.25,
  );
  ctx.restore();
}
