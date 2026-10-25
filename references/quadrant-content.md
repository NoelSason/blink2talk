# Quadrant content: what goes in the four boxes

What the patient should be offered in the 2×2 layout (`vision/src/cv/quadrant.ts`), and why. Decides
content and placement only — the detection, calibration and timing are settled in `vision/README.md`.
Written against the app as of the `vision-module` branch, Oct 2026.

## The constraint we are spending

One selection costs 300 ms focus dwell + 800 ms hold + 1200 ms refractory
(`DEFAULT_QUADRANT`, `DEFAULT_BLINK`) ≈ **2.3 s for 2 bits**, or about 0.87 bit/s. English runs
1.0–1.5 bits per character, so the raw channel is under one character per second and a 30-character
sentence is over half a minute. Bits have to be spent choosing whole *messages*, not letters.
Spelling is the last resort, not the fallback.

Two geometry facts constrain placement:

- **The vertical axis is the weak one.** The classifier freezes gaze features during a hold because
  "the lids drag vertical gaze features down" (`quadrant.ts`), and blink thresholds are taken from the
  narrowest normal look, "usually a bottom box." Looking down and closing the eyes are nearly the same
  signal. The shipped app uses left/right only.
- **Per-target accuracy is already measured** (`QuadrantCalibration.accuracy`), so placement can adapt
  per patient at calibration time, and weak targets can be dropped.

## Placement rule: 3 content + 1 escape

| Slot | Gets | Why |
|---|---|---|
| Top-left | Most likely / highest-stakes option | Strong axis, best separation |
| Top-right | Second option | Strong axis |
| Bottom-left | Third, least-likely option | Weak row, so the cheapest content lives here |
| Bottom-right | Escape ("Not this →") | Weak row; a false escape costs a round-trip, not a wrong sentence |

Error cost is allocated inversely to target reliability: a bottom-row mix-up swaps the least-likely
reply for the escape, the cheapest confusion available. Position is assigned **by rank,
deterministically — never by the model** — so it becomes muscle memory. The escape never moves.

Three further invariants:

- **The fourth quadrant always goes deeper. Back is always a double blink.** Never a "back" box.
- **The centre rest circle holds the caption** (what the nurse said, the sentence so far). It is the
  only place the patient can look without consequence.
- **Degrade down, not sideways.** When `cal.accuracy` is weak on the bottom row, or a `fatigue` event
  fires, drop to two content boxes on the top row. Never shrink to three by dropping the escape.

The escape box exists because `safety.ts` already promises "None of these, I'll spell it" is always
offered. Four model-generated replies with no visible exit is the standard AAC failure: the patient
takes the nearest wrong sentence and it is spoken aloud in their own cloned voice.

## What the literature changes

### 1. We built a reply machine; patients mostly need to initiate

Nurses start about **86% of ICU exchanges** (Happ et al. 2011, 747 videotaped exchanges; 71.8%
succeeded overall, and **37.7% of pain communications failed**). A screen that only fills after the
nurse speaks mechanises that asymmetry — in conversation-analytic terms the patient can only ever
occupy the *second pair part*. They can answer, never ask.

**Consequence:** the idle screen is not a waiting room. It is the patient's only first-pair-part
capability and needs real content.

### 2. The largest missing category is questions, not answers

In cardiac-surgery wake-up patients the most-wanted messages were "I can't breathe / take the tube
out" 59%, **orientation — is it over, what time, what day — 52%**, pain 48%, thirst 44%.

Orientation is half the demand and **the system can answer it with no human in the loop**: time, day,
where you are, what happened, when extubation is planned are all known to the app or the chart. Two
selections buy a complete answer at zero nurse latency — the best bits-per-second in the whole design.

### 3. All four of Light's purposes have to be reachable

Light (1988) partitions communicative interaction into **needs/wants, information transfer, social
closeness, social etiquette**. Her standing critique is that AAC systems over-serve needs/wants and
starve social closeness — which users and families rate highest. Blink2Talk today is entirely
needs/wants plus answering; "I'm scared", "tell her I love her", "don't leave" are unreachable.

**Consequence:** treat the four purposes as a coverage audit. Every one must be reachable in ≤ 2
selections from idle.

