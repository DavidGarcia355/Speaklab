# HablaMan Speaking Studio

An isolated, uncommitted character experiment at `/labs/hablaman`. Run `npm run dev`, then open http://localhost:3000/labs/hablaman.

## Boundary

No homepage replacement, production persona changes, backend routes, database changes, AI calls, billing changes, or production configuration changes. No paid generation services were used. This route is marked noindex and is not linked from the production navigation. It is not access-controlled; noindex is not authorization.

The earlier UI audit's existing changes to `app/globals.css`, `app/student/page.tsx`, and `app/student/student-hubs.module.css` are separate and preserved. This experiment does not alter those files. Baseline: `876add24acf64f1a5f9628be4aee06e2e6aac859`, tag `pre-astra-ui-2026-09-04`. No commit, push, merge, or deploy was performed for the experiment.

## Canon and Asset Pipeline

Reviewed `HablaMan.md`, `docs/UI_MOTION_DIRECTION.md`, the production mascot PNGs (home, teacher, student, transition and classroom poses), the canonical belt PNG, and its extraction script. No reusable GLB, GLTF, Blender model, or original model sheet was found. The older human-shaped mascot and older globe artwork missing the current equipment were not used as authorities.

The current teacher guide and home hero are the strongest available identity references. The written no-3D production rule is not being changed; this explicit experimental 3D brief supersedes it only inside the lab.

The character is modeled in TypeScript: globe body, globe-projected mouth patches, layered oval eyes, articulated capsule limbs, four-digit gloves, rounded blue boots, orange cape and belt, polygon shoulder clasps, an extruded buckle with the original canonical PNG face, and one gridded microphone. There is no human torso underneath the globe. The single microphone travels between the hand and the fixed character-left holster, which remains on viewer right. The hand reaches first, then the microphone lifts; the return reverses that path.

Local public-domain Natural Earth land polygons are rasterized into a 2048x1024 globe texture using the mascot palette. Source and license: `public/labs/hablaman/ASSETS.md`. All assets are same-origin at runtime. The canonical image is also the WebGL fallback, not the primary character.

## Architecture

| File | Responsibility |
| --- | --- |
| `app/labs/hablaman/page.tsx` | Route metadata and server entry |
| `HablaManLab.tsx` | Accessible HTML, six states, conversation timers, pointer input and microphone ownership |
| `state.ts` | Typed state contract, copy, mock transcript and simulated amplitude |
| `audio.ts` | Opt-in local Web Audio analyser, cancellation and resource cleanup |
| `scene.ts` | Lazy-loaded renderer, camera direction, lighting, quality, visibility and disposal |
| `character.ts` | Procedural model, facial attention, blinking, cape, mic draw and presenting gestures |
| `studio.ts` | Architectural arcs, acoustic elements, voice ribbon and restrained success particles |
| `textures.ts` | Geographic rasterization |
| `lab.module.css` | Route-scoped responsive overlay and reduced-motion styling |

Added `three` for actual geometry, lighting, rendering and animation; `@types/three` supplies development-only types. No additional React renderer or animation framework was needed. React owns meaningful state changes; frame updates use mutable inputs without rerendering React every frame.

## Interaction

- Opening: a short camera/character arrival, welcoming hand movement, light settling and cape motion.
- Speak: simulated voice by default. Finish transitions through Thinking, Success, then the sample Spanish transcript and feedback.
- Use my microphone: optional RMS amplitude input, not transcription. Permission denial or missing audio support leaves the simulated voice available.
- State dock: Ready, Listening, Thinking, Success, Feedback and friendly Error (labeled Try again). Thinking and Success advance automatically.
- Pointer: restrained eye/body attention. Replay restarts the arrival. Pause holds a static composition while state controls remain usable.
- Mobile feedback: the camera pulls back and reframes above the transcript instead of leaving the character behind it.

## Privacy and Performance

No MediaRecorder, audio playback connection, retention, upload, transcription, grading or AI credits. Only an analyser receives the input stream. Tracks are stopped on finish, state change, cancellation, opt-out, navigation/unmount, tab hiding, initialization failure and a 45-second listening limit. An AbortSignal also releases streams returned after permission is canceled. Audio permission can only be requested by an explicit interaction with the opt-in selected.

