// Spell it on the same 2×2 grid as the replies, so every target is a big box the eye tracker can hit.
// Each pick narrows the letters until one is left: E, T, A and O take two picks, every other letter
// three. Suggested words and the actions (Space, Delete, Speak, Back) share the bottom-right box.

const GROUPS = ['ETAO', 'INSHRDLU', 'CMWFGYPBVKJXQZ']; // most-used letters first
const ACTIONS = ['Space', 'Delete', 'Speak', 'Back'];
const ACTIONS_BOX = { pick: 'actions', label: 'Space, Delete, Speak' };

// At most 4 nearly even groups, in order.
function split(letters) {
  const n = Math.min(4, letters.length);
  const out = [];
  for (let k = 0, i = 0; k < n; k++) {
    const size = Math.ceil((letters.length - i) / (n - k));
    out.push(letters.slice(i, i + size));
    i += size;
  }
  return out;
}

const letterBox = (g) => (g.length === 1 ? { pick: 'letter', label: g } : { pick: 'group', label: [...g].join(' '), letters: g });
const fill4 = (boxes) => [0, 1, 2, 3].map((i) => boxes[i] ?? null);

// The four boxes (null = empty cell) for a level:
//   { kind: 'root' } | { kind: 'letters', letters } | { kind: 'words' } | { kind: 'actions' }
export function spellBoxes(level, words) {
  if (level.kind === 'letters') return fill4(split(level.letters).map(letterBox));
  if (level.kind === 'actions') return ACTIONS.map((a) => ({ pick: 'action', label: a }));
  if (level.kind === 'words') return [...[0, 1, 2].map((i) => (words[i] ? { pick: 'word', label: words[i] } : null)), ACTIONS_BOX];
  return [...GROUPS.map(letterBox), words.length ? { pick: 'words', label: words.slice(0, 3).join(', ') } : ACTIONS_BOX];
}
