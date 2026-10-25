# Blink2Talk stage log

Figma "Idea to Demo" track, Cal Hacks 13.0. Built from the team's commit history (68 commits by 4 people, 1:22 PM to 10:54 PM on Oct 24) and `docs/worklog.md`, which logged the Figma sessions as they happened. Each stage entry stays under 200 words. The ratings are Noel's to confirm.

Figma Slides deck: https://www.figma.com/slides/8U3Y4Bz4e7EzP9Eq3Ag5sd

## Our actual path

Brief (text) → FigJam, through the Figma MCP server → Figma Design, through the MCP server, with a parallel Claude Design project → Handoff (`get_design_context` and `tokens.css`) → Code, with Claude Code and by hand. Then eye-tracker testing changed the layout three times in code: a 2×2 grid in the screen's corners (3:00 PM), a Kahoot-style 2×2 (9:45 PM), and a row of four boxes picked by looking left or right only (10:22 PM). The row was close to the FigJam keep list's "one row of replies, moved by looking left or right," but it tested worse, so at 12:58 AM on Oct 25 the app went back to the Kahoot 2×2. The Figma file was never updated.

## Running time log

Times are PDT, Oct 24, 2026.

| Date and time | Stage | Who | Figma tool | Minutes | What happened (include dead ends) |
|---|---|---|---|---|---|
| Oct 24, 00:49 | Ideation | Noel + Claude Code | None (text) | ~11 | Wrote the product brief (`design/claude-design-prompt.md`). |
| Oct 24, 01:28 | Ideation | Noel + Claude Code | FigJam via Figma MCP | ~4 | Generated the core-loop diagram from Mermaid, then built the board around it. |
| Oct 24, 01:40 | Ideation | Noel + Claude Code | FigJam via Figma MCP | ~2 | Remade the board in the Education team. The first copy landed in a personal Starter team. |
| Oct 24, 11:41 | Prototyping | Noel + Claude Code | Figma Design via Figma MCP | ~18 | Variables, 15 icon components, 7 components, 26 frames for patient screens 1–7, a clickable main loop. Two calls went to rework. |
| Oct 24, 12:40 | Handoff | Noel + Claude Code | Figma MCP (`get_design_context`) | ~17 | Pulled Listening and Speaking from Figma into the Electron app; reply cards and `tokens.css` came from the Claude Design project. Found token mismatches. |
| Oct 24, 13:05–22:54 | Code generation | Whole team + Claude Code | None after handoff | ~600 | 68 commits. |
| Oct 24, 15:00 | Code generation | Noel + Claude Code | None | ~25 | Figma's single row became a 2×2 grid in the screen's corners, so the patient looks straight at a box. Figma not updated. |
| Oct 24, 21:45 | Code generation | Marco + Claude Code | None | — | Kahoot-style 2×2: boxes together, one color each. Figma not updated. |
| Oct 24, 22:22 | Code generation | Marco + Claude Code | None | — | A row of four tall boxes, picked by left-right eye position only, because up/down gaze never got reliable. Figma not updated. |
| Oct 25, 00:58 | Code generation | Marco + Claude Code | None | — | Back to the Kahoot-style 2×2: the row of four tested worse. The row stays a dev-mode switch. Figma not updated. |

---

## Stage 1: Ideation

- **Figma tool:** FigJam, via the Figma MCP server (`generate_diagram`, `use_figma`) in Claude Code
- **Time:** about 6 minutes in FigJam, after 11 minutes writing the brief as text
- **Rating:** 4/5
- **File:** https://www.figma.com/board/UUvIgVgt97D63Xljrq3L0b

**Why:** The reply loop branches a lot. The patient looks to highlight, closes their eyes to pick, and undoes with a double blink. Picking "None of these" twice opens the keyboard. Tired mode cuts the choices. We wanted every path visible before drawing screens, so we wrote the loop as Mermaid, and `generate_diagram` made it an editable FigJam diagram. Around it we added the problem, users, constraints, risks, and a keep/cut list.

**Friction:** The loop-back arrows made the auto layout sprawl. We kept it instead of hand-placing 19 shapes. The first board landed in a personal Starter team, so we regenerated it in our Education team from the same source.

