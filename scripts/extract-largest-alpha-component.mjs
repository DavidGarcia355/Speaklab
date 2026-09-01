import sharp from "sharp";

const [inputPath, outputPath, alphaArg = "16", paddingArg = "24"] =
  process.argv.slice(2);
const alphaFloor = Number(alphaArg);
const padding = Number(paddingArg);

if (
  !inputPath ||
  !outputPath ||
  !Number.isInteger(alphaFloor) ||
  alphaFloor < 0 ||
  alphaFloor > 255 ||
  !Number.isInteger(padding) ||
  padding < 0
) {
  console.error(
    "Usage: node scripts/extract-largest-alpha-component.mjs <input.png> <output.png> [alpha-floor] [padding]",
  );
  process.exit(1);
}

const { data, info } = await sharp(inputPath)
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });

const { width, height } = info;
const pixels = width * height;
const seen = new Uint8Array(pixels);
const queue = new Int32Array(pixels);
let largest = [];

function isForeground(pixelIndex) {
  return data[pixelIndex * 4 + 3] >= alphaFloor;
}

for (let start = 0; start < pixels; start += 1) {
  if (seen[start] || !isForeground(start)) continue;

  let head = 0;
  let tail = 0;
  const component = [];
  seen[start] = 1;
  queue[tail++] = start;

  while (head < tail) {
    const pixelIndex = queue[head++];
    component.push(pixelIndex);
    const x = pixelIndex % width;
    const y = Math.floor(pixelIndex / width);

    const neighbors = [];
    if (x > 0) neighbors.push(pixelIndex - 1);
    if (x + 1 < width) neighbors.push(pixelIndex + 1);
    if (y > 0) neighbors.push(pixelIndex - width);
    if (y + 1 < height) neighbors.push(pixelIndex + width);

    for (const neighbor of neighbors) {
      if (seen[neighbor] || !isForeground(neighbor)) continue;
      seen[neighbor] = 1;
      queue[tail++] = neighbor;
    }
  }

  if (component.length > largest.length) largest = component;
}

if (largest.length === 0) {
  throw new Error("No opaque component found in the supplied image.");
}

const keep = new Uint8Array(pixels);
for (const pixelIndex of largest) keep[pixelIndex] = 1;

let minX = width;
let minY = height;
let maxX = -1;
let maxY = -1;

for (let pixelIndex = 0; pixelIndex < pixels; pixelIndex += 1) {
  const outputOffset = pixelIndex * 4;
  if (!keep[pixelIndex]) {
    data[outputOffset + 3] = 0;
    continue;
  }

  const x = pixelIndex % width;
  const y = Math.floor(pixelIndex / width);
  minX = Math.min(minX, x);
  minY = Math.min(minY, y);
  maxX = Math.max(maxX, x);
  maxY = Math.max(maxY, y);
}

const componentWidth = maxX - minX + 1;
const componentHeight = maxY - minY + 1;

await sharp(data, { raw: { width, height, channels: 4 } })
  .extract({
    left: minX,
    top: minY,
    width: componentWidth,
    height: componentHeight,
  })
  .extend({
    top: padding,
    bottom: padding,
    left: padding,
    right: padding,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  })
  .png()
  .toFile(outputPath);

console.log(
  `Kept ${largest.length.toLocaleString()} pixels in the largest alpha component (${componentWidth}x${componentHeight}) with ${padding}px padding.`,
);
