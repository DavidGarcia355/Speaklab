# Recordings to Classes: Character-First Study

Status: storyboard and production feasibility only. The existing app implementation is frozen as a navigation prototype, not accepted character animation. No app edits, integration, dependency changes, commits, pushes or deployment belong to this stage.

## First Board: Rejected for Production

`storyboard-blocking-v1-rejected.png` was created with the built-in raster image-generation tool using the exact saved `storyboard-prompt.txt` and the two existing canonical references. One generation was used; no frame batch or outside paid API was invoked. The PNG is retained as a blocking study, not an approved asset.

The thought -> gather -> travel -> present direction is readable, and the low anticipation and landing are meaningfully different poses. It nevertheless fails the gate:

- The microphone is absent from the holster across the board. The prompt explicitly required it to remain stored throughout.
- Key 04 is already airborne. It does not supply the planted trailing toe and extending ankle that establish the push-off.
- Key 05 presents an open palm, key 06 changes that hand to a fist, and key 07 reopens it. That is not the intended continuous presenting gesture.
- Globe/boot proportions and camera-relative scale drift between keys. These drawings cannot be treated as registration-ready animation frames.

Required corrections are specific: preserve the one stored microphone in every view, draw the actual toe-driven push-off, keep the presenting hand's open-finger progression continuous through contact, and register globe/boots to a consistent model and camera. Correcting those keys would still not prove that the in-between motion is good.

**Stop at the asset gate.** No character clip or UI integration was produced from this board. The current setup has not demonstrated coherent, commercial-quality authored motion. The next dependency is a corrected, model-consistent editable pose/rig source and a convincing character-only performance from an animation-authoring pipeline. Another parameter pass on the old puppet is not a substitute.

## Shot

One two-second, fixed-camera action: **notice, gather, hop, present**. HablaMan notices Classes, shifts his weight, makes a small purposeful rightward hop and opens his palm to usher the viewer into that space. Test against an empty neutral background before involving the UI. No glasses in this shot: eye direction must lead the movement. Keep the single microphone stored in his canonical left-hip holster throughout; no handling or prop transfer is needed.

HablaMan has no separate head or torso. Eyes can lead the turn, but the globe is one body/head volume. Its shoulders, hips, face, belt and cape anchors turn coherently. Preserve the chosen PNGs as design references, not as frames or mandatory starting/ending poses. The new shot must have its own authored entry and resting pose.

## Eight Keys

| Key | Time | Character performance | Mechanical requirement |
| --- | ---: | --- | --- |
| 01 Ready | 0.00 | Balanced three-quarter stance, relaxed arms, attentive face | Both boots support the globe; clear neutral silhouette |
| 02 Notice | 0.12 | Eyes look screen-right, brow lifts, body has barely followed | Eyes initiate; no invented neck or independent head turn |
| 03 Gather | 0.30 | Globe dips, knees bend, weight collects over the trailing boot; leading elbow draws toward the body | Center of mass remains over support; wrists remain aligned with forearms |
| 04 Push | 0.50 | Trailing ankle extends from a planted toe; leading knee and shoulder begin moving right | Foot drives translation; shoulder leads elbow, not a spinning hand |
| 05 Travel | 0.80 | Short airborne arc; leading leg reaches, rear knee folds; presenting hand begins opening | Connected joints, stable globe volume; cape lags from its two clasps |
| 06 Contact | 1.12 | Leading boot contacts; knee compresses, globe follows down; gaze comes back toward viewer | Contact foot pins to the floor; no foot skating or floating landing |
| 07 Present | 1.50 | Rear boot catches up, shoulder and elbow finish an open-palm gesture toward Classes | Fingers open as a gesture; hand does not revolve about the wrist |
| 08 Settle | 2.00 | Calm inviting three-quarter pose, palm directed toward the destination; one small cape follow-through ends | Both feet grounded, no pose swap, no generic sunglasses finish |

The times are blocking landmarks, not evenly spaced animation frames. The sequence needs intermediate drawings/deformations, contact holds, easing and overlap. Eight generated pictures played in sequence would only be an animatic and would not pass the motion test.

## Production Gates

