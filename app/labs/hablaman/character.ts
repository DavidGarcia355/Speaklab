import * as T from "three";
import type { CharacterState } from "./state";
import { globeTexture, type LandData } from "./textures";

export function createCharacter(buckleTexture: T.Texture, land: LandData) {
  const INK = "#102c48";
  const material = (color: string, roughness = 0.55, metalness = 0) =>
    new T.MeshStandardMaterial({ color, roughness, metalness });
  const blue = material("#0074ce", 0.52);
  const orange = material("#ee6408", 0.65);
  const gold = material("#ffbc39", 0.36, 0.25);
  const ivory = material("#fff9e9", 0.72);
  const navy = material(INK, 0.6);
  const outlineMaterial = new T.MeshBasicMaterial({
    color: INK,
    side: T.BackSide,
  });

  function mesh(
    parent: T.Object3D,
    geometry: T.BufferGeometry,
    mat: T.Material,
    position = [0, 0, 0],
    scale = [1, 1, 1],
    outline = false,
  ) {
    const object = new T.Mesh(geometry, mat);
    object.position.set(...(position as [number, number, number]));
    object.scale.set(...(scale as [number, number, number]));
    object.castShadow = true;
    object.receiveShadow = true;
    if (outline) {
      const edge = new T.Mesh(geometry, outlineMaterial);
      edge.scale.setScalar(1.035);
      object.add(edge);
    }
    parent.add(object);
    return object;
  }

  const ballGeometry = new T.SphereGeometry(1, 32, 24);
  function ball(
    parent: T.Object3D,
    mat: T.Material,
    position: number[],
    scale: number[],
    outline = true,
  ) {
    return mesh(parent, ballGeometry, mat, position, scale, outline);
  }

  function line(
    parent: T.Object3D,
    points: number[][],
    radius: number,
    mat: T.Material,
  ) {
    const curve = new T.CatmullRomCurve3(
      points.map((p) => new T.Vector3(...(p as [number, number, number]))),
    );
    return mesh(parent, new T.TubeGeometry(curve, 24, radius, 8, false), mat);
  }

  function glove(parent: T.Object3D) {
    const hand = new T.Group();
    parent.add(hand);
    ball(hand, ivory, [0, 0.02, 0], [0.17, 0.19, 0.11]);
    // Three fingers and one thumb, with separate knuckles and navy seams.
    const fingers: T.Mesh[] = [];
    [-0.105, 0, 0.105].forEach((x, i) => {
      fingers.push(
        ball(
          hand,
          ivory,
          [x, 0.16 + (i === 1 ? 0.025 : 0), 0.035],
          [0.075, 0.125, 0.09],
        ),
      );
    });
    const thumb = ball(hand, ivory, [-0.17, 0.055, 0.085], [0.095, 0.14, 0.09]);
    thumb.rotation.z = -0.65;
    hand.userData.fingers = fingers;
    mesh(
      hand,
      new T.CylinderGeometry(0.15, 0.16, 0.13, 24),
      ivory,
      [0, -0.17, 0],
      [1, 1, 1],
      true,
    );
    mesh(
      hand,
      new T.TorusGeometry(0.151, 0.022, 8, 32),
      gold,
      [0, -0.17, 0],
    ).rotation.x = Math.PI / 2;
    return hand;
  }

  function microphone() {
    const mic = new T.Group();
    mesh(
      mic,
      new T.CylinderGeometry(0.076, 0.058, 0.42, 24),
      blue,
      [0, 0.08, 0],
      [1, 1, 1],
      true,
    );
    mesh(
      mic,
      new T.CylinderGeometry(0.111, 0.093, 0.075, 24),
      gold,
      [0, 0.3, 0],
      [1, 1, 1],
      true,
    );
    ball(
      mic,
      material("#ffe6a2", 0.6, 0.13),
      [0, 0.425, 0],
      [0.125, 0.155, 0.125],
    );
    const grille = material("#ae7e31", 0.6, 0.15);
    for (let i = -3; i <= 3; i++) {
      const y = i * 0.034;
      const r = 0.127 * Math.sqrt(1 - (y / 0.157) ** 2);
      mesh(mic, new T.TorusGeometry(r, 0.0032, 4, 40), grille, [
        0,
        0.425 + y,
        0,
      ]).rotation.x = Math.PI / 2;
    }
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const pts = Array.from({ length: 17 }, (_, j) => {
        const phi = (j / 16) * Math.PI;
        return [
          Math.sin(phi) * Math.cos(a) * 0.127,
          0.425 + Math.cos(phi) * 0.157,
          Math.sin(phi) * Math.sin(a) * 0.127,
        ];
      });
      line(mic, pts, 0.0025, grille);
    }
    mesh(
      mic,
      new T.TorusGeometry(0.071, 0.009, 6, 24),
      navy,
      [0, -0.06, 0],
    ).rotation.x = Math.PI / 2;
    return mic;
  }

  const root = new T.Group();
  const body = new T.Group();
  body.position.y = 2.02;
  root.add(body);
  const globe = ball(
    body,
    new T.MeshStandardMaterial({
      map: globeTexture(land),
      roughness: 0.65,
      metalness: 0,
    }),
    [0, 0, 0],
    [1.075, 1.12, 1.02],
  );
  globe.name = "canonical-globe-body";

  const eyes: T.Group[] = [];
  const pupils: T.Group[] = [];
  [-1, 1].forEach((side) => {
    const eye = new T.Group();
    eye.position.set(side * 0.35, 0.33, 0.92);
    eye.rotation.y = side * 0.12;
    body.add(eye);
    eyes.push(eye);
    ball(eye, navy, [0, 0, 0], [0.239, 0.326, 0.093], false);
    ball(eye, ivory, [0, -0.005, 0.025], [0.217, 0.301, 0.085], false);
    const pupil = new T.Group();
    pupil.position.set(0.022, -0.026, 0.095);
    eye.add(pupil);
    pupils.push(pupil);
    ball(pupil, navy, [0, 0, 0], [0.119, 0.182, 0.028], false);
    ball(
      pupil,
      material("#007ebf", 0.3),
      [0, -0.003, 0.023],
      [0.098, 0.16, 0.024],
      false,
    );
    ball(pupil, navy, [0, 0.025, 0.04], [0.064, 0.115, 0.022], false);
    ball(
      pupil,
      new T.MeshBasicMaterial({ color: "#ffffff" }),
      [0.04, 0.105, 0.06],
      [0.035, 0.047, 0.017],
      false,
    );
    ball(
      pupil,
      new T.MeshBasicMaterial({ color: "#8fdcff" }),
      [-0.038, -0.091, 0.057],
      [0.017, 0.023, 0.011],
      false,
    );
    const brow = line(
      body,
      [
        [side * 0.18, 0.76, 0.78],
        [side * 0.33, 0.81, 0.72],
        [side * 0.52, 0.74, 0.68],
      ],
      0.034,
      navy,
    );
    ball(brow, navy, [side * 0.18, 0.76, 0.78], [0.034, 0.034, 0.034], false);
    ball(brow, navy, [side * 0.52, 0.74, 0.68], [0.025, 0.025, 0.025], false);
  });

  const mouth = new T.Group();
  body.add(mouth);
  const smile = new T.Shape();
  smile.moveTo(-0.35, -0.08);
  smile.quadraticCurveTo(0, -0.2, 0.35, -0.08);
  smile.bezierCurveTo(0.27, -0.49, -0.23, -0.49, -0.35, -0.08);
  function facePatch(shape: T.Shape, mat: T.Material, lift: number) {
    const source = new T.ShapeGeometry(shape, 24).toNonIndexed();
    const coordinates: number[] = [];
    function subdivide(
      a: T.Vector2,
      b: T.Vector2,
      c: T.Vector2,
      depth: number,
    ) {
      if (depth > 0) {
        const ab = a.clone().add(b).multiplyScalar(0.5),
          bc = b.clone().add(c).multiplyScalar(0.5),
          ca = c.clone().add(a).multiplyScalar(0.5);
        subdivide(a, ab, ca, depth - 1);
        subdivide(ab, b, bc, depth - 1);
        subdivide(ca, bc, c, depth - 1);
        subdivide(ab, bc, ca, depth - 1);
        return;
      }
      for (const p of [a, b, c])
        coordinates.push(
          p.x,
          p.y,
          Math.sqrt(Math.max(0, 1 - (p.x / 1.075) ** 2 - (p.y / 1.12) ** 2)) *
            1.02 +
            lift,
        );
    }
    const p = source.attributes.position;
    for (let i = 0; i < p.count; i += 3)
      subdivide(
        new T.Vector2(p.getX(i), p.getY(i)),
        new T.Vector2(p.getX(i + 1), p.getY(i + 1)),
        new T.Vector2(p.getX(i + 2), p.getY(i + 2)),
        3,
      );
    source.dispose();
    const geometry = new T.BufferGeometry();
    geometry.setAttribute(
      "position",
      new T.Float32BufferAttribute(coordinates, 3),
    );
    geometry.computeVertexNormals();
    return mesh(mouth, geometry, mat);
  }
  facePatch(
    smile,
    new T.MeshBasicMaterial({ color: "#481c23", side: T.DoubleSide }),
    0.025,
  );
  const smilePoints = smile
    .getPoints(32)
    .map((p) => [
      p.x,
      p.y,
      Math.sqrt(Math.max(0, 1 - (p.x / 1.075) ** 2 - (p.y / 1.12) ** 2)) *
        1.02 +
        0.03,
    ]);
  line(mouth, smilePoints, 0.019, navy);
  const tongue = new T.Shape();
  tongue.moveTo(-0.19, -0.31);
  tongue.quadraticCurveTo(-0.04, -0.19, 0.19, -0.3);
  tongue.quadraticCurveTo(0.01, -0.47, -0.19, -0.31);
  facePatch(
    tongue,
    new T.MeshBasicMaterial({ color: "#f47963", side: T.DoubleSide }),
    0.044,
  );
  line(
    body,
    [
      [-0.395, -0.12, 0.948],
      [-0.36, -0.1, 0.97],
      [-0.33, -0.13, 0.988],
    ],
    0.016,
    navy,
  );
  line(
    body,
    [
      [0.33, -0.13, 0.988],
      [0.36, -0.1, 0.97],
      [0.395, -0.12, 0.948],
    ],
    0.016,
    navy,
  );

  const beltGeo = new T.SphereGeometry(1, 64, 8, 0, Math.PI * 2, 2.08, 0.18);
  mesh(body, beltGeo, orange, [0, 0, 0], [1.09, 1.135, 1.04], true);
  for (const angle of [2.09, 2.25]) {
    const r = Math.sin(angle);
    const ring = mesh(
      body,
      new T.TorusGeometry(r, 0.014, 8, 80),
      gold,
      [0, Math.cos(angle) * 1.135, 0],
      [1.09, 1.04, 1],
    );
    ring.rotation.x = Math.PI / 2;
  }
  const emblem = new T.Shape();
  [
    [0, 0.31],
    [0.29, 0.14],
    [0.21, -0.23],
    [0, -0.34],
    [-0.21, -0.23],
    [-0.29, 0.14],
  ].forEach(([x, y], i) => (i ? emblem.lineTo(x, y) : emblem.moveTo(x, y)));
  emblem.closePath();
  const buckle = mesh(
    body,
    new T.ExtrudeGeometry(emblem, {
      depth: 0.055,
      bevelEnabled: true,
      bevelSize: 0.023,
      bevelThickness: 0.018,
      bevelSegments: 3,
      steps: 1,
    }),
    gold,
    [0, -0.7, 0.9],
  );
  mesh(
    buckle,
    new T.PlaneGeometry(0.64, 0.66),
    new T.MeshBasicMaterial({
      map: buckleTexture,
      transparent: true,
      depthWrite: false,
    }),
    [0, -0.005, 0.084],
  );
  buckle.name = "canonical-buckle";

  const capeGeo = new T.PlaneGeometry(1, 1, 32, 28);
  mesh(
    body,
    capeGeo,
    new T.MeshStandardMaterial({
      color: "#de5206",
      roughness: 0.93,
      side: T.DoubleSide,
    }),
  );
  mesh(
    body,
    capeGeo,
    new T.MeshBasicMaterial({ color: INK, side: T.DoubleSide }),
    [0, 0, -0.018],
    [1.017, 1.009, 1.012],
  );
  const capeBase = new Float32Array(capeGeo.attributes.position.count * 3);
  const positions = capeGeo.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    const u = positions.getX(i) + 0.5;
    const v = 0.5 - positions.getY(i);
    const spread = 0.76 + Math.sin((v * Math.PI) / 2) * 0.77;
    const x = (u * 2 - 1) * spread;
    const y = 0.25 - v * 1.98 + Math.cos(u * Math.PI * 6) * 0.15 * v * v;
    const z =
      -0.67 -
      Math.sin(v * Math.PI) * 0.38 +
      Math.cos(u * Math.PI * 6) * 0.2 * v;
    positions.setXYZ(i, x, y, z);
    capeBase.set([x, y, z], i * 3);
  }
  capeGeo.computeVertexNormals();

  const arms: {
    shoulder: T.Vector3;
    upper: T.Mesh;
    fore: T.Mesh;
    elbow: T.Mesh;
    hand: T.Group;
  }[] = [];
  [-1, 1].forEach((side) => {
    const shoulder = new T.Vector3(side * 0.99, 0.02, 0.03);
    const upper = mesh(
      body,
      new T.CapsuleGeometry(0.11, 0.32, 8, 16),
      blue,
      [0, 0, 0],
      [1, 1, 1],
      true,
    );
    const fore = mesh(
      body,
      new T.CapsuleGeometry(0.12, 0.28, 8, 16),
      blue,
      [0, 0, 0],
      [1, 1, 1],
      true,
    );
    const elbow = ball(body, blue, [0, 0, 0], [0.127, 0.127, 0.127]);
    const hand = glove(body);
    arms.push({ shoulder, upper, fore, elbow, hand });
    const clasp = mesh(
      body,
      new T.CylinderGeometry(0.15, 0.15, 0.075, 6),
      gold,
      [side * 0.96, 0.15, 0.27],
      [1, 1, 1],
      true,
    );
    clasp.rotation.x = Math.PI / 2;
    mesh(clasp, new T.CylinderGeometry(0.104, 0.104, 0.087, 6), orange);
    const leg = mesh(
      root,
      new T.CapsuleGeometry(0.135, 0.46, 8, 24),
      blue,
      [side * 0.42, 0.8, 0.03],
      [1, 1, 1],
      true,
    );
    leg.rotation.z = side * 0.13;
    const boot = new T.Group();
    boot.position.set(side * 0.49, 0.2, 0.15);
    boot.rotation.y = side * 0.16;
    root.add(boot);
    ball(boot, navy, [0, -0.055, 0.09], [0.29, 0.12, 0.42], false);
    ball(boot, blue, [0, 0.025, 0.12], [0.277, 0.17, 0.41]);
    mesh(
      boot,
      new T.CylinderGeometry(0.193, 0.19, 0.29, 24),
      blue,
      [0, 0.19, -0.02],
      [1, 1, 1],
      true,
    );
    mesh(
      boot,
      new T.CylinderGeometry(0.215, 0.215, 0.135, 24),
      blue,
      [0, 0.35, -0.02],
      [1, 1, 1],
      true,
    );
    mesh(
      boot,
      new T.BoxGeometry(0.195, 0.1, 0.045),
      gold,
      [0, 0.35, 0.193],
      [1, 1, 1],
      true,
    );
    mesh(boot, new T.BoxGeometry(0.148, 0.056, 0.051), orange, [0, 0.35, 0.21]);
  });

  const holster = new T.Group();
  holster.position.set(0.91, -0.65, 0.55);
  holster.rotation.z = -0.14;
  body.add(holster);
  const cupPoints = [
    [0, -0.23],
    [0.09, -0.22],
    [0.135, -0.17],
    [0.14, 0.19],
    [0.113, 0.21],
    [0.108, -0.13],
  ].map(([x, y]) => new T.Vector2(x, y));
  mesh(
    holster,
    new T.LatheGeometry(cupPoints, 32),
    orange,
    [0, 0, 0],
    [1, 1, 1],
    true,
  );
  mesh(
    holster,
    new T.TorusGeometry(0.133, 0.019, 8, 32),
    gold,
    [0, 0.195, 0],
  ).rotation.x = Math.PI / 2;
  mesh(
    holster,
    new T.CylinderGeometry(0.109, 0.109, 0.01, 24),
    material("#713514"),
    [0, 0.115, 0],
  );
  const mic = microphone();
  body.add(mic);
  mic.name = "single-canonical-microphone";

  function segment(
    object: T.Mesh,
    from: T.Vector3,
    to: T.Vector3,
    length: number,
  ) {
    object.position.copy(from).add(to).multiplyScalar(0.5);
    object.quaternion.setFromUnitVectors(
      new T.Vector3(0, 1, 0),
      to.clone().sub(from).normalize(),
    );
    object.scale.y = from.distanceTo(to) / length;
  }
  const holstered = new T.Vector3(0.91, -0.47, 0.55);
  let draw = 0;
  let gesture = 0;
  let attention = 0;
  let lastState: CharacterState = "ready";
  let stateTime = 0;
  return {
    root,
    update(
      time: number,
      dt: number,
      state: CharacterState,
      energy: number,
      pointer: { x: number; y: number },
      reduced: boolean,
      entrance = 1,
    ) {
      if (state !== lastState) {
        lastState = state;
        stateTime = time;
      }
      const elapsed = time - stateTime;
      const speaking = state === "listening";
      const targetDraw = speaking ? 1 : 0;
      draw = reduced ? targetDraw : T.MathUtils.damp(draw, targetDraw, 3.8, dt);
      const targetGesture =
        state === "feedback"
          ? 1
          : state === "success"
            ? 0.65
            : state === "error"
              ? 0.35
              : 0;
      gesture = reduced
        ? targetGesture
        : T.MathUtils.damp(gesture, targetGesture, 4, dt);
      attention = reduced
        ? state === "feedback"
          ? -0.16
          : 0
        : T.MathUtils.damp(
            attention,
            pointer.x * 0.08 + (state === "feedback" ? -0.16 : 0),
            3,
            dt,
          );
      body.rotation.y = attention;
      body.rotation.z = reduced
        ? 0
        : Math.sin(time * 0.85) * 0.012 + (state === "thinking" ? 0.045 : 0);
      body.position.y = 2.02 + (reduced ? 0 : Math.sin(time * 1.65) * 0.016);
      const blink = reduced
        ? 1
        : Math.pow(Math.max(0, Math.cos(time * 1.12 + 0.8)), 48);
      eyes.forEach(
        (e) => (e.scale.y = reduced ? 1 : Math.max(0.08, 1 - blink * 0.92)),
      );
      pupils.forEach((p) => {
        p.position.x = 0.022 + (reduced ? 0 : pointer.x * 0.034);
        p.position.y = -0.026 + (reduced ? 0 : pointer.y * 0.025);
      });
      mouth.scale.y =
        state === "thinking" ? 0.65 : 1 + (reduced ? 0 : energy * 0.09);

      const leftRest = new T.Vector3(1.3, -0.62, 0.3);
      const handTarget = new T.Vector3(0.88, -0.25, 1.13);
      const micTarget = new T.Vector3(0.89, -0.25, 1.12);
      // Hand reaches the holster first; a single mic then travels with the hand.
      const reach = T.MathUtils.smoothstep(draw, 0, 0.3);
      const lift = T.MathUtils.smoothstep(draw, 0.28, 1);
      const handPos = leftRest
        .clone()
        .lerp(holstered.clone().add(new T.Vector3(0, 0.04, 0.04)), reach)
        .lerp(handTarget, lift);
      const leftElbow = new T.Vector3(
        1.38,
        -0.31 + lift * 0.13,
        0.12 + lift * 0.47,
      );
      const greeting = reduced ? 0 : Math.sin(entrance * Math.PI) * 0.65;
      const rightHand = new T.Vector3(
        -1.36 - gesture * 0.38,
        -0.55 + gesture * 0.85 + greeting,
        0.32 + gesture * 0.1,
      );
      if (!reduced && state === "success")
        rightHand.y += Math.sin(Math.min(elapsed, 1) * Math.PI) * 0.36;
      const targets = [
        {
          hand: rightHand,
          elbow: new T.Vector3(-1.28, -0.32 + gesture * 0.35, 0.11),
        },
        { hand: handPos, elbow: leftElbow },
      ];
      arms.forEach((arm, i) => {
        const target = targets[i];
        segment(arm.upper, arm.shoulder, target.elbow, 0.54);
        segment(arm.fore, target.elbow, target.hand, 0.52);
        arm.elbow.position.copy(target.elbow);
        arm.hand.position.copy(target.hand);
        arm.hand.rotation.z =
          i === 0 ? -0.15 - gesture * 0.55 : 0.2 - lift * 0.3;
        arm.hand.rotation.y = i === 0 ? -0.2 : 0.3;
        const open = i === 0 ? gesture : 0;
        (arm.hand.userData.fingers as T.Mesh[]).forEach((finger, j) => {
          finger.scale.y = 0.125 + open * 0.06;
          finger.position.y = 0.16 + (j === 1 ? 0.025 : 0) + open * 0.085;
          finger.position.x = (j - 1) * (0.105 + open * 0.045);
          finger.rotation.z = -(j - 1) * open * 0.22;
        });
      });
      mic.position.copy(holstered).lerp(micTarget, lift);
      mic.rotation.z = -0.14 + lift * 0.3;
      mic.rotation.x = lift * -0.2;
      for (let i = 0; i < positions.count; i++) {
        const x = capeBase[i * 3],
          y = capeBase[i * 3 + 1],
          z = capeBase[i * 3 + 2];
        const weight = Math.max(0, (0.25 - y) / 1.98);
        positions.setZ(
          i,
          z +
            (reduced
              ? 0
              : Math.sin(time * 1.7 + x * 3 + y * 1.1) * 0.065 * weight +
                energy * 0.025 * Math.sin(x * 5 + time * 3)),
        );
      }
      positions.needsUpdate = true;
      if (!reduced) capeGeo.computeVertexNormals();
    },
  };
}
