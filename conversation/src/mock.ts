export function mockReplies(transcript: string): string[] {
  const t = transcript.toLowerCase();
  if (/thirst|water|drink/.test(t)) return ["Yes, water please", "Just a little", "Not now"];
  if (/pain|hurt/.test(t)) return ["Yes, a lot", "A little", "No pain", "Different place"];
  if (/comfortable|position|pillow/.test(t)) return ["Yes", "No", "Raise my head", "Adjust my pillow"];
  return ["Yes", "No", "Not sure", "Please repeat that"];
}

export function mockComplete(prefix: string): string[] {
  const words = ["water", "wife", "warm", "wait", "want", "pillow", "pain", "please", "phone", "turn"];
  return words.filter((w) => w.startsWith(prefix.toLowerCase())).slice(0, 4);
}
