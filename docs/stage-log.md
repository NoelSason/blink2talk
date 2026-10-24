# Blink2Talk stage log (draft)

Figma "Idea to Demo" track, Cal Hacks 13.0. Each stage entry must stay under 200 words. Text in [brackets] is a prompt for you to replace. Delete any stage you didn't use Figma for, or say plainly that you didn't.

## Running time log

Fill this in as you go. Minutes and friction are much easier to record now than to reconstruct at submission time.

| Date and time | Stage | Who | Figma tool | Minutes | What happened (include dead ends) |
|---|---|---|---|---|---|
| Oct 24, 00:49 | Ideation | [who] | None (text) | ~11 | Wrote the product brief (`design/claude-design-prompt.md`). |
| Oct 24, 01:28 | Ideation | Noel + Claude Code | FigJam via Figma MCP | ~4 | Generated the core-loop diagram from Mermaid, then built the board around it. |
| Oct 24, 01:40 | Ideation | Noel + Claude Code | FigJam via Figma MCP | ~2 | Remade the board in the Education team. The first copy landed in a personal Starter team. |
| [ ] | Prototyping | [ ] | [ ] | [ ] | [ ] |
| [ ] | Handoff | [ ] | [ ] | [ ] | [ ] |
| [ ] | Code generation | [ ] | [ ] | [ ] | [ ] |

---

## Stage 1: Ideation

- **Figma tool:** FigJam, via the Figma MCP server (`generate_diagram`, `use_figma`) in Claude Code
- **Time:** about 10 minutes
- **Rating:** 4/5 [your call]
- **File:** [FigJam board link, set to "Anyone with the link can view"]

**Why:** We started from a written brief, and the reply loop has many branches. The patient looks left or right, long-blinks to pick, and undoes with a double blink. Picking "None of these" twice opens the keyboard. Tired mode cuts the choices. We wanted every path visible before drawing screens. We wrote the loop as Mermaid, and `generate_diagram` made it an editable FigJam diagram. Around it we added the problem, users, constraints, risks, and a keep/cut list.

**Friction:** The loop-back arrows made the auto layout sprawl. We kept it instead of hand-placing 19 shapes. The first board landed in a personal Starter team, so we regenerated it in our Education team from the same source.

**What carried forward:** The bedside constraints became the rules for every screen: text at least 28 px, no brightness changes, and no vitals on the patient view. The keep/cut list set which screens we designed. The riskiest assumption, blink and look detection, became the code team's first task.

---

## Stage 2: Prototyping

- **Figma tool:** [Figma Design / Figma Make / both]
- **Time:** [minutes]
- **Rating:** [1–5]
- **File:** [Design file link] [Make link, if used]

**Why:** [What question you needed the prototype to answer. For example: "Can a patient tell which reply is highlighted from 80 cm away, in grayscale?" or "How fast should the highlight step on its own?" Name the tool you picked and why it fit that question better than the other options.]

**What we built:** [Variables for dark and light themes, components and their states, which screens, and which flow is clickable.]

**Friction:** [What you redid and why. Examples: a component you rebuilt, a state you forgot, something that looked fine at 1440 px and broke at 1280 px, a Make output you threw away.]

**What carried forward:** [What the code team received: the file link, variable names, component names, and the prototype as the behavior spec.]

---

## Stage 3: Handoff

- **Figma tool:** [Dev Mode / Figma MCP server / copied by hand]
- **Time:** [minutes]
- **Rating:** [1–5]

**Why:** [How the code team got exact values and structure out of Figma, and why that method.]

**What we passed:** [For example: color variables became CSS custom properties with the same names; component names match the code (`ReplyCard`, `CaptionBar`); the prototype defines the timing and states.]

**Friction:** [Anything that didn't map cleanly: values that had to be renamed, states missing from the design, things the code team had to guess.]

**Traceability:** [Point to one element and follow it from the board to the design to the code. For example: the "Selected" state, from the FigJam constraint sticky to the ReplyCard variant to the CSS class.]

---

## Stage 4: Code generation

- **Figma tool:** [Make code / MCP into a coding agent / none]
- **Time:** [minutes]
- **Rating:** [1–5, or "not used"]
- **Repo:** [link]

**Why:** [If you used a Figma tool here, why. If not, say what the team used instead and why a Figma tool didn't fit. For example: "Eye tracking needed webcam access and a face model, so we wrote it by hand."]

**What came from Figma:** [Which parts of the code started from Figma output, and which didn't.]

**Friction:** [Rework between design and code, and anything you looped back to Figma to fix.]

---

## Reuse notes (optional, but judges ask for it)

[Three or four steps another team could follow on a different idea. For example: 1. Write the loop as text and generate the diagram. 2. Turn the board's constraints into variables and component states. 3. Name components the same in Figma and code. 4. Log minutes and friction as you go.]