The Three.js dependency is dynamically imported only from this route. The land asset is approximately 135 KB; the globe canvas texture has a fixed resolution. Desktop DPR is capped at 1.75, mobile at 1.5. Sustained slow frames drop to DPR 1 without shadows. Shadows use a 1024px map; no bloom, post-processing, remote models or decoder downloads. Hidden documents skip rendering. Paused/reduced-motion scenes render only when state or dimensions change. Unmount disposes geometry, materials, textures, shadow resources, observers and the renderer. Context loss or missing assets switch to the illustrated fallback.

## Verification and Visual Iteration

Captures and repeatable Playwright scripts are in the sibling `../hablaman-captures/` directory, outside the production bundle.

1. First pass: corrected face geometry clipping through the globe, washed-out colors and mobile character cropping.
2. Second pass: replaced rough continent polygons with geographic outlines, improved mouth projection and material separation.
3. Third pass: cleared the microphone from the eye, opened the presenting glove, added speech-to-transcript ribbon movement, and reframed mobile feedback.
4. Final passes: corrected feedback fog, stage/control interference, 1024px transcript overlap, small-phone spacing, cancellation and fallback cleanup.

`verify.cjs` checks all six states at 1440x900, 1280x800, 1024x768, 390x844 and 360x800; pixel counts for blue/green/orange character surfaces; changing canvas captures; no horizontal overflow or transcript/CTA overlap; complete sample-conversation progression; static pause/reduced-motion captures; keyboard focus; and absence of page errors or non-GET lab requests. See `verification.json` and `final-*.png`.

`safety.cjs` checks explicit microphone opt-in, actual Web Audio processing with a synthetic MediaStream, track release, late permission cancellation, the hidden-document handler, denied permission, keyboard state selection, WebGL context loss, unavailable WebGL and failed asset fetch cleanup. See `safety.json`. This headless Chromium reports native microphone capture as unsupported, so physical microphone hardware is not claimed as tested. The hidden-tab check dispatches the visibility event with a controlled document state.

`__tests__/hablaman-lab-audio.test.ts` adds seven focused tests for analyser-only routing, bounded amplitude, idempotent cleanup, initialization failure, permission denial, unavailable APIs and cancellation. The repository release gate is `npm run release:check:worktree`; it validates without deploying.

Final result on 2026-09-04: release gate passed, including lint, 918 tests in 116 files, typecheck and production build. The final ribbon refinement was followed by another successful production build, focused lint, safety checks and visual captures. All five required viewport checks passed; no page errors, horizontal overflow or non-GET lab requests were observed.

Strongest captures in `../hablaman-captures/`: `showcase-ready-1440.png`, `showcase-listening-1440.png`, `showcase-ready-390.png`, `showcase-feedback-390.png` and `showcase-feedback-360.png`. `hablaman-desktop.webm` records the reveal and full conversation. The showcase script hides only the Next development toolbar in its browser captures; production configuration is unchanged.

## Integration Recommendations

1. Near-term candidate: the small accessible state vocabulary, friendly recovery copy, and restrained feedback presentation, after product/design approval.
2. Refine before production: hand anatomy, elbow deformation, facial expressions and cape behavior with a professionally authored canonical rig; benchmark physical mobile GPUs and Safari microphone behavior.
3. Keep experimental: the full-screen cinematic scene and microphone choreography. Do not add its graphics payload to everyday teacher/student workflows without evidence that it helps them.

## Compromises

This is a custom procedural interpretation, not an approved studio-authored 3D asset. The globe silhouette and equipment are preserved, but glove articulation, cape physics and facial deformation are approximations; the cape is procedural, not simulated cloth. Every transcript and feedback sentence is mocked, even when real amplitude is enabled. There is no audible voice or true speech recognition. Reduced-motion and fallback views intentionally simplify the choreography. Chromium software-rendered desktop/mobile viewport checks are not a substitute for real iOS/Android GPU and microphone testing. The lab remains a review candidate, not a claim of production readiness.