### 4. The interface will manufacture consent unless refusal is one selection

Dispreferred responses — refusal, disagreement — are normally delayed, hedged and *accounted for*
("no, not right now, I just…"). In speech that is free. At 2.3 s per selection it is a tax on saying
no, layered on top of the documented acquiescence bias in people with communication impairment.

**Consequence:** "No" must be a single selection at the same depth as "Yes", with its account
**pre-packaged** into the option text, so the patient never pays extra to refuse.

### 5. Repair is the most frequent function, not an edge case

Dingemanse et al. (2015) found 2,053 other-initiated repairs in 48.5 exhaustively sampled hours across
12 languages — one every ~1.4 minutes in *fluent* speech. Our channel already fails ~28% of the time.

Different repair types need different slots: open-class ("say that again"), candidate understanding
("you mean the tube?"), and **self-repair after the wrong sentence has already been spoken in the
patient's cloned voice** — which has no representation in the app at all.

**Consequence:** undo-before-speaking is navigation and belongs on the double blink. Retraction
after speaking is a speech act and gets a box.

### 6. Every patient turn reads as a breakdown

Modal inter-turn gap across languages is ~0–200 ms; over 700 ms is heard as trouble (Stivers et al.
2009; Sacks, Schegloff & Jefferson 1974). Our turns are 2.3–10 s, so nurses interrupt, answer for the
patient, or leave.

**Consequence:** claim the floor the instant focus lands, before the hold completes, and give the
patient a zero-cost backchannel.

### 7. The cheap partner should absorb the work

Clark & Brennan's (1991) principle of least collaborative effort: the pair minimises *joint* effort.
Our costs are asymmetric by roughly 1000×.

**Consequence:** the highest-leverage change is not on the patient screen. Prompt the **nurse** to
convert open questions into polar ones. Six seconds of nurse effort saves thirty of patient effort.

## The allocation

### Idle — patient-initiated

All four of Light's purposes within two selections; the two life-critical items in one.

| | |
|---|---|
| **I can't breathe / suction me** — 1 select, also alerts | **I'm in pain** — 1 select, also alerts, then where / how bad |
| **I need something →** thirst, position, cold, bathroom, sleep, light | **I want to ask or say →** |

"I want to ask or say" opens: *What time / what day is it?* (auto-answered, no nurse) · *I'm scared* ·
*Tell them I love them* · *More →* (full question list, feelings, spell).

Orientation, fear and closeness all land at two selections ≈ 5 s. This replaces the current Listening
screen, whose single "I want to say something" card costs a selection and buys nothing.

### Responding — typed by the first pair part

Stop generating "the 3 most likely replies" generically. Classify what the nurse just said, then fill
the slot structure for that type.

| Nurse's turn | Top-left | Top-right | Bottom-left | Bottom-right |
|---|---|---|---|---|
| Polar question | Yes | **No, not right now** (pre-accounted) | Likeliest qualifier ("a little", "it's my back") | Not this → |
| Wh-question | guess 1 | guess 2 | guess 3 | Not this → |
| Alternative ("tea or water?") | A | B | Neither | Not this → |
| **Informing** ("your daughter comes at six") | Okay | Thank you | plausible follow-up question | Not this → |
| **Procedure announcement** ("I'm going to suction you") | **Wait** | Okay, go ahead | That hurts | Not this → |
| Consent / treatment | Yes | No | Explain more | Not this → |

The two bold rows do not exist today.

- **Informing** is not a question. The model currently fabricates an *answer* to it. The correct second
  pair part is a news receipt — Light's social etiquette, cheap and high-value.
- **Procedure announcement** carries **Wait**, the patient's only means of halting something being done
  to their body. It goes on the reliable top row.
- **Consent** keeps the hard-coded replies in `safety.ts`. Yes and No split across the *strong*
  horizontal axis — Yes/No confusion is the most dangerous error in the system — and Yes/No needs a
  confirm step.

### After speaking

"That's not what I meant" holds a fixed quadrant for ~10 s before returning to idle.

### Composing

Semantic before alphabetic. Roughly 200 core words cover ~80% of what people say, and core words are
reusable across topics where fringe vocabulary is not. Offer message categories, then core words,
then — only as the last resort — a frequency-weighted 4-ary letter tree (~2.1 selections/letter,
≈ 4.8 s/letter) with the existing `/complete` predictions filling three boxes plus "keep spelling →"
once two letters are in.

