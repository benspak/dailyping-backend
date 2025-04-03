// utils/tonePrompts.js

const tonePrompts = {
  gentle: {
    subject: "DailyPing: What's your #1 goal today?",
    body: "Just checking in — what's one thing you'd like to get done today?"
  },
  motivational: {
    subject: "🚀 Let's crush it today!",
    body: "Big goals need bold starts. What’s your #1 priority today?"
  },
  snarky: {
    subject: "🤨 So… what are you doing today?",
    body: "Seriously. Don’t just scroll. What’s the one thing you’re actually going to finish?"
  }
};

function getPromptByTone(tone = 'gentle') {
  return tonePrompts[tone] || tonePrompts['gentle'];
}

module.exports = { tonePrompts, getPromptByTone };
