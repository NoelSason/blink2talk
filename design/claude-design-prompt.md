# Task for the browser agent

You'll use Claude Design to create the interface for Blink2Talk, a laptop app for hospital patients who are awake but can't speak or use their hands. You operate Claude Design. The design brief below is what you give it.

Steps:

1. Open Claude Design on claude.ai and start a new design project named "Blink2Talk". If it offers a design system, choose none. The brief defines one.
2. Paste everything between `BRIEF START` and `BRIEF END` as the first message. The brief ends by asking for phase 1 only.
3. When phase 1 is done, check it against the QA checklist at the bottom of this file. For each failure, send one specific fix request that names the screen, the frame, and the problem. Stop after three rounds on the same issue and note it as unresolved.
4. Send the phase 2 message, run the checklist again, then do the same for phase 3.
5. Keep the project private. Don't publish it, share it publicly, or connect other accounts.
6. Don't add screens or features beyond the brief. If Claude Design proposes extras, decline them.
7. When you finish, report three things: the project link, which checklist items still fail, and any choices Claude Design made that the team should confirm.

---

BRIEF START

## What you're designing

Blink2Talk gives a voice to hospital patients who are awake but can't speak or use their hands. Examples are ICU patients on a ventilator, people after a stroke, and people with ALS.

A laptop sits on the overbed table, facing the patient. Its webcam, centered above the screen, watches the patient's eyes. When a nurse or family member asks a question, the screen shows 3 or 4 likely replies. A highlight moves through them. The patient moves it by looking left or right, or the highlight steps through on its own. The patient picks the highlighted reply by closing their eyes for about a second (a "long blink"). The app then speaks the reply out loud in the patient's own voice.

A second audience is the nurse or family member. They use a care panel to see estimates of the patient's heart rate and breathing, read the conversation history, and get alerts when the patient seems distressed or tired. The care panel opens on their phone, or as a drawer on the same laptop when only one device is available.

The app runs full screen in a desktop window with no browser chrome, and the care panel runs in a browser. Build everything as HTML and CSS that we can reuse directly in the app.

## Who the patient is, and what that means for the design

- They view the screen from 60 to 90 cm away, usually lying down, often without glasses, sometimes sedated or exhausted.
- They can't touch the screen or use a keyboard. Every patient-facing control is chosen with their eyes, so every extra item on screen costs the patient time and energy.
- Their eyes are closed while they select. Any visual feedback during the long blink is invisible to them. Confirm each selection with a sound and with a clear "Selected" state that is still on screen when they open their eyes (about 1.5 seconds).
- They may be frightened and frustrated. The screen should feel calm, steady, and on their side. Never cute, never alarming.

## Design principles, in priority order

1. **Legible from a hospital bed.** On the 1440×900 frame, patient-facing text is at least 28 px and reply text is about 52 px. Scale fluidly with `clamp()` so the 1280×800 and 1920×1080 frames stay proportional. Contrast is at least 7:1.
2. **Few, large targets in one line.** Replies sit in a single horizontal row, because the patient moves the highlight by looking left or right. Show at most 4 replies. "None of these" sits at the left end of the row and "Spell it" at the right end, both visibly smaller than the replies. The highlight starts on the first reply. In tired mode, show 2 replies plus "None of these".
3. **The highlight is unmistakable without color.** Use a thick outline (4 px or more), a filled background change, and a slight scale-up. When the highlight steps through on its own, a thin progress bar inside the highlighted item shows the time left before it moves on.
4. **Steady brightness.** The webcam reads subtle color changes in the patient's face, and the screen is often the main light on that face. So the screen must not flash or change its overall brightness between states. Highlight changes affect only the highlighted element. No full-screen color washes, no strobing, no shimmer loading effects, and no animated gradients. This also protects photosensitive patients.
5. **The patient's screen belongs to the patient.** The care panel never appears on the patient view unless someone opens the drawer, using one small, low-contrast button in a corner. Vitals are never shown to the patient.
6. **Honest about failure.** "None of these" and "Spell it" appear on every reply screen. When the app can't see the patient's face, it pauses calmly and says so.

## Visual direction

