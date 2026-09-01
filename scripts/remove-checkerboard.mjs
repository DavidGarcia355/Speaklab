import sharp from "sharp";

const [inputPath, outputPath, darkestArg = "200", spreadArg = "20"] = process.argv.slice(2);
const darkestFloor = Number(darkestArg);
const maximumSpread = Number(spreadArg);

if (
  !inputPath ||
  !outputPath ||
  !Number.isFinite(darkestFloor) ||
  !Number.isFinite(maximumSpread)
) {
  console.error(
    "Usage: node scripts/remove-checkerboard.mjs <input.png> <output.png> [darkest-floor] [maximum-channel-spread]",
  );
  process.exit(1);
}

const { data, info } = await sharp(inputPath)
  .removeAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });

const { width, height } = info;
const pixels = width * height;
const background = new Uint8Array(pixels);
const queue = new Int32Array(pixels);
let head = 0;
let tail = 0;

function isCheckerPixel(pixelIndex) {
  const offset = pixelIndex * 3;
  const red = data[offset];
  const green = data[offset + 1];
  const blue = data[offset + 2];
  const lightest = Math.max(red, green, blue);
  const darkest = Math.min(red, green, blue);
  return darkest >= darkestFloor && lightest - darkest <= maximumSpread;
}

function enqueue(pixelIndex) {
  if (background[pixelIndex] || !isCheckerPixel(pixelIndex)) return;
  background[pixelIndex] = 1;
  queue[tail++] = pixelIndex;
}

// Seed only the known checkerboard component. Seeding every border pixel can
// erase a light-colored subject that is deliberately cropped by the canvas.
enqueue(0);

if (tail === 0) {
  throw new Error("The top-left pixel is not part of a removable checkerboard background.");
}

while (head < tail) {
  const pixelIndex = queue[head++];
  const x = pixelIndex % width;
  const y = Math.floor(pixelIndex / width);
  if (x > 0) enqueue(pixelIndex - 1);
  if (x + 1 < width) enqueue(pixelIndex + 1);
  if (y > 0) enqueue(pixelIndex - width);
  if (y + 1 < height) enqueue(pixelIndex + width);
}

const output = Buffer.alloc(pixels * 4);
for (let pixelIndex = 0; pixelIndex < pixels; pixelIndex += 1) {
  const sourceOffset = pixelIndex * 3;
  const outputOffset = pixelIndex * 4;
  output[outputOffset] = data[sourceOffset];
  output[outputOffset + 1] = data[sourceOffset + 1];
  output[outputOffset + 2] = data[sourceOffset + 2];
  output[outputOffset + 3] = background[pixelIndex] ? 0 : 255;
}

await sharp(output, { raw: { width, height, channels: 4 } })
  .png()
  .toFile(outputPath);

console.log(
  `Removed ${tail.toLocaleString()} connected checkerboard pixels (darkest >= ${darkestFloor}, spread <= ${maximumSpread}).`,
);
