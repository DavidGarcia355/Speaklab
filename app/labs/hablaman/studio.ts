import * as T from "three";

export function createStudio() {
  const root = new T.Group();
  const floor = new T.Mesh(
    new T.PlaneGeometry(200, 200),
    new T.MeshStandardMaterial({ color: "#e4efec", roughness: 0.92 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.1;
  floor.receiveShadow = true;
  root.add(floor);
  const stage = new T.Mesh(
    new T.CylinderGeometry(1.75, 1.8, 0.13, 96),
    new T.MeshStandardMaterial({ color: "#f7fbf5", roughness: 0.82 }),
  );
  stage.position.y = -0.05;
  stage.receiveShadow = true;
  root.add(stage);
  const edge = new T.Mesh(
    new T.TorusGeometry(1.74, 0.014, 8, 128),
    new T.MeshStandardMaterial({ color: "#278e9a", roughness: 0.7 }),
  );
  edge.rotation.x = Math.PI / 2;
  edge.position.y = 0.017;
  root.add(edge);

  // Open architectural arcs form a speaking studio, leaving the face unobstructed.
  const ribs = new T.Group();
  root.add(ribs);
  [2.7, 3.02, 3.34].forEach((r, i) => {
    const shape = new T.TorusGeometry(r, 0.045, 8, 96, Math.PI * 1.18);
    const rib = new T.Mesh(
      shape,
      new T.MeshStandardMaterial({
        color: ["#94c4bf", "#c3d9d1", "#d1dad2"][i],
        roughness: 0.82,
      }),
    );
    rib.rotation.z = -Math.PI * 0.09;
    rib.position.set(0, 0.55, -2.5 - i * 0.14);
    ribs.add(rib);
  });
  const acoustic = new T.Group();
  root.add(acoustic);
  for (let i = 0; i < 13; i++) {
    const a = (i / 12) * Math.PI * 0.8 + Math.PI * 0.1;
    const slat = new T.Mesh(
      new T.BoxGeometry(0.075, 0.8 + Math.sin(i * 0.8) * 0.25, 0.07),
      new T.MeshStandardMaterial({
        color: i % 3 === 0 ? "#e9ba6c" : "#adc6be",
        roughness: 0.85,
      }),
    );
    slat.position.set(Math.cos(a) * 3.85, 0.5, -2.9 - Math.sin(a));
    acoustic.add(slat);
  }

  const count = 180;
  // Speech leaves the microphone around the silhouette, never across the face.
  const desktopThoughtPath = new T.CatmullRomCurve3([
    new T.Vector3(0.9, 1.85, 1.1),
    new T.Vector3(1.7, 1.4, 1.2),
    new T.Vector3(1.65, 0.6, 1.3),
    new T.Vector3(0.4, 0.5, 1.7),
    new T.Vector3(-1.4, 0.85, 1.3),
    new T.Vector3(-3.4, 1.6, 0.8),
  ]).getPoints(count - 1);
  const mobileThoughtPath = new T.CatmullRomCurve3([
    new T.Vector3(0.9, 1.85, 1.1),
    new T.Vector3(1.55, 1.1, 1.3),
    new T.Vector3(1.15, 0.3, 1.5),
    new T.Vector3(0, -0.05, 1.7),
  ]).getPoints(count - 1);
  const ribbonGeometry = new T.BufferGeometry();
  const vertices = new Float32Array(count * 2 * 3);
  const indices: number[] = [];
  for (let i = 0; i < count - 1; i++)
    indices.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  ribbonGeometry.setAttribute("position", new T.BufferAttribute(vertices, 3));
  ribbonGeometry.setIndex(indices);
  const ribbonMaterial = new T.MeshBasicMaterial({
    color: "#008ca6",
    transparent: true,
    opacity: 0,
    side: T.DoubleSide,
    depthWrite: false,
  });
  const ribbon = new T.Mesh(ribbonGeometry, ribbonMaterial);
  ribbon.frustumCulled = false;
  root.add(ribbon);
  const accentMaterial = new T.MeshBasicMaterial({
    color: "#ed913a",
    transparent: true,
    opacity: 0,
  });
  const accent = new T.Mesh(
    new T.TorusGeometry(1.7, 0.018, 6, 96, Math.PI * 0.7),
    accentMaterial,
  );
  accent.rotation.x = Math.PI / 2;
  accent.position.y = 0.045;
  root.add(accent);

  const motesGeometry = new T.BufferGeometry();
  const motes = new Float32Array(42 * 3);
  for (let i = 0; i < 42; i++)
    motes.set(
      [
        Math.sin(i * 13.2) * 2.7,
        0.4 + (i % 17) * 0.22,
        Math.cos(i * 7.7) * 1.8,
      ],
      i * 3,
    );
  motesGeometry.setAttribute("position", new T.BufferAttribute(motes, 3));
  const motesMat = new T.PointsMaterial({
    color: "#c38a28",
    size: 0.028,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const points = new T.Points(motesGeometry, motesMat);
  root.add(points);
  let lastState = "ready",
    stateTime = 0;
  return {
    root,
    update(
      time: number,
      energy: number,
      state: string,
      reduced: boolean,
      mobile: boolean,
    ) {
      if (state !== lastState) {
        lastState = state;
        stateTime = time;
      }
      const active = state === "listening" || state === "thinking";
      ribbonMaterial.opacity = active ? 0.48 + energy * 0.35 : 0;
      ribbonMaterial.color.set(state === "thinking" ? "#e2a03a" : "#008ca6");
      for (let i = 0; i < count; i++) {
        const u = i / (count - 1);
        const a = u * Math.PI * 2 + (reduced ? 0 : time * 0.2);
        const radius = 1.6 + Math.sin(u * 10 + time * 1.3) * energy * 0.18;
        const wave = reduced ? 0 : Math.sin(u * 36 - time * 3) * energy * 0.11;
        const y = 0.4 + Math.sin(a) * 0.13 + wave;
        const thickness =
          0.025 + energy * 0.07 * (0.5 + Math.sin(u * 23 - time * 2) * 0.5);
        if (state === "thinking") {
          const travel = reduced ? 0.5 : Math.min(1, (time - stateTime) / 2.4);
          const envelope = Math.exp(-(((u - travel) * 5) ** 2));
          const point = (mobile ? mobileThoughtPath : desktopThoughtPath)[i];
          vertices.set(
            [point.x, point.y - thickness * envelope, point.z],
            i * 6,
          );
          vertices.set(
            [point.x, point.y + thickness * envelope, point.z],
            i * 6 + 3,
          );
        } else {
          vertices.set(
            [Math.cos(a) * radius, y - thickness, Math.sin(a) * radius],
            i * 6,
          );
          vertices.set(
            [Math.cos(a) * radius, y + thickness, Math.sin(a) * radius],
            i * 6 + 3,
          );
        }
      }
      ribbonGeometry.attributes.position.needsUpdate = true;
      accentMaterial.opacity = active ? 0.7 : state === "success" ? 0.8 : 0.15;
      accent.rotation.z = reduced
        ? 0
        : time * (state === "thinking" ? 1.5 : 0.1);
      motesMat.opacity = state === "success" && !reduced ? 0.7 : 0;
      points.rotation.y = reduced ? 0 : time * 0.15;
    },
  };
}
