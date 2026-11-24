// Streaks (/streak): days in a row with activity in a server.
// Reference catalog: es and pt-BR must have the same keys and placeholders.
module.exports = {
  'streaks.milestone': '🔥 ¡{user} llegó a una racha de **{days} días**! ¡Sigue así!',
  'streaks.dm.reminder': '🔥 Tu racha de **{days} días** en **{server}** termina en unas {hours} h. Escribe un mensaje o entra a un canal de voz para mantenerla.\n-# Apaga estos mensajes con `/streak notifications:false`.',
  'streaks.dm.lost': '💔 Tu racha de **{days} días** en **{server}** terminó. ¡Empieza una nueva hoy!\n-# Apaga estos mensajes con `/streak notifications:false`.',
  'streaks.notifications.on': 'Mensajes y apodo de tus rachas: ACTIVADOS.',
  'streaks.notifications.off': 'Mensajes y apodo de tus rachas: DESACTIVADOS. Petto no te enviará MDs sobre ellas ni cambiará tu apodo.',
  'streaks.title': 'Tu racha',
  'streaks.off': 'Este servidor no cuenta rachas.',
  'streaks.failed': 'No pude hacerlo. Prueba otra vez en un momento.',
  'streaks.current': '🔥 Racha actual: **{n}** días',
  'streaks.best': '🏆 Mejor racha: **{n}** días',
  'streaks.today.yes': '✅ Hoy ya cuenta.',
  'streaks.today.no': '▫️ Hoy todavía no cuenta: sé activo antes de que termine el día (UTC) para mantenerla.',
  'streaks.freezes': '❄️ Congelaciones usadas en esta racha: {used} de {total} (vienen con tu plan).',
  'streaks.rule.messages': 'Un día cuenta con al menos {messages} mensajes en este servidor.',
  'streaks.rule.voice': 'Un día cuenta con al menos {minutes} minutos en voz en este servidor.',
  'streaks.rule.any': 'Un día cuenta con al menos {messages} mensajes o {minutes} minutos en voz en este servidor.',
  'streaks.rule.both': 'Un día cuenta con al menos {messages} mensajes y {minutes} minutos en voz en este servidor.',
};