1. Storyboard: approve the action by examining silhouettes, eye direction, grounded poses and canonical equipment. Reject anatomical errors before animation work.
2. Character-only motion: a continuous two-second shot at real-time speed, also inspected slowed down and frame by frame. The same body, hands, boots, cape anchors and microphone must persist. No UI, screen wipe, cropped limb, smear or camera move may conceal a discontinuity.
3. Performance: readable weight transfer, contact and recovery; shoulder/elbow/wrist sequence; cape drag, overshoot and settle. The user should want to show this as a standalone animation demo.
4. Only after those gates: coordinate the real Recordings -> Classes interface with the character's existing motion. No rollout to other routes or states.

## Asset Pipeline Specification

Prefer a canonical multi-view deformable 2D rig with authored breakdown drawings, or a coherent full-body drawn frame sequence. A rig is not disqualified because bones rotate; isolated rigid-part rotations without volume, joint deformation and performance are disqualified. The previous eight-part puppet must not be reused as the production foundation.

Required deliverables before integration: editable source, the eight approved keys, contact and arm-breakdown poses, consistent face/hand/boot views, deforming elbow/knee shapes, attached cape with overlap, and the complete shot rendered on a neutral background. A 48-frame/24-fps or 60-frame/30-fps delivery can be sufficient if the authored movement passes; frame count alone proves nothing. Preserve alpha in a lossless source sequence when delivering to the web pipeline. Do not ask image generation to independently redraw dozens of frames and call the output temporally consistent.

## Available Capability / Stop Rule

The current tool set exposes raster image generation, not a temporally coherent character-video generator. No editable canonical animation rig was found in this repo. No animation authoring executable was found on PATH or in the inspected Program Files/local Programs directories; this is not an exhaustive disk inventory.

Create and inspect one storyboard first. Do not install tools, invoke outside paid APIs, spend TryHabla credits or restart the old procedural puppet to hide that gap. A generated storyboard is not evidence that the finished animation pipeline exists. If the keys are inconsistent or an adequate continuous shot cannot be authored, report the exact failure and stop integration. Getting coherent editable motion source is then the next production dependency.

## Prototype Freeze Record

SHA-256 hashes at the start of this study. These files are left as-is; no reset or commit is used to freeze the experiment.

| File | SHA-256 |
| --- | --- |
| app/student/StudentMotion.tsx | 09AD79B33C4AF00DBE8364FA5E47443FA33C82A28A98211624FC48FA00EB0CEA |
| app/student/motion/contracts.ts | 281004662C5FDF15667CAA86E455DD26BFD02D4CDF897DB146849972F17A16F4 |
| app/student/motion/director.ts | 05484090F1CDD5C322AA69C1F7C83643B3553067C0143BA8945D54613A171F09 |
| app/student/motion/puppet.ts | 750866B4A15D841DC8B5C8707A306A980AD5F5C8E959C4CECFEF20177EAC946E |
| app/student/motion/student-motion.css | E9EB21F6AFA768121FBEAE962B3333BEAA6B5CDBA83453E2E21657B8F3ACFE6A |
| app/student/page.tsx | 8E4006E6F904B408803835F4C276FC45E28B2BEBFD4E962D25132382CFCEFBF5 |
| app/student/dashboard/page.tsx | 80D3C2B1020E088EA783539934ECA0DEA18E16BEB708F5F2195536B9C921CAA6 |
| app/student/class/[classId]/page.tsx | DF42E20A4982E9562A29281DE910CA2348211E45A2F581A814DFC1AA12EB7281 |
| app/student/template.tsx | 90CAF0A09FF246E770C017CE74B74AF92BE25FCD3771BB811BC72E7ECF5FF207 |
| app/a/[assignmentId]/template.tsx | EF12A388D2DBDC1EBAB06A78BFE3625E96C78FB51B975A88276ED8E27D198DE8 |
| app/a/[assignmentId]/student-assignment-client.tsx | 0B46A442C1C53A5427013318732978C52671A6AC3556A47083EB38F34D4C251B |
| app/layout.tsx | 2E863E936AE361C3F662E0F03D50B37263B1705ABA843A01002B087B0A279CE2 |
