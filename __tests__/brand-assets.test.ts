import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (...parts: string[]) => readFileSync(join(root, ...parts));
const readText = (...parts: string[]) => read(...parts).toString("utf8");

describe("canonical TryHabla mark", () => {
  const mark = read("public", "tryhabla-belt-mark.png");
  const embeddedMark = `data:image/png;base64,${mark.toString("base64")}`;

  it("keeps the extracted HablaMan buckle at its undistorted intrinsic ratio", () => {
    expect(mark.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(mark.readUInt32BE(16)).toBe(178);
    expect(mark.readUInt32BE(20)).toBe(181);

    const component = readText("app", "components", "BeltMark.tsx");
    expect(component).toContain('src="/tryhabla-belt-mark.png"');
    expect(component).toContain("width={178}");
    expect(component).toContain("height={181}");
  });

  it("synchronizes the same canon pixels into standalone, auth, and install SVGs", () => {
    for (const asset of [
      ["public", "tryhabla-belt-mark.svg"],
      ["public", "tryhabla-auth-logo.svg"],
      ["app", "icon.svg"],
    ]) {
      expect(readText(...asset)).toContain(embeddedMark);
    }
  });

  it("uses the canonical mark for social cards and a real multi-size favicon", () => {
    expect(readText("app", "_social", "SocialCard.tsx")).toContain(
      'join(process.cwd(), "public", "tryhabla-belt-mark.png")'
    );

    const favicon = read("app", "favicon.ico");
    expect(favicon.readUInt16LE(0)).toBe(0);
    expect(favicon.readUInt16LE(2)).toBe(1);
    expect(favicon.readUInt16LE(4)).toBe(3);

    for (let index = 0; index < 3; index += 1) {
      const entryOffset = 6 + index * 16;
      const imageOffset = favicon.readUInt32LE(entryOffset + 12);
      expect(favicon.subarray(imageOffset, imageOffset + 8).toString("hex")).toBe(
        "89504e470d0a1a0a"
      );
    }
  });
});
