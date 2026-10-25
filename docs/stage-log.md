# Blink2Talk stage log

Figma "Idea to Demo" track, Cal Hacks 13.0. Built from the team's commit history (50 commits by 4 people, 13:22 to 21:27 on Oct 24) and `docs/worklog.md`, which logged the Figma sessions as they happened. Each stage entry stays under 200 words. Two things are still Noel's to fill in: each stage's rating, and setting every Figma link to "Anyone with the link can view".

## Running time log

Times are PDT, Oct 24, 2026.

| Date and time | Stage | Who | Figma tool | Minutes | What happened (include dead ends) |
|---|---|---|---|---|---|
| Oct 24, 00:49 | Ideation | Noel + Claude Code | None (text) | ~11 | Wrote the product brief (`design/claude-design-prompt.md`). |
| Oct 24, 01:28 | Ideation | Noel + Claude Code | FigJam via Figma MCP | ~4 | Generated the core-loop diagram from Mermaid, then built the board around it. |
| Oct 24, 01:40 | Ideation | Noel + Claude Code | FigJam via Figma MCP | ~2 | Remade the board in the Education team. The first copy landed in a personal Starter team. |
| Oct 24, 11:41 | Prototyping | Noel + Claude Code | Figma Design via Figma MCP | ~18 | Variables, 15 icon components, 7 components, 26 frames for patient screens 1–7, a clickable main loop. Two calls went to rework. |
| Oct 24, 12:40 | Handoff | Noel + Claude Code | Figma MCP (`get_design_context`) | ~17 | Pulled Listening and Speaking from Figma into the Electron app; reply cards and `tokens.css` came from the Claude Design project. Found token mismatches. |
| Oct 24, 13:05–21:27 | Code generation | Whole team + Claude Code | None after handoff | ~500 | 50 commits. At 15:00 the replies moved from Figma's single row to a 2×2 grid the eye tracker can target; Figma was not updated. |

---

## Stage 1: Ideation

- **Figma tool:** FigJam, via the Figma MCP server (`generate_diagram`, `use_figma`) in Claude Code
- **Time:** about 10 minutes
- **Rating:** 4/5 [your call]
- **File:** https://www.figma.com/board/UUvIgVgt97D63Xljrq3L0b

**Why:** We started from a written brief, and the reply loop has many branches. The patient looks left or right, long-blinks to pick, and undoes with a double blink. Picking "None of these" twice opens the keyboard. Tired mode cuts the choices. We wanted every path visible before drawing screens. We wrote the loop as Mermaid, and `generate_diagram` made it an editable FigJam diagram. Around it we added the problem, users, constraints, risks, and a keep/cut list.

**Friction:** The loop-back arrows made the auto layout sprawl. We kept it instead of hand-placing 19 shapes. The first board landed in a personal Starter team, so we regenerated it in our Education team from the same source.

**What carried forward:** The bedside constraints became the rules for every screen: text at least 28 px, no brightness changes, and no vitals on the patient view. The keep/cut list set which screens we designed. The riskiest assumption, blink and look detection, became the code team's first task.

---

## Stage 2: Prototyping

- **Figma tool:** Figma Design, built through the Figma MCP server (`use_figma`) from Claude Code. Figma Make not used.
- **Time:** about 18 minutes (11:41 to 11:59)
- **Rating:** [your call, 1–5]
- **File:** https://www.figma.com/design/qhB3qvr3odYDYNlIcyNwy3

**Why:** The screens had to stay readable from a hospital bed on any laptop, in a dark room or a bright one. So we built the rules first: color variables with Dark and Light modes, and size variables with a mode per screen width (1280, 1440, 1920) standing in for CSS `clamp()`.

**What we built:** 15 Lucide icon components; ReplyCard (7 states), EndOption, CaptionBar, EyeStatusIndicator, LookCue, KeyboardKey, and CareButton; 26 frames for patient screens 1–7, with the 1280 and 1920 copies switching only the size mode; a light-theme check; and a clickable main loop (Space = long blink, arrows = look).

**Friction:** Two of four calls were rework. The reply row clipped the 6 px outside outline, and variable-sized icons resized their frame but not the drawing, fixed with SCALE constraints and a refit. Light `--selected` changed to #5CCDB3 to keep 7:1 contrast with dark text.

**What carried forward:** Component names, states, and the clickable loop as the behavior spec.

---

## Stage 3: Handoff

- **Figma tool:** Figma MCP server (`get_design_context`, 2 calls) into Claude Code
- **Time:** about 17 minutes (12:40 to 12:57)
- **Rating:** [your call, 1–5]

**Why:** The coding agent read layout, values, and icons straight from the file, so nobody copied numbers by hand.

**What we passed:** Listening and Speaking came from Figma with their icons. RepliesScreen, ReplyCard, EndOption, and `tokens.css` came from a parallel Claude Design project, with `tokens.css` copied unchanged. Component names carried into code: ReplyCard is `.reply-card`, EndOption is `.end-option`.

**Friction:** Two design sources meant two sets of tokens. Figma's variables and `tokens.css` disagree on `--border`, `--text-muted`, light `--selected`, and some type sizes; the code follows `tokens.css`.

**Traceability:** ReplyCard, a Figma component with 7 states, is `.reply-card` in `app/renderer/app.css`, and `view.js` sets its state as `data-state` (default, highlighted, hold, selected, loading, dimmed, empty). Its selected color shows the mismatch: Figma's light `--selected` is #5CCDB3; `tokens.css` uses #0A5F4F.

---

## Stage 4: Code generation

- **Figma tool:** MCP into a coding agent (Claude Code) for the first screens; no Figma tool after that
- **Time:** about 8 hours (13:05 to 21:27), 50 commits by 4 people
- **Rating:** [your call, 1–5]
- **Repo:** https://github.com/NoelSason/blink2talk

**Why:** The hard parts have no Figma equivalent: webcam eye tracking (MediaPipe face landmarks, calibration, squint detection), live speech-to-text, Claude replies, and a cloned voice. We wrote those by hand with Claude Code.

**What came from Figma:** The Listening and Speaking layouts, icons, component names, and the main-loop behavior. Everything else was designed in code: the 2×2 grid, calibration dots, the consent confirm, Spell it, the care panel, and the eye accuracy record.

**Friction:** At 15:00 we switched from stepping through Figma's single row with left and right glances to looking straight at a box. The tracker tells the four screen corners apart best, so the replies moved to a 2×2 grid in the corners. We didn't loop back to update Figma, so the Figma file still shows the row.

---

## Reuse notes

1. Write the loop as Mermaid, generate the FigJam diagram, and put the constraints on the same board.
2. Turn the constraints into variables (color modes, a size mode per screen width) before drawing any screen.
3. Name components the same in Figma and code, and pull them with the MCP server instead of copying values.
4. When hardware changes the layout (for us, the eye tracker), update the Figma file the same hour. We didn't, and the design stopped matching the app.
