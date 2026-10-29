// Las notas de versión de `!version` en español: etiqueta, resumen y secciones de cada versión (src/utils/releases.js guarda el resto).
module.exports = {
  'v0.7.9': {
    label: 'v0.7.9 · Donut: feeds para todos, !send, botones con acción y búsquedas nuevas',
    summary: 'Feeds abiertos a todos los servidores, `!send`, botones que hacen cosas, formularios con todas las partes de Discord, búsquedas nuevas, `!stats`, una tarjeta de subida de nivel nueva y una base de datos más ligera.',
    sections: [
      {
        title: 'Feeds',
        items: [
          'Los feeds están abiertos a todos los servidores. `!feed add` sigue YouTube, Twitch, Kick, Bluesky, Reddit, Steam, GitHub, npm, PyPI, AniList, Pinterest, Spotify, Deezer, Apple Music, Mastodon, Tumblr, Letterboxd, los juegos gratis de Epic y cualquier blog, buscando mientras escribes. Premium sigue 25 cuentas de cada plataforma (Free, 5).',
          'Feeds automáticos con su propio ritmo, de cada 15 minutos a una vez al día: un solo feed de **Animales**, imágenes por etiquetas (`15m anime roses`), una canción al azar de los charts de Deezer, Apple Music y Spotify, Pokémon, Wikipedia y Chess.com.',
          'YouTube avisa cuando un canal publica, así que un video sale en segundos, y un Short se publica como reproductor. Los avisos de directo de Kick salen en un minuto, y un directo terminado conserva su verde con un botón de repetición.',
        ],
      },
      {
        title: 'Códigos de embed y Petto Code',
        items: [
          '`!send` envía un mensaje como Petto, y `!welcome`, `!leave`, `!boost` y `!dmonjoin` pueden usar un código de embed como mensaje.',
          'Botones que hacen cosas, en códigos de embed, diseños de Components V2 y el editor de la dashboard: dan, quitan o alternan un rol, o muestran un embed guardado (en privado, en el canal o por mensaje directo).',
          'Los formularios de Petto Code (`cmodal`) pueden tener todas las partes de Discord: menús, selectores de miembros, roles y canales, subida de archivos, botones de opción y casillas.',
          '`!steal` y `!jumbo` encuentran los emojis de una tarjeta de Components V2.',
        ],
      },
      {
        title: 'Búsquedas, estadísticas y tarjetas',
        items: [
          'Búsquedas en otros servicios: `!minecraft`, `!github`, `!roblox`, `!steam`, `!twitch`, `!youtube`, `!lastfm` y más, con formas cortas de escribirlas (`!mu Notch`).',
          '`!stats` analiza un servidor solo con números (nunca lo que se escribió), con un panel de privacidad.',
          'Una tarjeta de subida de nivel al estilo de Petto, `!userinfo` y `!serverinfo` rediseñados, `!usercosmetics`, y tarjetas sin color salvo para decir sí o no.',
        ],
      },
      {
        title: 'Servidores y ajustes',
        items: [
          'La XP de voz ya no necesita una segunda persona por defecto, y hay dos límites de XP nuevos en `/level rules`.',
          'Lo que Petto guardó de un servidor que dejó se borra 3 días después, y los datos pesados pueden vivir en una segunda base de datos.',
          'La configuración de un servidor nuevo nunca se pone en un canal público. La música sigue apagada por ahora.',
        ],
      },
      {
        title: 'Correcciones',
        items: [
          'La página de verificación se abre en el idioma del servidor, `!massunban` se detiene cuando el servidor ya no existe, las menciones de AFK se borran, y la lista de enlaces maliciosos de URLhaus se vuelve a leer.',
        ],
      },
    ],
  },
  'v0.7.8': {
    label: 'v0.7.8 · Mochi: IA para tickets, canales de medios, tableros y herramientas nuevas',
    summary: 'Un asistente de IA para tickets (beta), tickets en vivo y mejores transcripciones, canales de medios, un clownboard y tableros con varios emojis, temporizadores con embed, comandos nuevos (páginas, citas, efectos de imagen), más control sobre las apelaciones y una dashboard cuyas tarjetas muestran lo que envía el bot.',
    sections: [
      {
        title: 'Comandos y herramientas nuevas',
        items: [
          '`!pagination` crea un mensaje con hasta 25 páginas y botones para pasarlas. `!quote` convierte un mensaje en una imagen de cita en blanco y negro, `!image <efecto>` cambia una imagen (invertir, desenfocar, pixelar, deep fry…) y `!hex` encuentra el color principal de una imagen.',
          '`!imgonly` y `!urlonly` crean canales de medios: solo imágenes y videos, o solo enlaces de los sitios que elijas. Lo que no encaja se borra, con un aviso que se borra solo.',
          'Bloquear comandos es más fácil: `!dc suggest #cmds` funciona, con varios comandos y canales a la vez, una categoría entera y `!dc list`. Petto también puede publicar sus estadísticas en Omniplex.',
        ],
      },
      {
        title: 'Tickets y el asistente de IA',
        items: [
          'Un asistente de IA para tickets (beta): responde a quien abrió el ticket con las instrucciones y el conocimiento que escribió el dueño, puede leer mensajes del servidor como sus reglas, conoce los canales y responde con tarjetas que tienen un botón **Hablar con una persona**.',
          'Tickets en vivo en la dashboard: los tickets abiertos, sus mensajes y las respuestas del staff.',
          'Las transcripciones se ven como Discord y muestran a Petto como se ve en tu servidor, un canal de ticket borrado cierra su ticket, las valoraciones se dan una sola vez, y los mensajes de tickets por defecto son tarjetas más cálidas con sus propios emojis.',
        ],
      },
      {
        title: 'Apelaciones',
        items: [
          'Los softbans se pueden apelar (actívalo en Apelaciones → Ajustes o con `!appeals types ban, mute, softban`).',
          'Elige si los MD de sanción llevan el enlace de apelación, escribe tu propia línea sobre apelaciones y pide a los miembros esperar hasta 720 horas antes de apelar, todo con `!appeals`.',
        ],
      },
      {
        title: 'Tableros, temporizadores y mensajes',
        items: [
          'Un clownboard (`!clownboard`) se une al starboard y al monkeyboard, y cada tablero puede contar hasta cinco emojis (`!starboard emoji ⭐ 🍌`).',
          'Los temporizadores pueden enviar un embed guardado, borrar el mensaje de la vez anterior (`!timer previous`) y repetirse cada tantos segundos, minutos, horas, días, semanas, meses o años. Las autorespuestas también pueden borrar su respuesta anterior.',
        ],
      },
      {
        title: 'Dashboard',
        items: [
          'Páginas nuevas de Boards y Canales de medios, con una tarjeta por cada tablero o canal y una muestra de cómo se ve.',
          'Las autorespuestas, los comandos propios, los temporizadores y los mensajes fijos son tarjetas con un pequeño chat que muestra lo que envía el bot: formato, emojis, embeds guardados y GIFs.',
          'Un nuevo aspecto para el panel de verificación, y configurar la verificación ya no se agota en servidores grandes.',
        ],
      },
      {
        title: 'Correcciones',
        items: [
          '`!dc suggest #cmds` no hacía nada, `/channel clear` fallaba, el panel de verificación podía publicarse dos veces, y el historial de perfil ahora guarda los avatares antiguos para siempre.',
        ],
      },
    ],
  },
  'v0.7.7': {
    label: 'v0.7.7 · Tiramisu: formularios, contadores en vivo, español y portugués y comandos de barra',
    summary: 'Formularios con su propia página web, contadores en vivo renovados, Petto en español y portugués, un anti-nuke más fuerte, comandos de barra para el día a día, límites gratis generosos y un panel más rápido.',
    sections: [
      {
        title: 'Formularios',
        items: [
          'Formularios y postulaciones con `!form`: hasta 25 preguntas, reglas (roles, edad de la cuenta, esperas, límites, una fecha de cierre), paneles y una tarjeta de revisión con **Aceptar**, **Rechazar** y **Abrir hilo** que da los roles y avisa el resultado por MD.',
          'Cada formulario tiene su propia página web (`petto.sbs/form/<id>`) con un enlace que nadie puede adivinar: los miembros entran con Discord y responden ahí. La página lleva el color, el banner y el fondo del formulario, y su enlace muestra una vista previa que puedes personalizar.',
          'Las preguntas pueden tener una descripción y una imagen, decidir una respuesta cierra su hilo, y el panel tiene una página de Formularios con las respuestas y los paneles.',
        ],
      },
      {
        title: 'Contadores y comunidad',
        items: [
          'Contadores en vivo, renovados: muchos más tipos (en línea, un rol, mejoras, una meta de miembros, un reloj, mensajes de hoy…), nombres con `{count}`, paquetes con `!counter setup`, contadores en el nombre de una categoría o el tema de un canal, y anuncios de metas con `!counter announce`.',
          'Los cambios de nombre respetan el límite de Discord (dos cada 10 minutos) y se reparten en el tiempo, y el panel tiene una página de Contadores con vistas previas, arrastrar para ordenar y cambiar nombres ahí mismo.',
        ],
      },
      {
        title: 'Moderación',
        items: [
          '70 comandos, subcomandos y atajos de moderación nuevos: apodos forzados, `!stripstaff`, silencios de imágenes y reacciones, `!raid clean`, roles temporales, `!restrictcommand`, más filtros de `!purge` y más.',
          'Anti-nuke: cinco protecciones nuevas (cambios de roles y canales, menciones masivas, spam de webhooks, prune), modo pánico, administradores de confianza, solo el dueño y un MD al dueño cuando una protección actúa.',
          'La moderación masiva deja en paz a los miembros que no puedes moderar, `!lock` bloquea el canal donde estás, y el Honeypot se puede configurar desde el panel.',
        ],
      },
      {
        title: 'Idiomas y comandos de barra',
        items: [
          'Petto habla inglés, español y portugués de Brasil: las respuestas, las tarjetas, los paneles, los MD y los registros siguen el idioma del servidor. Cámbialo con `!language`.',
          '21 comandos del día a día también funcionan como comandos de barra (`/help`, `/ping`, `/userinfo`, `/warn`, `/ban`, `/purge`, `/ticket`…) y `/help` muestra las dos formas. `/embed` se suma, y los comandos de barra ya no aparecen dos veces.',
          'Se registran más eventos en las categorías que ya tienes, se puede ignorar un rol en los registros, y `!serverinfo` acepta el ID de otro servidor.',
        ],
      },
      {
        title: 'Panel y Premium',
        items: [
          'Gratis es generoso y Premium es más o menos el doble: 125 comandos personalizados (250 con Premium), 75 respuestas automáticas (150), 25 contadores (50) y más. Las recompensas de nivel y los registros no tienen límite, y 15 fuentes de tarjetas son gratis.',
          'Acceso al panel por rol, páginas de Contadores y Formularios más rápidas, un botón de Sincronizar, una página de Honeypot, y las páginas de Permisos y Cobertura de comandos rehechas.',
          'Restaurar una copia de seguridad pregunta primero, muestra su progreso, se puede detener y puede traer solo algunas partes (las copias siguen en mantenimiento).',
        ],
      },
      {
        title: 'Correcciones',
        items: [
          'Los botones de VoiceMaster ya no fallan cuando el bot va lento, los nombres de reglas de Vanity con espacios funcionan, la página de Formularios del panel vuelve a cargar, y los registros usan el nombre y la imagen que el servidor le dio a Petto.',
        ],
      },
    ],
  },
  'v0.7.6': {
    label: 'v0.7.6 · Macaron: apelaciones, moderación más fuerte y más herramientas para la comunidad',
    summary: 'Un sistema completo de apelaciones con su propia página, moderación más fuerte (antiestafas, lockdown, anti-nuke por protección), mejores tickets, sugerencias, conteo y confesiones, y un nuevo aspecto para el panel.',
    sections: [
      {
        title: 'Apelaciones',
        items: [
          'Una página para cada servidor (`petto.sbs/appeal/<ID o tu nombre>`): los miembros inician sesión con Discord, ven sus sanciones, llenan los formularios que tú creas y siguen su apelación. En inglés, español y portugués.',
          'El staff recibe cada apelación con **Aceptar**, **Rechazar** y **Responder**. Aceptar quita el baneo, el aislamiento y las sanciones activas, y puede crear una invitación de un solo uso (y dice cuál). Rechazar puede bloquear una nueva apelación por un día, una semana, un mes o para siempre.',
          'Tu propio nombre de enlace (`petto.sbs/appeal/amor`), con los nombres reservados y ofensivos bloqueados, una solicitud al equipo cuando un nombre ya está ocupado (de 1 a 72 horas), 30 días de reserva cuando lo cambias, y los nombres que nadie usa se liberan. Las imágenes se pueden subir desde el dispositivo.',
          '`!appeals` muestra el enlace, y el MD de la sanción lo indica. Todo empieza desactivado.',
        ],
      },
      {
        title: 'Moderación',
        items: [
          'Antiestafas (la estafa de MrBeast, por comportamiento, palabras y cuentas nuevas), `!lockdown` para raids, anti-nuke con límites, listas blancas y restauración para cada protección, y plantillas de AutoMod (reglas de Discord y filtros de Petto) con strikes y excepciones.',
          'Quita sanciones desde el panel, busca casos, agrega pruebas y mira estadísticas. VoiceMaster puede copiar los permisos de la categoría, con roles de acceso, privacidad y permisos del dueño (todo desactivado por defecto).',
        ],
      },
      {
        title: 'Comunidad',
        items: [
          'Sugerencias (`!suggest`, votos, hilos y respuestas del staff), Conteo (salvavidas, récords, roles y una tabla de clasificación) y Confesiones (anónimas, revisadas por el staff, con respuestas).',
          'Tickets: paneles con color, imagen y pie de página, un límite por miembro, horario del staff, recordatorios, respuestas rápidas, transcripciones como enlace, como archivo o ambos, y `!ticket panel edit`.',
          'La verificación se puede configurar desde el panel con un solo clic. Las tarjetas de imagen van en cualquier parte con `{imgcard:name}` (40 fuentes).',
        ],
      },
      {
        title: 'Aspecto y panel',
        items: [
          'Las publicaciones del starboard y del monkeyboard se ven como el mensaje original, con un botón **Mensaje original**; `!ping` y `!userinfo` tienen tarjetas nuevas, y los mensajes nuevos son cálidas tarjetas de Components V2.',
          'El panel tiene fuentes nuevas, colores más suaves, un selector de color más fácil de arrastrar, una barra de guardado más pequeña y una página de estado real. El sitio web tiene una página de marca (`/brand`).',
        ],
      },
      {
        title: 'Correcciones',
        items: [
          'Las respuestas funcionan sin el permiso Leer el historial de mensajes, un permiso que falta se explica con palabras sencillas, `!prefix set ?` funciona y las alertas de despliegues muestran solo lo que cambió.',
        ],
      },
    ],
  },
  'v0.7.5': {
    label: 'v0.7.5 · Waffle: cumpleaños, verificación en un canal y un panel más rápido',
    summary: 'Cumpleaños, historial de perfil, una prueba de letras para la verificación (también dentro de Discord y en un canal), el monkeyboard, una tabla de clasificación pública, niveles con sorteos, alertas de despliegues y un panel mucho más rápido.',
    sections: [
      {
        title: 'Novedades',
        items: [
          'Cumpleaños: `!birthday set`, `view`, `upcoming`, `remove` y `config`. Petto celebra con un mensaje a la hora que elijas y, si quieres, con un rol para ese día.',
          'Historial de perfil: `!avatars` muestra todos los avatares en una sola imagen, `!names` y `!nicknames` muestran el resto, `!clear` borra el tuyo y una página de Historial en el panel permite buscar por ID.',
          'Verificación: los miembros pueden escribir las letras de una imagen (en la página o dentro de Discord, sin enlace) y el servidor puede publicar un panel de verificación en un canal (`!verify channel`, o desde el panel).',
          'Monkeyboard 🐒: lo opuesto al starboard, con sus propios ajustes y variables `{monkey.*}`.',
          'Tabla de clasificación pública: `petto.sbs/lb/<nombre>`, en tres idiomas, desactivada hasta que el servidor la active.',
        ],
      },
      {
        title: 'Niveles y sorteos',
        items: [
          'El aviso de subida de nivel responde al mensaje, se borra solo cuando quieras, la voz tiene sus propios roles de recompensa, los multiplicadores funcionan por categoría y tú eliges quién gana XP.',
          'Los sorteos pueden pedir un nivel y dar participaciones extra según el nivel. Una nueva tarjeta de rango por defecto, y `!level manage sync`.',
        ],
      },
      {
        title: 'Despliegues y misiones',
        items: [
          'Alertas de despliegues: los experimentos de Discord se anuncian en un canal con `!rollouts`, con una cola, diseños guardados y una página en el panel.',
          'La lista compacta de misiones es la fuente principal, y las tarjetas de misión por defecto ya no tienen la línea de créditos.',
        ],
      },
      {
        title: 'Velocidad y panel',
        items: [
          'El panel carga de 3 a 16 veces más rápido, los ajustes cambian al instante y Petto hace muchas menos solicitudes a Discord.',
          'Más mensajes pueden tener su propio nombre e imagen (`!sender`), y el panel de Niveles tiene un solo botón Guardar.',
        ],
      },
    ],
  },
  'v0.7.4': {
    label: 'v0.7.4 · Brownie: Vanity en Petto, estadísticas y hardban',
    summary: 'Roles de Vanity y de Server Tag dentro de Petto, un nuevo aspecto para las sanciones, un hardban de verdad, `!summary` con sanciones, entradas, salidas e invitaciones, un rastreador de invitaciones más completo, un prefijo propio y Petto funcionando en GMT-5 (Colombia).',
    sections: [
      {
        title: 'Vanity y Server Tag',
        items: [
          '`!vanity`, `!guildtag` e `!identity` (nombres cortos `!vy` y `!tag`) dan o quitan un rol según el estado personalizado, el nombre o el Server Tag de un miembro, con un mensaje de agradecimiento, un registro y roles persistentes. Se pueden importar los datos del antiguo bot Vanity.',
          'Roles por reacción: botones con color, fila y solo un emoji, y `!reactionrole add new` publica un embed guardado con su botón de rol.',
        ],
      },
      {
        title: 'Moderación',
        items: [
          'Un nuevo aspecto por defecto para las sanciones (respuesta, registro y MD al miembro) en Components V2 con íconos nuevos, y más tipos de mensaje para `!sender`.',
          '`!hardban` es real: solo el dueño del servidor y los administradores del antinuke pueden desbanear, y Petto vuelve a poner el baneo si alguien más lo quita. Un hackban es un baneo por ID.',
          'Expulsar o banear a un bot administrador funciona cuando Petto está por encima de él.',
        ],
      },
      {
        title: 'Estadísticas',
        items: [
          '`!summary` por `messages`, `voice`, `joins`, `leaves`, `invites` o `sanctions`, con la hora más activa, una imagen nueva y la página de Estadísticas en el panel.',
          'El rastreador de invitaciones cuenta las invitaciones falsas y las de bonus, da roles al llegar a un número de invitaciones, tiene variables `{inviter}` para el mensaje de bienvenida y una tabla de clasificación por semana o por mes.',
        ],
      },
      {
        title: 'Tu propio prefijo y tu hora',
        items: [
          '`!myprefix` da a los boosters del servidor de soporte, a los usuarios Premium, a los partners y al equipo un prefijo propio en todos los servidores.',
          'Petto funciona en GMT-5 (Colombia) y lo indica: días, semanas, horas y los horarios que escribes.',
        ],
      },
    ],
  },
  'v0.7.3': {
    label: 'v0.7.3 · Flan: tickets más fáciles, tarjetas de configuración y votos',
    summary: 'Una configuración guiada para los tickets, una tarjeta `!<comando>config` para cada comando, votos de top.gg con un rol para quien vota, y Petto en línea con el ícono del teléfono.',
    sections: [
      {
        title: 'Tickets',
        items: [
          '`!ticket setup` es una configuración guiada: elige el canal, los roles de soporte y un canal de registro, escribe el título y el texto, agrega los tipos de ticket y publica todo con un solo clic.',
          'Los formularios de ticket se crean con botones (`!ticket form create name:<nombre>`), sin tener que escribir la sintaxis de los campos.',
          'Cada tipo de ticket tiene su propio texto de bienvenida, y el nombre del canal acepta `{userid}` y `{category}`.',
          'Herramientas del staff dentro de un ticket: `!ticket priority`, `!ticket transfer`, `!ticket note` y `!ticket request-close`.',
        ],
      },
      {
        title: 'Tarjetas de configuración',
        items: [
          'Cada módulo tiene una tarjeta `!<módulo>config` con lo que el servidor tiene configurado ahora y todos los comandos del módulo: `!brconfig`, `!welcomeconfig`, `!levelconfig`, `!ticketconfig`, `!automodconfig`, `!logsconfig` y 36 más.',
          'Todos los demás comandos tienen su propia tarjeta cuando Petto inicia (`!banconfig`, `!purgeconfig`...), y un comando con nombre corto también tiene su tarjeta con ese nombre (`!arconfig`).',
          '`!cmdconfig` muestra la configuración recomendada de Petto con comandos listos para copiar.',
        ],
      },
      {
        title: 'Votos',
        items: [
          'Petto recibe los votos de top.gg: cada uno se cuenta una sola vez, se agradece en un canal con una tarjeta y le da a quien vota un rol que se queda.',
          '`!votes` muestra los votos de Petto y de un miembro, y `!votes top` los miembros que más votaron.',
        ],
      },
      {
        title: 'Sorteos y estado',
        items: [
          'Un sorteo en curso se puede cambiar desde el panel (premio, ganadores y final), y `!giveaway edit` lee un premio de varias palabras sin comillas.',
          'Petto aparece en línea con el ícono del teléfono por defecto, y el equipo puede cambiar el punto con `!botstatus`.',
          'Cambiar varios permisos de un canal se informa en un solo mensaje de registro.',
        ],
      },
      {
        title: 'Correcciones',
        items: [
          'Las respuestas de partners ahora sí mencionan al encargado de la alianza.',
          'Los mensajes fijados y desfijados se registran de nuevo (el registro fallaba con un error cada vez).',
        ],
      },
    ],
  },
  'v0.7.2': {
    label: 'v0.7.2 · Churro: registros, códigos de embed e hilos de misiones',
    summary: 'Un hilo y un mensaje de "cómo completarla" para las alertas de misiones, códigos de embed en las respuestas automáticas y en `!editembed`, y muchos más eventos en los registros del servidor.',
    sections: [
      {
        title: 'Alertas de misiones',
        items: [
          'Mensajes con su propio nombre e imagen (`!sender`): las alertas de misiones y los mensajes de bienvenida, despedida, boost y sanciones pueden salir por un webhook que parece otra persona.',
          'Una respuesta de botón puede borrar el mensaje en el que está, reaccionar a él o enviar su respuesta en otro canal.',
          'Un embed guardado distinto (normal o V2) para cada tipo de recompensa: Orbs, decoraciones, Nitro, códigos y objetos de juegos, para la alerta y para el método (`!quests type`).',
          'Muchas más variables `{quest.*}`: todos los estilos de marca de tiempo para el inicio y el final (`{quest.starts.relative}`, `{quest.expires.full}`...) y los mismos momentos en palabras para títulos y pies de página (`{quest.starts_ago}`, `{quest.expires_in}`, `{quest.time_left}`).',
          '`!quests thread on` abre un hilo debajo de cada alerta, con su propio nombre, una mención opcional del rol de alertas dentro de él y el tiempo tras el cual se oculta.',
          'El método de las misiones: un mensaje que explica cómo completar las misiones, escrito una sola vez (un texto con las variables `{quest.*}` o un embed guardado con varios textos e imágenes) y enviado en el hilo o en un canal, con o sin mención. `!quests method send` lo envía ahora, y el panel tiene los mismos ajustes.',
        ],
      },
      {
        title: 'Códigos de embed',
        items: [
          'Una respuesta automática puede contestar con un código de embed, con opciones como `--reply`, `--ping`, `--delete`, `--strict` y `--mode`.',
          '`!editembed <enlace del mensaje> <código>` cambia un mensaje que Petto ya envió.',
        ],
      },
      {
        title: 'Registros del servidor',
        items: [
          'Categorías nuevas: `webhooks`, `threads`, `integrations` y `commands`. También se registran stickers, sonidos del soundboard, eventos programados, reglas de AutoMod, mensajes fijados, escenarios, aislamientos, boosts, expulsiones y muchos ajustes del servidor, con quién lo hizo.',
          'En el registro de canales, el rol @everyone se escribe bien y un cambio de permisos dice quién lo hizo.',
        ],
      },
      {
        title: 'Correcciones',
        items: [
          'Un nombre que ya está en uso en el panel ya no se informa como un error de Petto.',
          'Un código de embed con un bloque que perdió su llave de cierre termina ese bloque donde empieza el siguiente.',
          'El total de miembros en los mensajes de estado ya no pierde por un momento los miembros de un servidor entero.',
        ],
      },
    ],
  },
  'v0.7.1-2': {
    label: 'v0.7.1~2 · Boba: sorteos desde el panel',
    summary: 'Una versión pequeña para el panel: inicia sorteos, termínalos y elige ganadores desde la web, y una corrección para los botones de página de las listas.',
    sections: [
      {
        title: 'Panel',
        items: [
          'Los sorteos se pueden iniciar desde el panel, terminar al momento y volver a sortear, con el mismo motor que `!giveaway`.',
        ],
      },
      {
        title: 'Correcciones',
        items: [
          'Los botones de página de `!roles`, `!emojis` y las demás listas ya no fallan en algunas páginas.',
        ],
      },
    ],
  },
  'v0.7.1-1': {
    label: 'v0.7.1~1 · Mochi: listas, tiempos y equipo',
    summary: 'Una versión de mejoras: listas largas con botones, nuevos comandos de información, mejor bloqueo de comandos, tiempos escritos en palabras y un equipo que puedes editar desde el panel.',
    sections: [
      {
        title: 'Listas con botones',
        items: [
          '`!roles` muestra una página a la vez con botones y un menú para ordenarla (más miembros, más nuevos, nombre) o filtrarla (con color, vacíos).',
          'Nuevo: `!emojis`, `!channels`, `!boosters` e `!inrole <rol>` (también `!members`), todos con páginas y un menú para filtrarlos. Solo quien los pidió puede pasar las páginas.',
        ],
      },
      {
        title: 'Bloqueo de comandos',
        items: [
          '`!disablecommand disable roles emojis channels` bloquea varios comandos a la vez, `enable all` borra todas las reglas y `list` tiene páginas. `disablecommand` y `help` no se pueden bloquear, así que nadie se queda sin acceso.',
          'Un comando bloqueado también se bloquea como comando de barra, no solo con el prefijo.',
        ],
      },
      {
        title: 'Tiempos',
        items: [
          'Todos los comandos que reciben una duración entienden `3d 4h`, `1 hour 30 minutes`, `1h30m` y español (`2 horas`). `!remind` también acepta un momento: `tomorrow 8pm`, `2026-10-12 18:00`.',
          'Variables nuevas: `{timestamp}`, `{timestamp.relative}`, `{timestamp.full_long}` y `{timestamp:tomorrow 8pm|R}` para cualquier momento escrito en palabras.',
        ],
      },
      {
        title: 'Otros',
        items: [
          'La página pública de estadísticas muestra el top 5 de servidores.',
          'El dueño puede editar la página del equipo desde el panel (hasta 100 personas por puesto).',
          'Cada versión tiene un nombre. Esta es Mochi.',
        ],
      },
    ],
  },
  'v0.7.1': {
    label: 'v0.7.1 · Partners, paneles y más',
    summary: 'Herramientas para comunidades: alianzas con tabla de clasificación, subidas, solicitudes, reseñas y perfiles, botones y paneles sin código, embeds guardados para los mensajes fijos y alertas de misiones con cuatro fuentes.',
    sections: [
      {
        title: 'Partners',
        items: [
          'Un Partner Manager publica la invitación de otro servidor en un canal de partners y, si cumple los requisitos (mínimo de miembros, antigüedad mínima, un tiempo de espera con el mismo servidor, una lista negra), se cuenta y se responde.',
          '`!partnerconfig` configura los canales (Gratis 6, Premium 25), el rol de manager, los requisitos y 8 respuestas, cada una con texto o con un embed guardado. `!partner stats` y `!partner leaderboard` muestran hoy, esta semana y todo el tiempo.',
        ],
      },
      {
        title: 'Botones y paneles, sin código',
        items: [
          '`!responder add` crea un botón (o una opción de un menú) que responde en privado y da, quita o alterna roles, con un rol requerido opcional.',
          '`!panel` los muestra como botones o como un solo menú, publica el mensaje y lo actualiza en el mismo lugar. Los servidores gratis pueden tener 20 respuestas de botón y 10 paneles; los Premium, 250 y 50.',
          'Los mensajes fijos pueden ser uno de tus embeds guardados (también un diseño V2) y se pueden editar en el panel.',
        ],
      },
      {
        title: 'Subidas, solicitudes y reseñas',
        items: [
          'Subidas: los archivos publicados en los canales que elijas se cuentan por miembro, con un rol y una bienvenida en el primero (`!uploadconfig`, `!uploads`). Gratis 20 canales, Premium 100.',
          'Solicitudes: `!request make` publica una tarjeta con los botones Reclamar, Completar, Liberar y Cancelar para el staff. Con Premium, una solicitud reclamada vuelve a quedar abierta si no se termina a tiempo.',
          'Reseñas y perfiles: `!review give @member 4` califica a un miembro de 1 a 5 estrellas y `!profile` muestra la calificación junto con las subidas, las solicitudes y las alianzas.',
        ],
      },
      {
        title: 'Panel y mejoras',
        items: [
          'Nuevas páginas del panel: Partners, Botones y paneles, Subidas, Solicitudes, y Reseñas y perfiles.',
          'Las alertas de misiones leen cuatro fuentes (primero la lista corta del repositorio discord-api-tracker), así que una nueva misión se ve minutos después de empezar, incluso cuando la API de la comunidad no funciona.',
          'Omniplex se une a la página de Partners del sitio web.',
        ],
      },
      {
        title: 'Correcciones',
        items: [
          'Una misión publicada antes de empezar se anuncia cuando empieza, no horas después.',
        ],
      },
    ],
  },
  'v0.7.0': {
    label: 'v0.7.0 · Petto Code, misiones y Embeds V2',
    summary: 'Una gran versión: comandos personalizados en código para todos los servidores (Gratis 50, Premium 100), con botones, formularios y reacciones, un editor en el panel, alertas de misiones, embeds de Components V2 y estadísticas globales.',
    sections: [
      {
        title: 'Petto Code',
        items: [
          'Los comandos personalizados ya se pueden escribir en **Petto Code**, un pequeño lenguaje de texto y acciones `{{ }}`: variables, `if`, `range`, unas 70 funciones, embeds, menciones y tiempo. `!customcommand code`, `codeshow`, `codetest` (lo ejecuta sin enviar nada), `template`, `export` e `import`.',
          'Botones y menús que ejecutan código (`cbutton`, `cselect`), formularios emergentes (`cmodal`, `ctext`, `showModal`) y reacciones que ejecutan código (`"reactions"` en `complexMessage`, `.Trigger "reaction"`, `removeReaction`). Un solo comando contiene todo el sistema.',
          'Los comandos pueden recordar cosas: contadores, puntos, rankings, tiempos de espera y listas, por servidor o por miembro (`dbSet`, `dbIncr`, `dbTop`...), incluso en su propia base de datos.',
          'Los comandos pueden activarse con su propio prefijo o con palabras (`!customcommand trigger`): `?hello`, `hey bot`, `good morning`.',
          'Los embeds llevan el avatar junto al autor (`authorIcon`), y hay plantillas listas: votación, solicitud, reclamo, sugerencia, reporte, perfil, botón de rol y rol por reacción.',
          'Para todo servidor que pueda gestionar comandos: hasta 50 comandos personalizados en los servidores gratis y 100 en los Premium.',
          'Todo funciona con límites, y lo que pide el código se comprueba con los permisos de quien lo escribió. Documentación: https://code.petto.sbs',
        ],
      },
      {
        title: 'Alertas de misiones',
        items: [
          '`!quests`: Petto publica en un canal cuando Discord tiene una nueva misión, con la imagen, la recompensa (Orbs o la decoración de avatar), las tareas, las plataformas, las fechas y los límites de país o de +18.',
          'Agrega un rol para mencionar, filtra por recompensa (`orbs`, `decoration`, `code`, `ingame`, `nitro`) o por tarea, y recibe un aviso horas antes de que termine. `!quests list` es para todos.',
        ],
      },
      {
        title: 'Embeds V2',
        items: [
          'Un nuevo **editor V2** en Embeds: contenedores, texto, imágenes, secciones, separadores y botones de enlace. Usa los diseños en las alertas de misiones, las sanciones, el starboard, la verificación y los mensajes de bump, y con `!embed send` y `!embed preview`.',
          'Los diseños V2 se comparten con el Embed Builder con un código `p2.`, y usan las variables de siempre (y `{quest.*}`).',
        ],
      },
      {
        title: 'Estadísticas globales',
        items: [
          'Una página pública de **Estadísticas** (`petto.sbs/stats`): mensajes, horas de voz y reacciones de todos los servidores, contadores en movimiento, un top 3 de servidores y un top 10 de miembros.',
          'Cada servidor puede ocultarse desde el panel (General) y cada miembro con `!globalranking off`.',
        ],
      },
      {
        title: 'Panel y mejoras',
        items: [
          'Nuevas páginas del panel: **Comandos en código** (un editor de verdad que revisa tu código mientras escribes, con plantillas, funciones y un botón de prueba) y **Misiones**.',
          'El menú agrupa las secciones (Moderación, Seguridad, Niveles, Automatización, Comunidad...) y en el teléfono es un cajón lateral.',
          'La página de comandos personalizados muestra el prefijo de tu servidor, y la web aclara que Petto usa prefijo, no comandos de barra.',
          '`!help` lleva al panel, al servidor de soporte y a la documentación de Petto Code.',
        ],
      },
      {
        title: 'Correcciones',
        items: [
          'El túnel de Cloudflare ya no escribe su token en los registros.',
          'Se corrigieron errores del panel que pedían datos inexistentes y los textos de Premium que parecían no disponibles.',
          'El número de servidores de la página de inicio y de la página de estado ahora coincide.',
        ],
      },
    ],
  },
  'v0.6.1': {
    label: 'v0.6.1 · Niveles, tarjetas y mensajes personalizados',
    summary: 'Una gran versión: un nuevo sistema de niveles con tarjetas de rango, tarjetas de imagen para todos los mensajes, embeds guardados para sanciones, starboard, sorteos y más, además de cárcel, purge, historial, gestión de reportes y nuevos comandos de diversión.',
    sections: [
      {
        title: 'Niveles',
        items: [
          '`!rank` responde con una tarjeta de rango, con el embed mejorado o con ambos (`!level rank-style`). El embed muestra la posición, el XP para el siguiente nivel, los mensajes, el tiempo en voz, la racha y la semana.',
          'Reglas antiabuso (`!level rules`): longitud mínima, enlaces y menciones, texto repetido y mínimos de voz.',
          'Eventos de XP con multiplicador (`!level event`), bono diario y rachas, y `!top 1 messages week` o `!top 1 messages month`.',
        ],
      },
      {
        title: 'Tarjetas de imagen y embeds',
        items: [
          'Tarjetas de imagen: imágenes dibujadas para bienvenida, despedida, boost, tickets, sorteos, subida de nivel y más. El editor básico es gratis; el editor de capas es Premium.',
          '`!embed create name code:` crea un embed completo (hasta 10) a partir de un código y lo guarda al instante.',
          'Ahora los embeds guardados pueden reemplazar el mensaje habitual de las sanciones (MD, respuesta y registro, por tipo, con `!sanctionmessage`), del starboard, de los sorteos, de los MD de verificación y de los bumps. Variables nuevas: `{case.*}`, `{star.*}`, `{verify.link}`, `{nextBump}`.',
        ],
      },
      {
        title: 'Moderación y reportes',
        items: [
          'Cárcel (`!jail`, `!unjail`): el miembro pierde sus roles y solo ve el canal de la cárcel. Las cárceles con tiempo terminan solas y los roles vuelven al salir. También se puede usar en `warn escalation`.',
          '`!purge` borra mensajes recientes por miembro, tipo o texto, y `!history` muestra todo el historial de moderación de un miembro en una tarjeta.',
          'Los reportes están numerados, con botones Reclamar, Resolver, Descartar y Reabrir, categorías, tiempo de espera, límite diario, bloqueo, una razón al cerrar, un hilo que sigue el reporte y un panel de ajustes.',
          'Menús Report User en usuarios y mensajes.',
        ],
      },
      {
        title: 'Utilidad y diversión',
        items: [
          '`!roll` (`2d6+3`, `4d6kh3`), `!choose` y la categoría Diversión: `!8ball`, `!ship` (con imagen) y `!rps`.',
          'Personalizar (Premium): dale a Petto un estilo de nombre en tu servidor, con degradado, neón o brillo, desde el panel.',
        ],
      },
      {
        title: 'Mejoras',
        items: [
          '`!setup` abre un panel de estado al instante, con una configuración rápida ya rellenada.',
          'Comandos de información (`serverinfo`, `userinfo`, `botinfo`, `roleinfo`...) y `!case list` rediseñados como tarjetas. Las respuestas de roleplay responden al mensaje original. `!remind 2h text` funciona sin `add`.',
        ],
      },
      {
        title: 'Correcciones',
        items: [
          'Los contadores en vivo se actualizan de nuevo, y los contadores de usuarios, bots y boosters cuentan toda la lista de miembros.',
          'Los comandos de bots ya no activan las respuestas automáticas, y las pistas muestran el prefijo que se escribió.',
        ],
      },
    ],
  },
  'v0.6.0': {
    label: 'v0.6.0 · Panel, embeds y Petto Vanity',
    summary: 'Una versión centrada en el panel: habla español y portugués de Brasil, muestra vistas previas de los mensajes como Discord, se conecta con el Embed Builder y ahora también gestiona el bot independiente Petto Vanity.',
    sections: [
      {
        title: 'Panel',
        items: [
          'Todo el panel está traducido al español y al portugués de Brasil, con `/es/dash` y `/pt-br/dash` y un menú de idioma que recuerda la elección.',
          'Las vistas previas de los mensajes se ven como en el Embed Builder, con markdown, enlaces, menciones, emojis y marcas de tiempo, y muestran el nombre y el avatar del propio bot, incluso uno personalizado, también en el join gate.',
          'Las listas de servidores se guardan en caché por poco tiempo y Premium se lee una vez por solicitud, así que las páginas cargan más rápido.',
          'Se corrigió que el panel no se desplazara en pantallas pequeñas en el sitio compilado, y se corrigieron los congelamientos de la vista previa.',
        ],
      },
      {
        title: 'Embeds y variables',
        items: [
          'Los mensajes del panel se pueden enviar al Embed Builder con un código para compartir, los mensajes enviados desde él se pueden abrir en el panel, y se puede enviar un mensaje de prueba a un canal.',
          'Se agregó un registro de las variables de embed y `GET /api/dashboard/variables`, así el panel lee la lista desde el bot. Ahora `npm run check` falla cuando el registro y el motor de variables no coinciden.',
          'Se corrigió un fallo cuando se usaba un comando de embed sin nombre de embed.',
        ],
      },
      {
        title: 'Petto Vanity',
        items: [
          'El bot independiente Petto Vanity se puede gestionar desde el panel: reglas de vanity, reglas de Server Tag, mensajes de agradecimiento y el registro del staff.',
          'Petto Vanity informa su estado, sus servidores, su latencia y su tiempo activo, con una página de estado pública en el sitio de Petto.',
        ],
      },
    ],
  },
  'v0.5.1-46': {
    label: 'v0.5.1-46 · Confiabilidad, seguridad y automatización',
    summary: 'Una versión de confiabilidad y seguridad con detección persistente de enlaces maliciosos, operaciones de servidor más sólidas, casos de moderación independientes y comandos personalizados que entienden argumentos.',
    sections: [
      {
        title: 'Confiabilidad e incorporación',
        items: [
          'Se corrigieron los contadores de webhooks y el manejo de menciones al enviar notificaciones por webhook.',
          'Se corrigió el manejo de interacciones de VoiceMaster y se mejoró la resistencia ante tiempos de espera temporales del gateway de PostgreSQL.',
          'Se agregaron reintentos seguros para las lecturas de la base de datos con fallos temporales y datos en caché como respaldo para la configuración conocida.',
          'Se redujo la carga de la base de datos por los mensajes fijos y las respuestas automáticas, evitando reintentos inseguros al escribir XP.',
          'Se corrigieron sobrescrituras de permisos excesivas y se mejoró la creación de canales de incorporación en servidores grandes.',
        ],
      },
      {
        title: 'AutoMod y enlaces maliciosos',
        items: [
          'Se agregó la detección persistente de URL maliciosas para los enlaces descubiertos con `!am`.',
          'Las URL maliciosas conocidas se reutilizan desde el almacenamiento en lugar de comprobarse con un servicio externo en cada mensaje.',
          'Los enlaces maliciosos conocidos se eliminan automáticamente, y el equipo de desarrollo recibe una alerta cuando se detecta una URL nueva.',
        ],
      },
      {
        title: 'Operaciones de servidor y cumplimiento',
        items: [
          'Se agregó el comando de equipo `guildsend`, además del diagnóstico y la supervisión de cumplimiento automáticos de los servidores.',
          'Se agregó la detección de tiendas/ventas/cumplimiento, alertas de revisión para el equipo, análisis manuales, controles de confirmación de salida y avisos más claros a los servidores.',
        ],
      },
      {
        title: 'Casos de moderación',
        items: [
          'Los números de caso ahora son independientes en cada servidor y se guardan con contadores persistentes por servidor.',
          'Todas las sanciones de moderación y las acciones automáticas comparten una secuencia por servidor, con una migración para el historial de casos existente.',
          '`case list` ya no requiere un usuario y ahora permite filtrar por usuario de forma opcional y tiene paginación.',
        ],
      },
      {
        title: 'Argumentos de comandos personalizados',
        items: [
          'Se agregaron `{args}`, `{arg1}` hasta `{arg10}`, `{args_from:N}`, `{arg_count}`, `{command_name}` y `{prefix}`.',
          'El texto entre comillas se mantiene junto como un solo argumento, las plantillas de embeds guardados admiten las nuevas variables, y los argumentos que escriben los usuarios no pueden crear menciones masivas.',
          'Los comandos personalizados ahora pueden usar plantillas solo de embed, al editar se conservan los campos sin cambios, y el editor de comandos incluye una referencia de variables.',
        ],
      },
    ],
  },
  'v0.5.0': {
    label: 'v0.5.0 · Roles conectados y actividad',
    summary: 'Una versión conectada para los roles vinculados, la sincronización instantánea del prefijo, resúmenes de actividad más completos y roleplay social.',
    sections: [
      {
        title: 'Roles conectados y panel',
        items: [
          'Se agregó el flujo de conexión de roles vinculados para que los miembros conecten Petto con Discord y reciban el rol Petto Verified en los servidores participantes.',
          'La web guarda el prefijo del servidor mediante la API privada del bot y avisa al bot de inmediato.',
          'El bot actualiza su caché de prefijos de inmediato, y al restablecer el prefijo se vuelve a sincronizar el prefijo `!` por defecto.',
          'Los apodos del servidor siguen siendo gratis; Premium sigue cubriendo los demás campos de personalización del perfil del servidor.',
        ],
      },
      {
        title: 'Actividad y roleplay',
        items: [
          'Se agregó el gráfico de actividad de `!summary`, `!weekly` y `!digest` con el estilo oscuro de Overview, series diarias verdes/naranjas y una alternativa solo de texto cuando Canvas no está disponible.',
          'Se agregaron los controles Responder/Rechazar a los comandos de roleplay dirigidos a alguien. El miembro mencionado puede responder una vez con la misma acción o rechazar con una cachetada.',
          'Se agregaron contadores de roleplay persistentes por servidor, por usuario y por acción, y comandos nuevos: `!hi`, `!bye`, `!yes`, `!no`, `!laugh`, `!sad` y `!angry`.',
        ],
      },
      {
        title: 'Correcciones y seguridad',
        items: [
          'Se corrigió el manejo de `.catch()` del trabajo de estadísticas y se actualizaron los mensajes de configuración y eliminación para que la configuración del servidor sea más clara.',
          'Se agregó un límite de solicitudes a la API interna de prefijos para reducir el abuso y cumplir con los controles de seguridad.',
          'Se cambió el texto sobre quién puede ser booster para usar el término `server booster` de Discord.',
        ],
      },
    ],
  },
  'v0.4.1': {
    label: 'v0.4.1 · Reportes y confiabilidad',
    summary: 'Una actualización centrada en los reportes, los cambios de servidor Premium, los detalles del perfil y los registros operativos.',
    sections: [
      {
        title: 'Reportes',
        items: [
          'Se mejoró el sistema de reportes y se agregó el formulario de configuración nativo `/report config`.',
          'Se agregó el selector del rol de moderador urgente y se conectaron los nuevos ajustes de reportes a Community Configs.',
          'Las tarjetas de reporte conservan el enlace, el texto y las imágenes adjuntas del mensaje reportado cuando están disponibles.',
        ],
      },
      {
        title: 'Correcciones y confiabilidad',
        items: [
          'Se corrigió el problema de Premium que podía impedir cambiar el servidor activo u ocultar una asignación de Premium existente.',
          'Se mejoraron la caché del registro de auditoría, los reintentos, los respaldos con datos antiguos y el manejo de mensajes parciales.',
          'Se centralizó el manejo de errores de los eventos para que un controlador que falla no desaparezca en silencio.',
        ],
      },
      {
        title: 'Herramientas de perfil',
        items: [
          'Se mejoraron `!ui` y `!userinfo` con datos de perfil actualizados, banners, avatares, roles, insignias, marcas de tiempo y enlaces de perfil.',
          'Se agregó una mejor detección de cambios de imagen y más información útil para el staff que revisa a un miembro.',
        ],
      },
    ],
  },
  'v0.4.0': {
    label: 'v0.4.0 · Sistemas de seguridad',
    summary: 'Una gran versión de seguridad con Honeypot, Petto Vault, una lectura del prefijo más sólida y configuraciones más seguras.',
    sections: [
      {
        title: 'Sistemas nuevos',
        items: [
          'Se agregó el panel de Honeypot en Components V2 con conteo de activaciones, casos de moderación, registros de sanciones y registros de automod.',
          'Se agregaron los flujos de copias de seguridad de Petto Vault para crear, listar, exportar, restaurar, programar, ver el historial de auditoría y hacer copias de seguridad de protección.',
          'Los números de las copias de seguridad son por servidor, así el staff ve `#1`, `#2`, etc. en lugar de los ID internos de la base de datos.',
        ],
      },
      {
        title: 'Moderación y seguridad',
        items: [
          'Los prefijos personalizados no distinguen mayúsculas de minúsculas y aceptan espacios opcionales antes de un comando.',
          'Los objetivos de moderación aceptan menciones, ID, nombres de usuario exactos y nombres visibles exactos, y rechazan los nombres ambiguos.',
          'La configuración ahora activa AutoMod de forma explícita e informa por separado los fallos parciales de permisos o de canales.',
        ],
      },
      {
        title: 'Experiencia',
        items: [
          'Los paneles de Honeypot y Vault usan ilustraciones de Petto y controles de Components V2.',
          'Los reportes admiten roles urgentes, reportes anónimos, imágenes adjuntas y los nuevos indicadores rojos de reporte.',
          'Se quitó la creación automática de invitaciones para Top.gg para que el flujo oficial de invitación siga siendo privado e intencional.',
        ],
      },
    ],
  },
  'v0.3.0-2': {
    label: 'v0.3.0-2 · Visibilidad operativa',
    summary: 'La versión de visibilidad operativa para los límites de solicitudes de la API REST de Discord y el seguimiento de la versión del bot.',
    sections: [
      {
        title: 'Confiabilidad',
        items: [
          'Se agregó telemetría de los límites de solicitudes de la API REST de Discord con método, ruta depurada, alcance, tiempo de reintento y límite del bucket.',
          'Los eventos repetidos de límite de solicitudes se agrupan durante un minuto para que el registro siga siendo útil sin saturar al staff.',
        ],
      },
      {
        title: 'Notas de la versión',
        items: [
          'Se subió la versión del bot de `0.1.0` a `0.3.0-2` y se documentó el estado de validación.',
        ],
      },
    ],
  },
  'v0.3.0-1': {
    label: 'v0.3.0-1 · Sistema Vanity',
    summary: 'Se presentó el sistema Vanity de Petto y se documentó la primera versión pública de esa entrega.',
    sections: [
      {
        title: 'Vanity',
        items: [
          'Se agregó el sistema Vanity para gestionar y presentar la identidad vanity de un servidor a través de Petto.',
          'La entrada original de la versión y sus notas completas están disponibles en el registro de cambios público.',
        ],
      },
      {
        title: 'Más detalles',
        items: [
          'Consulta la entrada del 13 de agosto de 2026 en el registro de cambios de Petto para ver el contexto completo de la versión.',
        ],
      },
    ],
  },
};