**What carried forward:** The bedside constraints became the rules for every screen: text at least 28 px, no brightness changes, and no vitals on the patient view. We tried the keep list's "one row of replies, moved by looking left or right" late in testing; it worked worse than the 2×2.

---

## Stage 2: Prototyping

- **Figma tool:** Figma Design, built through the Figma MCP server (`use_figma`) from Claude Code. Figma Make not used.
- **Time:** about 18 minutes (11:41 to 11:59)
- **Rating:** 3/5
- **File:** https://www.figma.com/design/qhB3qvr3odYDYNlIcyNwy3 (prototype flow "Main loop" starts at frame 2:48)

**Why:** The screens had to stay readable from a hospital bed on any laptop, in a dark room or a bright one. The patient's eyes are closed while they choose, so every reply needed clear states. We built the rules first: color variables with Dark and Light modes, and size variables with a mode per screen width (1280, 1440, 1920) standing in for CSS `clamp()`.

**What we built:** 15 Lucide icon components; ReplyCard (7 states), EndOption, CaptionBar, EyeStatusIndicator, LookCue, KeyboardKey, and CareButton; 26 frames for patient screens 1–7; a light-theme check; and a clickable main loop (Space = long blink, arrows = look).

**Friction:** Two of four calls were rework. The reply row clipped the 6 px outside outline, and variable-sized icons resized their frame but not the drawing. Light `--selected` changed to #5CCDB3 to keep 7:1 contrast.

**What carried forward:** Component names, states, and the clickable loop as the behavior spec.

---

## Stage 3: Handoff

- **Figma tool:** Figma MCP server (`get_design_context`, 2 calls) into Claude Code
- **Time:** about 17 minutes (12:40 to 12:57)
- **Rating:** 3/5

**Why:** The coding agent read layout, values, and icons straight from the file, so nobody copied numbers by hand.

**What we passed:** Listening and Speaking came from Figma with their icons. RepliesScreen, ReplyCard, EndOption, and `tokens.css` came from a parallel Claude Design project, with `tokens.css` copied unchanged.

**Friction:** Two design sources meant two sets of tokens. Figma's variables and `tokens.css` disagree on `--border`, `--text-muted`, light `--selected`, and some type sizes; the code follows `tokens.css`.

**Traceability:** ReplyCard's Figma variants became `data-state` values on `.reply-card` in `app/renderer/app.css`, set by `view.js`: Default → default, Highlighted → highlighted, Highlighted + progress and Eyes closed → hold, Selected → selected, Dimmed → dimmed, Loading → loading. The selected color shows the token drift: Figma's light `--selected` is #5CCDB3; `tokens.css` uses #0A5F4F.

---

## Stage 4: Code generation

- **Figma tool:** none after handoff. Claude Code (Opus 5.5) and by hand.
- **Time:** about 10 hours (13:05 to 22:54), 68 commits by 4 people
- **Rating:** not used
- **Repo:** https://github.com/NoelSason/blink2talk

**Why:** The hard parts have no Figma equivalent: webcam eye tracking (MediaPipe face landmarks, calibration, squint detection), live speech-to-text, Claude replies, and a cloned voice.

**What came from Figma:** The Listening, Speaking, tired-mode, and Can't-see-you screens, the component names and states, and the main-loop behavior. Designed in code instead: the calibration dots, the consent confirm, Spell it, the care panel, and every layout after 3:00 PM.

**Friction:** Testing moved the layout four times. Patients target a box best by looking straight at it, so Figma's stepped row became a 2×2 grid in the corners. A Kahoot-style 2×2 followed. Then a recorded session showed left/right gaze separating by 17 to 23 times the noise and up/down by under 2, so we tried a row of four boxes picked left-right only. It tested worse, and the Kahoot 2×2 came back. We never looped back to update Figma, so the code is the source of truth for layout.

---

## Reuse notes

1. Write the loop as Mermaid, generate the FigJam diagram, and put the constraints on the same board.
2. Turn the constraints into variables (color modes, a size mode per screen width) before drawing any screen.
3. Name components the same in Figma and code, and pull them with the MCP server instead of copying values.
4. Pick one token source on day one. We had two, Figma and Claude Design, and they drifted.
5. When testing changes the layout, update the Figma file the same hour. We didn't, and the design stopped matching the app.
