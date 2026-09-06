import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const source = path.resolve(
  "docs/design-reference/art/hablaman-puppet-source.png",
);
const output = path.resolve("public/mascot/motion");
await fs.mkdir(output, { recursive: true });
const { data, info } = await sharp(source)
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
// The generated atlas has a baked checkerboard. A border-connected matte keeps
// enclosed glove whites and globe highlights intact instead of color-keying them.
const visited = new Uint8Array(info.width * info.height);
const queue = new Int32Array(visited.length);
let head = 0,
  tail = 0;
function offer(x, y) {
  if (x < 0 || y < 0 || x >= info.width || y >= info.height) return;
  const i = y * info.width + x;
  if (visited[i]) return;
  visited[i] = 1;
  const p = i * 4;
  if (
    Math.min(data[p], data[p + 1], data[p + 2]) < 204 ||
    Math.max(data[p], data[p + 1], data[p + 2]) -
      Math.min(data[p], data[p + 1], data[p + 2]) >
      25
  )
    return;
  data[p + 3] = 0;
  queue[tail++] = i;
}
for (let x = 0; x < info.width; x++) {
  offer(x, 0);
  offer(x, info.height - 1);
}
for (let y = 0; y < info.height; y++) {
  offer(0, y);
  offer(info.width - 1, y);
}
while (head < tail) {
  const i = queue[head++],
    x = i % info.width,
    y = Math.floor(i / info.width);
  offer(x - 1, y);
  offer(x + 1, y);
  offer(x, y - 1);
  offer(x, y + 1);
}
const pieces = {
  body: [60, 57, 340, 370],
  cape: [427, 133, 400, 307],
  upperRight: [844, 197, 356, 119],
  upperLeft: [49, 581, 353, 124],
  fist: [470, 576, 318, 139],
  point: [836, 548, 376, 169],
  legLeft: [85, 864, 210, 317],
  legRight: [533, 864, 213, 321],
};
for (const [name, [left, top, width, height]] of Object.entries(pieces)) {
  const crop = await sharp(data, { raw: info })
    .extract({ left, top, width, height })
    .png()
    .toBuffer();
  await sharp(crop)
    .trim({ background: "#00000000", threshold: 5 })
    .webp({ quality: 94, alphaQuality: 100 })
    .toFile(path.join(output, `${name}.webp`));
}
console.log(
  `Prepared ${Object.keys(pieces).length} transparent puppet parts in ${output}`,
);
