// Streaks (/streak): days in a row with activity in a server.
// Reference catalog: es and pt-BR must have the same keys and placeholders.
module.exports = {
  'streaks.milestone': '🔥 {user} reached a **{days}-day** streak! Keep it going!',
  'streaks.dm.reminder': '🔥 Your **{days}-day** streak in **{server}** ends in about {hours} h. Send a message or join a voice channel to keep it.\n-# Turn these messages off with `/streak notifications:false`.',
  'streaks.dm.lost': '💔 Your **{days}-day** streak in **{server}** ended. Start a new one today!\n-# Turn these messages off with `/streak notifications:false`.',
  'streaks.notifications.on': 'Messages and nickname of your streaks: ON.',
  'streaks.notifications.off': 'Messages and nickname of your streaks: OFF. Petto will not send you DMs about them or change your nickname.',
  'streaks.title': 'Your streak',
  'streaks.off': 'This server does not count streaks.',
  'streaks.failed': 'I could not do that. Try again in a moment.',
  'streaks.current': '🔥 Current streak: **{n}** days',
  'streaks.best': '🏆 Best streak: **{n}** days',
  'streaks.today.yes': '✅ Today already counts.',
  'streaks.today.no': '▫️ Today does not count yet: be active before the day ends (UTC) to keep it.',
  'streaks.freezes': '❄️ Freezes used in this streak: {used} of {total} (they come with your plan).',
  'streaks.rule.messages': 'A day counts with at least {messages} messages in this server.',
  'streaks.rule.voice': 'A day counts with at least {minutes} minutes in voice in this server.',
  'streaks.rule.any': 'A day counts with at least {messages} messages or {minutes} minutes in voice in this server.',
  'streaks.rule.both': 'A day counts with at least {messages} messages and {minutes} minutes in voice in this server.',
};
