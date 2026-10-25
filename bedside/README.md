# Bedside: the local content engine

Decides what goes in the patient's four boxes. Runs entirely on the machine at the bedside — no
network, no API key, nothing about the patient leaves the room.

A sibling of `conversation/`, not a replacement. That server asks Claude for three likely replies;
this one works out **what kind of turn the nurse took** and fills a fixed slot structure for that
type. The design is `references/quadrant-content.md`.

## Why it is shaped this way

A selection costs the patient about 2.3 s (300 ms dwell + 800 ms hold + 1200 ms refractory), so the
screen is spending a very scarce resource. Two consequences run through everything here:

- **The loss function is escape rate**, not top-3 likelihood. Optimise for coverage — P(at least one
  box fits) — because "Yes" / "Yes, a lot" / "Yes please" is three boxes that cover one answer.
- **Classify, then template.** For a polar question, three of four boxes are fixed text. For a
  procedure announcement, all four are. That is what makes a 4B model on a laptop fast enough to be
  worth using, and it is why this server still works with no model at all.

## Running

```
npm install
cp .env.example .env
npm start            # http://localhost:8788
npm test             # layout invariants + classifier
npm run eval         # classification accuracy over a labelled phrase set
```

Phase 1 needs no model and no keys: rules classify the turn, the slot table fills the boxes.

## The slot table

| Nurse's turn | topLeft | topRight | bottomLeft | bottomRight | generated |
|---|---|---|---|---|---|
| polar | Yes | No, not right now | *qualifier* | Not this | 1 |
| wh | *guess* | *guess* | *guess* | Not this | 3 |
| alternative | *A* | *B* | Neither | Not this | 2 |
| informing | Okay | Thank you | *follow-up* | Not this | 1 |
| procedure | **Wait** | Okay, go ahead | That hurts | Not this | 0 |
| consent | Yes | No | Explain more | Not this | 0 |

Two of these rows do not exist in `conversation/`. **Informing** is not a question — "your daughter
comes at six" gets a news receipt, not a fabricated answer. **Procedure** carries *Wait*, the
patient's only way to halt something being done to their body, on the most reliable target.

## Rules that are easy to break

- **Position comes from rank, never from the model.** Same kind of answer, same corner, every time.
  All of it lives in `place()` in `src/layout.ts`, with tests.
- **The escape never moves and is never dropped.** When the patient tires or the bottom row
  calibrates badly, degrade to two content boxes on the strong top row — never to three by removing
  the exit.
- **Idle and drill boards have no escape** and use all four cells for content. Their content is
  hand-authored, so there is nothing to escape from.
- **Refusal is pre-accounted.** "No, not right now" is one selection, same depth as "Yes". If saying
  no costs more than saying yes, the interface manufactures consent.
- **Consent never reaches a model**, and asks for a second confirm.
- `src/safety.ts` is deliberately duplicated from `conversation/src/safety.ts` so this module stands
  alone. Change one, change the other.

## Not built yet

Steps 4-9 of the plan: STT (whisper.cpp), the model adapter, `memory.md`, push-to-talk wiring in the
app, Piper TTS, and the backchannel. `/turn/close` currently takes `{ text }` rather than audio.
