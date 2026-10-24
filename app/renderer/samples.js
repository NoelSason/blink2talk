// Sample questions for the demo controls, and sample replies for when the conversation server
// (../conversation) isn't running. With the server up, replies come from Claude.

export const PATIENT = 'Rosa';

// Each question has reply sets in order. "None of these" moves to the next set.
export const QUESTIONS = [
  {
    speaker: 'Nurse',
    text: 'Are you in any pain right now?',
    replySets: [
      ['Yes, a lot', 'A little', 'No', "It's my back"],
      ["It's my head", 'My stomach', 'When I move', "I'm not sure"],
    ],
  },
  {
    speaker: 'Nurse',
    text: 'Do you want me to call your daughter?',
    replySets: [
      ['Yes, please', 'Not now', 'Is she okay?', 'Tell her I love her'],
      ['Call her later', 'Send her a message', 'Ask her to visit', 'No, thank you'],
    ],
  },
];