- **Mood:** calm, warm, confident. References: Apple Assistive Access (big, simple tiles), Apple Health (vitals tiles), and live captions on a TV broadcast (readable live text).
- **Avoid:** neon-on-black hospital monitors, purple AI gradients, glassmorphism, emoji, decorative illustration, tiny labels, and dense dashboards.
- **Surfaces:** the patient screen is opaque and solid. No blur or translucency.
- **Themes:** dark is the default because hospital rooms are dim at night. Provide a light theme too. Define every color as a CSS custom property on `:root`, with the light theme under `[data-theme="light"]`. Suggested starting values; refine them, but keep the contrast:

  | Token | Dark | Light |
  |---|---|---|
  | `--bg` | #0F1521 | #F6F3EE |
  | `--surface` (reply card) | #1B2333 | #FFFFFF |
  | `--text` | #F4F1EA | #151A24 |
  | `--highlight` (text #151A24 on top) | #FFC857 | #FFC857 |
  | `--selected` | #3FC1A5 | #1E9C83 |
  | `--alert` (care panel only) | #E5484D | #D93036 |

- **Type:** Atkinson Hyperlegible Next for all patient-facing text. It was designed for low-vision readers. Use Inter or `system-ui` for the care panel. Replies use semibold. Load fonts from Google Fonts for now; we'll bundle them in the app later.
- **Icons:** Lucide, stroke width 2, never smaller than 24 px on the patient screen.
- **Corners:** about 28 px on reply cards and 16 px on care panel tiles.
- **Motion:** the highlight jumps from item to item instead of sliding. Keep transitions short and gentle (200 ms or less). Respect `prefers-reduced-motion`.

## Frames

| Frame | Size (px) | Notes |
|---|---|---|
| Patient screen, laptop | 1440×900 | **Primary.** A 13-inch MacBook Air at default scaling. |
| Patient screen, external monitor or projector | 1920×1080 | We mirror the patient screen here so judges can see the demo. |
| Patient screen, small window | 1280×800 | Smallest supported. Text wraps to at most 2 lines and never truncates. |
| Care panel, phone | 390×844 | The nurse's or family member's phone, in a mobile browser. Respect the top and bottom safe areas. |
| Care panel, drawer | 440 wide, over the 1440×900 patient screen | Used when everything runs on one laptop. Slides in from the right edge. |

## Patient screens

1. **Listening.** The app waits for someone to speak. It shows the patient's name in a light weight, a small "I can see you" eye indicator, and a gentle listening state. When someone speaks, their words appear as a large live caption across the top. One item is always available here: "I want to say something". Because it is the only item, a long blink selects it at any time. It opens screen 7.
2. **Suggested replies.** The question stays as a caption on top, and the reply row sits below it. Show five moments:
   - a. Loading: the person has stopped talking and replies are on their way (up to 2 seconds). Show steady, empty card outlines with no shimmer.
   - b. The highlight is on reply 2 after the patient looked right. A small, quiet arrow cue shows which way the look registered, for the people in the room.
   - c. The highlight is stepping through on its own, with its progress bar half full.
   - d. The patient's eyes are closed mid-selection. The highlight holds still and a ring fills on the highlighted card. The ring is for the people in the room; the patient can't see it.
   - e. The "Selected" state, with a check mark.
3. **Speaking.** The chosen reply appears very large, with a subtle speaking indicator and the hint "Blink twice to undo".
4. **Spell it.** A keyboard the patient uses with their eyes. The top shows the message being built. Below it is a row of predicted words. Below that, letters sit in rows ordered by how often each letter is used, not in QWERTY order, plus Space, Delete, and Speak. Show a row highlighted, then a single letter highlighted inside that row.
5. **Tired mode.** The same as screen 2, but with 2 replies, larger text, and a slower step. Place it next to the normal version so the difference is obvious.
6. **Can't see you.** The app can't find the patient's face. Replies dim and the highlight pauses. A calm message speaks to the room: "I can't see their face. Move the laptop so their eyes are visible." No alarm styling.
7. **Start a conversation.** Opened from "I want to say something". Offers "I need help", "I'm in pain", "I'm thirsty", and "Spell it".

"None of these" shows a fresh set of replies. After a second "None of these", the app opens Spell it.

## Setup screens

The nurse or family member uses these on the laptop before handing it over. They use a mouse or trackpad, so normal-size controls are fine.

1. **Frame the face.** A live webcam preview with a face outline and three checks: "Face in view", "Steady light", and "Close enough". One Continue button.
2. **Learn their blinks.** The patient looks at the screen and blinks normally for 20 seconds. Show a calm countdown ring and the line "Getting to know how Rosa blinks."
3. **Practice.** The patient practices one long blink on a Yes and No pair, and one look left and one look right. Show the success state.
4. **Their voice.** Choose "Their own voice" (made from a short recording) or a standard voice, and play a sample.

## Care panel

Design it for the phone frame and the drawer frame.

1. **Overview.** Heart rate and breathing appear as large tiles, each with a short trend line and an "Estimated" label. A third, smaller tile shows comfort: "Seems comfortable" or "Signs of discomfort". When a reading isn't reliable, the tile shows "—" and "Hold still to measure" instead of a number. Below the tiles is the recent conversation: what was asked, what the patient answered, and when.
2. **Alerts.** Show two banners. A strong one: "Signs of distress: heart rate and breathing up for 2 minutes. Check on Rosa." A soft one: "Rosa seems tired. Replies simplified."
3. **Settings.** Step speed, number of replies (2, 3, or 4), text size, theme, voice and volume, sounds, and how the highlight moves (by looking, stepping on its own, or both).

## Demo controls

A plain operator panel for the team, hidden behind a keyboard shortcut and not seen by patients. It has toggles to replace each live input with sample data (eyes, conversation, vitals), plus buttons for "Play sample question", "Trigger distress", and "Trigger tired mode". Keep it compact and utilitarian. The copy rules below don't apply to it.

## Sample content

- Patient: Rosa.
- Nurse: "Are you in any pain right now?" Replies: "Yes, a lot" · "A little" · "No" · "It's my back".
- Second example: "Do you want me to call your daughter?" Replies: "Yes, please" · "Not now" · "Is she okay?" · "Tell her I love her".

## Copy rules

- Write for the person reading it. Never show technical terms: no "AI", "model", "prediction", "algorithm", "camera signal", "confidence", and no brand or SDK names.
- Vitals are estimates, not diagnoses. Say "Heart rate (estimated)" and "Breathing up". Never say "tachycardia", "arrhythmia", or "medical alert".
- Keep copy short, plain, and kind. Use sentence case. No exclamation marks.

## What to deliver

1. **A design-system page.** Color tokens for dark and light as CSS custom properties. A fluid type scale using `clamp()`, an 8-px spacing scale, and corner radii. Components with all their states:
   - ReplyCard: default, highlighted, highlighted with progress, eyes-closed hold, selected, dimmed, loading outline
   - EndOption ("None of these", "Spell it")
   - CaptionBar
   - EyeStatusIndicator
   - LookCue (left and right)
   - KeyboardKey and KeyboardRow: default, row highlighted, key highlighted
   - VitalTile: live, unreliable
   - AlertBanner: strong, soft
   - SetupCheckRow
2. **Screens in a matrix.** One row per screen, one column per frame. Patient screens 1 to 3 get all three patient frames. Other patient and setup screens get the 1440×900 frame. Care panel screens get the phone and drawer frames.
3. **Short annotations** on each layout: what changes between frame sizes, what stays fixed, and which Lucide icons are used.
4. **Clean, reusable code.** Semantic HTML and plain CSS with the custom properties above. No CSS framework, and no layout that depends on fixed pixel positions.
5. **A clickable prototype** of the main loop, if supported: Listening → Suggested replies → Selected → Speaking → Listening. Arrow keys stand in for looking left and right, and the space bar stands in for a long blink.

## Work in phases

Start with phase 1 only: the design-system page and patient screen 2 (all five moments) in all three patient frames. Stop there so we can review before you continue.

BRIEF END

---

## Follow-up messages

**Phase 2:**

> Now design patient screens 1, 3, 4, 5, 6, and 7, plus the four setup screens, following the frame rules in the brief. Reuse the components from the design-system page. Stop when they're done so we can review.

**Phase 3:**

> Now design the care panel screens in the phone and drawer frames, then the demo controls, then the clickable prototype of the main loop.

## QA checklist

Run this after every phase.

- [ ] On the 1440×900 frame, patient text is at least 28 px and reply text is noticeably larger. The other two frames scale proportionally.
- [ ] Replies sit in one horizontal row, with "None of these" at the left end and "Spell it" at the right end.
- [ ] No reply screen shows more than 4 replies plus the two end options. Tired mode shows 2 replies plus "None of these".
- [ ] The highlight is obvious in grayscale: outline, fill, and scale, not color alone.
- [ ] No text is truncated or ellipsized, especially at 1280×800 and in the 390-wide phone frame.
- [ ] The patient screen has no translucency, gradients, or shimmer, and no full-screen color change between states.
- [ ] No vitals appear on the patient view. The care drawer opens only from one small corner button.
- [ ] No technical words or brand names appear in patient, setup, or care panel copy, and vitals are labeled as estimates.
- [ ] Dark and light themes both exist, and both meet the contrast targets.
- [ ] Colors and type sizes come from the CSS custom properties, not hard-coded values.
- [ ] Tokens and components are named consistently and reused across screens.
