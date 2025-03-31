// utils/tonePrompts.js
function getPromptByTone(tone) {
  switch (tone) {
    case 'motivational':
      return '🔥 What big move are you making today?';
    case 'snarky':
      return '😏 You gonna actually do something today or nah?';
    default:
      return 'What’s your #1 goal today?';
  }
}

module.exports = { getPromptByTone };
