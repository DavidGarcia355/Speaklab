import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import sharp from "sharp";

const root = process.cwd();
const markPath = join(root, "public", "tryhabla-belt-mark.png");
const mark = await readFile(markPath);
const markDataUri = `data:image/png;base64,${mark.toString("base64")}`;

const standaloneSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 178 181" role="img" aria-labelledby="title description">
  <title id="title">TryHabla belt emblem</title>
  <desc id="description">HablaMan's canonical orange, gold, and ivory belt buckle with an inlaid H</desc>
  <image href="${markDataUri}" width="178" height="181" />
</svg>
`;

const authSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="84" viewBox="0 0 300 84" role="img" aria-labelledby="title description">
  <title id="title">TryHabla</title>
  <desc id="description">TryHabla logo with HablaMan's canonical belt buckle</desc>
  <rect width="300" height="84" rx="18" fill="#ffffff" />
  <image href="${markDataUri}" x="12" y="5" width="72" height="74" />
  <text x="96" y="53" fill="#10263e" font-family="Arial, Helvetica, sans-serif" font-size="36" font-weight="700">TryHabla</text>
</svg>
`;

const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" role="img" aria-labelledby="title description">
  <title id="title">TryHabla</title>
  <desc id="description">HablaMan's canonical belt buckle</desc>
  <rect width="96" height="96" rx="20" fill="#132b3b" />
  <image href="${markDataUri}" x="13" y="10" width="70" height="72" />
</svg>
`;

await Promise.all([
  writeFile(join(root, "public", "tryhabla-belt-mark.svg"), standaloneSvg),
  writeFile(join(root, "public", "tryhabla-auth-logo.svg"), authSvg),
  writeFile(join(root, "app", "icon.svg"), iconSvg),
]);

const faviconSizes = [16, 32, 48];
const faviconPngs = await Promise.all(
  faviconSizes.map((size) =>
    sharp(mark)
      .resize(size, size, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png({ compressionLevel: 9 })
      .toBuffer()
  )
);

const directorySize = 6 + faviconPngs.length * 16;
let imageOffset = directorySize;
const directory = Buffer.alloc(directorySize);
directory.writeUInt16LE(0, 0);
directory.writeUInt16LE(1, 2);
directory.writeUInt16LE(faviconPngs.length, 4);

faviconPngs.forEach((png, index) => {
  const entryOffset = 6 + index * 16;
  const size = faviconSizes[index];
  directory.writeUInt8(size === 256 ? 0 : size, entryOffset);
  directory.writeUInt8(size === 256 ? 0 : size, entryOffset + 1);
  directory.writeUInt8(0, entryOffset + 2);
  directory.writeUInt8(0, entryOffset + 3);
  directory.writeUInt16LE(1, entryOffset + 4);
  directory.writeUInt16LE(32, entryOffset + 6);
  directory.writeUInt32LE(png.length, entryOffset + 8);
  directory.writeUInt32LE(imageOffset, entryOffset + 12);
  imageOffset += png.length;
});

await writeFile(join(root, "app", "favicon.ico"), Buffer.concat([directory, ...faviconPngs]));

console.log("Synchronized canonical TryHabla logo assets.");
