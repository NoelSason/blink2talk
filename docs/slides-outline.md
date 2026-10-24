# Blink2Talk Figma Slides outline (draft)

Ten to twelve slides. One idea per slide, short copy, and real screenshots instead of mockups of mockups. Text in [brackets] is for you to fill in.

**Requirements this deck has to meet:**
- Embed the Figma prototype and/or Make file (slide 3 or 7).
- Link to the working code repository (slides 3 and 12).
- Show which tool you used at each stage and why (slides 5–9).
- Every linked Figma file is set to "Anyone with the link can view".

---

### 1. Title
- **Blink2Talk**
- A voice for patients who are awake but can't speak or use their hands.
- [Team names] · Cal Hacks 13.0 · Figma "Idea to Demo"

### 2. The problem
- ICU patients on ventilators, people after a stroke, and people with ALS are often fully awake but can't speak or write.
- Today: yes-or-no blinks, or a letter board someone has to hold.
- How might we let a patient answer in a few seconds, using only their eyes?
- Visual: one photo or illustration of the bedside setup (laptop on the overbed table).

### 3. The demo
- Embed: the main-loop prototype, or a 20–30 second clip of the working app.
- One line: "Look left or right to move. Long blink to choose. It speaks for you."
- Link: [repo] · [full demo video]

### 4. How it works, in one picture
- The four steps: someone asks → replies appear → patient picks with their eyes → the reply is spoken.
- A small inset for the care panel on the nurse's phone.

### 5. Our actual path
- A left-to-right map of the stages, drawn honestly with any loops back:
  Brief (text) → FigJam board → [Design file] → [Make test?] → Handoff → Code → [back to Figma to fix X]
- Label each arrow with what passed along it (for example "constraints", "variables", "component names").

### 6. Stage 1: Ideation (FigJam)
- Screenshot: the board, zoomed so the six zones and the diagram are readable.
- Tool and why: the Mermaid source became a FigJam diagram through the Figma MCP server, so every branch of the loop was visible before any screen existed.
- About 10 minutes · 4/5 [your rating]
- Carried forward: bedside constraints became design rules; keep/cut set the screen list.

### 7. Stage 2: Prototyping (Figma Design [+ Make])
- Embed: the clickable main loop.
- Screenshot: the variables panel (dark and light) and the ReplyCard states.
- Tool and why: [ ]
- [minutes] · [rating]
- What changed after you tried it: [ ]

### 8. Stage 3: Handoff
- Side by side: a Figma component next to the same element in the running app, with matching names.
- Tool and why: [Dev Mode / MCP / manual]
- [minutes] · [rating]

### 9. Stage 4: Code
- Repo link and a screenshot of the running app.
- What started from Figma, and what the team wrote by hand and why.
- [minutes] · [rating]

### 10. Friction and dead ends
- The diagram layout sprawled because of loop-back arrows. We kept it.
- The first board landed in the wrong Figma team. We regenerated it from the same source.
- [Prototyping rework]
- [Handoff mismatch]
- [Anything you abandoned]

### 11. Reuse this process
- Three or four steps another team could run on a different idea (copy from the stage log's reuse notes).

### 12. Links
- FigJam board · Design file · [Make file] · Repo · Demo video
- All Figma files: anyone with the link can view.
