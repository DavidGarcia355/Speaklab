# Student Character Motion

Local review: `http://localhost:3000/student`.

## Scope

The real student workspace now owns a persistent 2D character director. The previous route-mounted slideshow is no longer mounted by either student template. No teacher, homepage, lab, authentication, billing, grading, AI-credit or backend behavior was changed for this implementation. Existing worktree changes remain intact. Nothing was committed, pushed or deployed.

Try My Recordings -> My Classes -> a class -> an assignment. Browser Back returns from the recording form; the existing My Classes and My Recordings links complete the return journey. No navigation buttons or information cards were added. The selected sunglasses, class-pointing and book poses remain the resting artwork. A matching existing welcome pose anchors the recording header.

## Choreography

- Anticipation begins at the existing character's actual screen bounds.
- A layered puppet lifts off, banks, tucks its legs and changes arm gestures. Its cape deforms below fixed shoulder anchors; the microphone stays with the body/holster.
- The outgoing real interface travels with the action and reveals the destination diagonally. There is no branded splash/interstitial screen.
- Arrival turns into the original destination artwork. Class and recording navigation have shorter, smaller arcs than the main flight. Submission success has a restrained entrance using the existing selected success artwork.

Fast-route authored durations:

| Destination | Duration | Emphasis |
| --- | ---: | --- |
| My Classes | 1.45 s | Full bank and expansive flight |
| My Recordings | 1.24 s | Reverse bank and return |
| Class assignments | 0.99 s | Smaller guiding sweep |
| Recording form | 0.82 s | Compact arrival |

The main transition was captured at approximately 1.1, 1.5 and 1.9 seconds, including click automation overhead. The middle version is retained: the brisk version compresses the arm/cape beats, while the longer version spends more time airborne after the destination is visible. These are local aesthetic judgments, not a user preference study.

## Ownership

- `app/student/StudentMotion.tsx`: invisible root observer, lazy activation, native link eligibility, focus and cancellation. Returns no wrapper markup.
- `app/student/motion/contracts.ts`: eligible routes, timing scores, geometry and bounded flight path.
- `app/student/motion/director.ts`: persistent canvas, inert outgoing snapshot, route readiness, reveal and cleanup.
- `app/student/motion/puppet.ts`: eight raster parts, connected two-bone arms, separate legs, cape deformation.
- `app/student/motion/student-motion.css`: student-only typography, accents, hover responses, canvas layers and reduced motion.

Native Next Link navigation starts immediately. The observer does not prevent clicks, schedule router pushes, modify history or wait before fetching. Until readiness, the character holds a moving-cape bank above the outgoing page. Failure states cancel the flight; a five-second visual ceiling clears any stuck overlay without cancelling navigation. Destination image decode is required before a landing handoff. There is no artificial loading timer.

The snapshot is a temporary inert, aria-hidden DOM clone, not a screenshot upload. Media elements and IDs are removed. It is discarded on completion, rapid navigation, resize, browser history, hidden tab, reduced-motion change or unmount. Inputs and links on the actual page are never disabled. Arrival focus only moves from the document body; it does not steal an already focused control. Offscreen source artwork skips the flight instead of scrolling the user back to the header.

Reduced motion and art-load failure use native navigation. The heavy director and raster atlas do not load on the teacher page or homepage. Canvas resolution is capped at 1.5 device pixels per CSS pixel. The eight WebP parts total 123,386 bytes (about 121 KiB); no animation dependency was added.

## Art Pipeline

The built-in image-generation tool produced `docs/design-reference/art/hablaman-puppet-source.png` using the selected sunglasses PNG as an identity reference. No external paid animation API, TryHabla AI endpoint or application credit was used.

Art brief: create a clean, evenly spaced 3-by-3 cel-animation puppet atlas of canonical sunglasses HablaMan. One globe body/head with recognizable continents, black sunglasses, orange/gold H belt buckle and one viewer-right microphone holster; separate orange cape; blue left/right upper arms; matching gloved fist and pointing forearms; separate blue legs/boots; final cell blank. Preserve four-digit gloves, costume colors and the original illustrated finish. No new mascot design, captions or scene background.

The generated background was a baked checkerboard rather than true alpha. `node scripts/prepare-student-motion-art.mjs` extracts the documented rectangles, removes the border-connected light matte without removing enclosed glove whites/highlights, trims and encodes the eight transparent WebP pieces. The source atlas is retained so the export is reproducible without another generation request. This script uses the existing Sharp installation and makes no network calls.

## Verification

- Release worktree check: lint, all tests, TypeScript, production build.
- Browser journeys at 360, 390, 768, 1440 and 1920 pixels, plus mobile dark mode.
- Canvas pixel sampling: nonblank and changing across the main flight; final artwork visible and transient DOM cleared.
- Keyboard Enter, focus after reduced-motion navigation, browser Back/Forward, rapid route changes, resize, live reduced-motion preference changes.
- A 2.6-second delayed destination, rejected assignment load, blocked puppet art, blocked destination art, short landscape viewport and long assignment title.
- Recording/submission success at desktop/mobile with a synthetic microphone and intercepted POST response. No submission reached the backend; no grading/transcription was invoked.
- Teacher/homepage confirmed to request no puppet assets and mount no flight canvas.

Captures, browser scripts and JSON reports are in the sibling `../student-motion-captures` directory, including `review.html`, `verification.json`, `states.json` and `after-student-journey-desktop.webm`.

## Remaining Compromises

This is an articulated 2D puppet, not frame-by-frame character animation. The original PNG-to-puppet launch and narrow turnaround into the original destination artwork use fast view changes; the destination turn is the least naturalistic part and remains visible when stepping through individual frames. The rig currently has one sunglasses body, so the shorter class/assignment variants share that airborne costume. More authored turn views and a non-sunglasses rig would improve this without replacing the chosen resting illustrations.

The work is ready for local review, not a claim of Persona's production animation fidelity. Browser verification used Chromium; physical iOS/Safari and assistive-technology review remain untested. Existing layout and workflow conventions were preserved, including recording-form navigation and nested recording panels. No production deployment was attempted.
