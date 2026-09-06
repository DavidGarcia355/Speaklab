import * as T from "three";

export type LandData = {
  features: {
    geometry: {
      type: "Polygon" | "MultiPolygon";
      coordinates: number[][][] | number[][][][];
    };
  }[];
};

export function globeTexture(land: LandData) {
  const canvas = document.createElement("canvas");
  canvas.width = 2048;
  canvas.height = 1024;
  const c = canvas.getContext("2d")!;
  const ocean = c.createLinearGradient(0, 0, 0, 1024);
  ocean.addColorStop(0, "#0bbde9");
  ocean.addColorStop(0.4, "#009de0");
  ocean.addColorStop(1, "#0068bd");
  c.fillStyle = ocean;
  c.fillRect(0, 0, 2048, 1024);
  const continents = c.createLinearGradient(0, 0, 0, 1024);
  continents.addColorStop(0, "#b1e25a");
  continents.addColorStop(0.55, "#75c93e");
  continents.addColorStop(1, "#56b341");
  for (const feature of land.features) {
    const polygons =
      feature.geometry.type === "Polygon"
        ? [feature.geometry.coordinates as number[][][]]
        : (feature.geometry.coordinates as number[][][][]);
    for (const rings of polygons) {
      c.beginPath();
      for (const ring of rings) {
        ring.forEach(([lon, lat], i) => {
          const x = ((lon + 180) / 360) * 2048,
            y = ((90 - lat) / 180) * 1024;
          if (i === 0) c.moveTo(x, y);
          else c.lineTo(x, y);
        });
        c.closePath();
      }
      c.fillStyle = continents;
      c.fill("evenodd");
    }
  }
  const texture = new T.CanvasTexture(canvas);
  texture.colorSpace = T.SRGBColorSpace;
  texture.wrapS = T.RepeatWrapping;
  texture.offset.x = 0.23;
  texture.anisotropy = 4;
  return texture;
}
