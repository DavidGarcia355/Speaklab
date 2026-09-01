import sharp from "sharp";

const [sourcePath, outputPath = "public/tryhabla-belt-mark.png"] = process.argv.slice(2);

if (!sourcePath) {
  throw new Error("Pass the HablaMan canon-sheet path as the first argument.");
}

// Locked to the bottom-row buckle detail in the authoritative 1536x1024
// HablaMan character sheet. The mask follows the buckle's navy outer contour
// so the belt and reference-sheet background do not become part of the mark.
const crop = { left: 1065, top: 744, width: 178, height: 181 };
const mask = Buffer.from(`
  <svg xmlns="http://www.w3.org/2000/svg" width="178" height="181" viewBox="0 0 178 181">
    <path d="M89 5 L166 52 L144 150 L89 178 L31 149 L8 52 Z" fill="white" />
  </svg>
`);

const { data, info } = await sharp(sourcePath)
  .extract(crop)
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });

// Remove the neutral reference-sheet field and the soft gray cast shadow by
// flood-filling only from the crop edge. The buckle's navy contour keeps its
// ivory face sealed, so canon pixels inside the emblem remain untouched.
const visited = new Uint8Array(info.width * info.height);
const queue = new Int32Array(info.width * info.height);
let head = 0;
let tail = 0;

function enqueue(x, y) {
  if (x < 0 || y < 0 || x >= info.width || y >= info.height) return;
  const index = y * info.width + x;
  if (visited[index]) return;
  visited[index] = 1;
  queue[tail++] = index;
}

for (let x = 0; x < info.width; x += 1) {
  enqueue(x, 0);
  enqueue(x, info.height - 1);
}
for (let y = 0; y < info.height; y += 1) {
  enqueue(0, y);
  enqueue(info.width - 1, y);
}

while (head < tail) {
  const index = queue[head++];
  const offset = index * 4;
  const red = data[offset];
  const green = data[offset + 1];
  const blue = data[offset + 2];
  const lightest = Math.max(red, green, blue);
  const darkest = Math.min(red, green, blue);
  const isNeutralField = red > 168 && green > 164 && blue > 154 && lightest - darkest < 38;

  if (!isNeutralField) continue;

  data[offset + 3] = 0;
  const x = index % info.width;
  const y = Math.floor(index / info.width);
  enqueue(x - 1, y);
  enqueue(x + 1, y);
  enqueue(x, y - 1);
  enqueue(x, y + 1);
}

const buckle = await sharp(data, { raw: info }).png().toBuffer();

await sharp(buckle)
  .composite([{ input: mask, blend: "dest-in" }])
  .png({ compressionLevel: 9 })
  .toFile(outputPath);

const metadata = await sharp(outputPath).metadata();
console.log(`Wrote ${outputPath} (${metadata.width}x${metadata.height})`);
