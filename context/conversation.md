# Conversation context (owner: Samarth)

Updated: 2026-10-24 (skeleton written by Marco from `conversation/README.md`; Samarth, correct and own this)

## Now
- Working on:
- Next:
- Blocked on:

## Build-order status
- Step 1 (STT, Claude, TTS): server runs. Cartesia Ink-2 streaming STT, Haiku replies, Sonic TTS in the cloned voice.
- Step 2 (mocks): `MOCK_REPLIES`, `MOCK_VOICE` exist. CLAUDE.md names them `MOCK_STT` / `MOCK_LLM` / `MOCK_TTS`.

## Interfaces as built
HTTP on `localhost:8787`: `POST /replies`, `POST /complete`, `POST /speak`, `GET /stt-token`. Replies return 3 to 4 options plus `addressed`, `urgent[]`, `spellOption`.
CLAUDE.md table says `transcript { text, final }` and `options { replies: [{ text, intent }], highStakes }` (exactly 3) as IPC events, and `speak { text }` back. HTTP vs IPC and 3-4 vs exactly 3 are open deviations until you log them.

## Deviations from CLAUDE.md
| Date | CLAUDE.md says | We did | Why | Affects | CLAUDE.md updated? |
| --- | --- | --- | --- | --- | --- |

## Decisions (newest first)
- 2026-10-24: Default model `claude-haiku-5-5` for latency (from commit log).

## Open questions / needs from others

## Run and check
```sh
cd conversation && npm install && cp .env.example .env && npm start   # http://localhost:8787
```