## Three cheap mechanisms

1. **Single blink = backchannel.** `blink` events already fire in `blink.ts` and nothing consumes them.
   Wire them to a visible "mm-hm / I'm with you." Continuers (Yngve 1970) cost zero selections and are
   what keep a speaker talking to someone who cannot reply.
2. **Claim the turn at 300 ms.** The moment focus lands — before the hold completes — show the nurse
   "answering…". Free, and converts a breakdown-length silence into a held floor.
3. **Nurse-side reformulation prompts.** Suggest the polar version of whatever open question was asked.

## What to measure

- **Escape rate** — fraction of turns taking "Not this". This is the loss function. Optimise the three
  replies for **coverage**, P(at least one fits), not top-3 likelihood, which clusters ("Yes" / "Yes, a
  lot" / "Yes please").
- **Yes:no ratio.** If it runs far above base rate, the interface is producing acquiescence, not
  agreement.
- **Selections per completed message**, and false-select rate per quadrant against `cal.accuracy`.
- Report only our own measured numbers. Never "clinically validated".

## Caveats

- The 59 / 52 / 48 / 44% figures are one study of post-op cardiac patients with short intubation.
  Use them to order options, not as ICU-wide priors.
- Happ's initiation and success rates are observational, from one multi-site US sample.
- The per-letter and per-selection timings are arithmetic from our configured constants, not measured
  with patients.
- None of this has been tested with an actual ICU patient.

## Sources

- Happ, M. B., Garrett, K., Thomas, D. D., Tate, J., George, E., Houze, M., Radtke, J., & Sereika, S.
  (2011). Nurse-patient communication interactions in the intensive care unit. *American Journal of
  Critical Care*, 20(2), e28–e40. https://pmc.ncbi.nlm.nih.gov/articles/PMC3222584/
- Communication needs of cardiac surgery patients during their wake up process. *Intensive Care
  Medicine Experimental*, 3(S1). https://www.ncbi.nlm.nih.gov/pmc/articles/PMC4796289/
- Light, J. (1988). Interaction involving individuals using augmentative and alternative communication
  systems: State of the art and future directions. *AAC*, 4(2), 66–82. Summary:
  https://praacticalaac.org/praactical/communicative-competence-in-aac/
- Light, J. (1989). Toward a definition of communicative competence for individuals using AAC systems.
  *AAC*, 5(2), 137–144.
  https://praacticalaac.org/wp-content/uploads/filebase/miscellaneous(2)/AAC%20Journal%20Comm%20Competence.pdf
- Dingemanse, M., Roberts, S. G., Baranova, J., et al. (2015). Universal principles in the repair of
  communication problems. *PLOS ONE*, 10(9), e0136100.
  https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0136100
- Cannon, B., & Edmond, G. A few good words: Using core vocabulary to support nonverbal students.
  https://ttac.odu.edu/ATN/Core/CoreVocabularyEssay_Cannon.pdf
- Acquiescence bias (overview, incl. Sigelman et al. on interviews with people with communication
  impairment). https://en.wikipedia.org/wiki/Acquiescence_bias
- Clark, H. H., & Brennan, S. E. (1991). Grounding in communication. In *Perspectives on Socially
  Shared Cognition*. (Principle of least collaborative effort.)
- Sacks, H., Schegloff, E. A., & Jefferson, G. (1974). A simplest systematics for the organization of
  turn-taking for conversation. *Language*, 50(4), 696–735.
- Schegloff, E. A., Jefferson, G., & Sacks, H. (1977). The preference for self-correction in the
  organization of repair in conversation. *Language*, 53(2), 361–382.
- Pomerantz, A. (1984). Agreeing and disagreeing with assessments. In *Structures of Social Action*.
  (Preference organization.)
- Stivers, T., Enfield, N. J., Brown, P., et al. (2009). Universals and cultural variation in turn-taking
  in conversation. *PNAS*, 106(26), 10587–10592.
- Yngve, V. H. (1970). On getting a word in edgewise. *Chicago Linguistic Society*. (Backchannels.)
