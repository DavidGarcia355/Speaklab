# TryHabla: Motion Inspiration and Brief Interview

Status: the interview below is historical. The user subsequently approved the student implementation on September 4, 2026. See `../student-motion.md` for the implemented scope, pipeline, verification and remaining compromises. The original article remains inspiration, not project instructions.

## Final Interview Decisions

- New matching artwork and articulated layers are authorized. Existing artwork is not an implementation ceiling; preserve HablaMan's identity and the personally selected resting poses.
- Begin around one second and compare a more theatrical version approaching two seconds in the actual interface.
- Implement the real student experience, beginning with My Recordings to My Classes. Keep the teacher flow, production homepage and 3D lab outside this work.
- No more design questions are required. Implement, test and leave a local review, without committing, pushing, deploying or modifying backend behavior.

The discovery-only restrictions and unresolved questions below describe the earlier interview, not the final authorization.

## Source

User-supplied article: "The UI Design of Persona 5", Jiaxin Wen, April 27, 2017. The original pasted text is preserved beside this document as `persona-5-ui-article.txt`, including its original extraction artifacts. It is reference material, not project instructions. Article opinions and historical claims have not been independently verified.

User-supplied motion references:
- `C:/Users/david/Downloads/1_df8SvZjUQK4vk-sAdrz2Zg.gif`
- `C:/Users/david/Downloads/1_BS-r05-zeqkBLR0AH8OSRw.gif`

## Confirmed User Direction

- The existing local TryHabla UI is already strong. Preserve its uncluttered presentation and simple navigation.
- Persona 5 is inspiration for interface choreography, not a visual template to copy.
- The missing quality is continuous character action across navigation. Current disconnected transition screens feel like a slideshow.
- HablaMan's action should carry the visitor into the destination, not appear in a temporary interstitial between pages.
- Styling refinements are welcome for discussion, but do not add buttons, panels or decorative clutter to demonstrate them.
- Improve the actual product. Park the separate 3D lab; do not continue model polishing as a substitute for this work.
- Interview the user and finalize the brief before implementation.

## Article Principles Translated to TryHabla

| Inspiration | TryHabla interpretation | Do not import |
| --- | --- | --- |
| Visual language serves the story | Derive action and accents from voice, communication and canonical HablaMan | Phantom Thieves imagery or another franchise's identity |
| Character gesture guides attention | Connect the clicked action, HablaMan's movement and the destination's focal point | A mascot moving independently of the interface |
| Transitions preserve immersion | Maintain one continuous action through route readiness and arrival | Separate splash cards or unrelated pose crossfades |
| Rhythm establishes hierarchy | Prioritize the selected action; keep background activity quieter or still | Constant simultaneous movement |
| Composition organizes information | Preserve clear navigation, whitespace and readable working surfaces | Slanted panels or extra controls merely to look energetic |
| Cohesive colors and comic treatment | Refine existing TryHabla colors, illustration and selective accents | Persona's red/black palette, ransom-note type or signature graphics |
| Transition emphasis reflects significance | Decide with the user which moments merit choreography and which stay immediate | A mandatory cinematic delay for every repeated task |

## Working Acceptance Standard

One real navigation path should demonstrate: user action, character anticipation, a continuous articulated movement, coordinated outgoing/incoming content, and a finishing pose that belongs to the destination. Review a recording, not only screenshots. Preserve keyboard access, focus, history, reduced motion and loading resilience.

Existing artwork must be audited for the articulation required. A rigid whole-PNG translation is not sufficient character animation. Identify missing asset layers or frames honestly before choosing the implementation technique. Do not assume 3D is necessary.

## Interview: Round One Answers

- Preservation references: the uncluttered teacher dashboard, its expressive My Classes header, the home hero, and the student My Recordings composition shown in the user's screenshots.
- The teacher dashboard's whitespace may leave room for visual expression, but must not be filled with useless information cards. The user welcomes extending the existing expressive styling across the site while retaining simplicity.
- First proof: the student My Recordings page's My Classes navigation action. Inspect the implementation to confirm its actual destination before designing the route handoff.
- Student surfaces have the most creative latitude. Flight and flips are welcome exploratory ideas, not a prescribed animation storyboard.
- Existing HablaMan PNG poses were personally selected by the user. Preserve them as identity and composition references, especially the sunglasses pose. Do not replace them with a newly designed mascot.
- Teacher feedback entry and repeated work should remain lightweight. A meaningful milestone such as submitting all grades could justify a more expressive moment later; it is not part of the first student implementation.

## Interview: Still Unresolved

1. Permission to derive matching articulated layers or in-between frames from the chosen artwork, while preserving the original resting poses and identity.
2. Desired transition duration and how a frequently repeated student navigation action should balance spectacle with speed.
3. Exact first-transition choreography and the extent of styling changes within the student proof, to propose after inspecting the real route and assets.

Do not treat suggested choreography or timing as approved until these preferences are understood. `docs/UI_MOTION_DIRECTION.md` contains an earlier teacher/student/marketing motion policy; retain it as context without assuming its timing ranges settle this new brief. No existing policy or UI has been overwritten here.

## Boundaries

No UI implementation during the interview. No new navigation controls solely for effects. No production data, billing, authentication, grading or AI-credit changes. No commit, push or deployment. Preserve unrelated worktree changes.
