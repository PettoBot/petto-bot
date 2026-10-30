// As notas de versão do `!version` em português do Brasil: rótulo, resumo e seções de cada versão (src/utils/releases.js guarda o resto).
module.exports = {
  'v0.7.10': {
    label: 'v0.7.10 · Churro: vários prefixos em cada servidor',
    summary: 'Um servidor pode ter vários prefixos de comandos (`!` e `petto` para começar), gerenciados com `!prefix` ou pelo painel, e uma mensagem que só parece um comando fica em silêncio.',
    sections: [
      {
        title: 'Prefixos',
        items: [
          'Até 10 prefixos em cada servidor, o primeiro é o principal. Servidores com o `!` de sempre agora também respondem à palavra `petto` (`petto help`); um servidor com prefixo próprio mantém só esse. Um símbolo se escreve colado (`,help`), uma palavra precisa de um espaço (`petto help`) e o prefixo mais longo vai primeiro.',
          '`!prefix` mostra a lista, `!prefix add <prefixo>`, `!prefix remove <prefixo>` e `!prefix reset` a alteram, e `!prefix <prefixo>` continua deixando só ele. O painel tem uma janela **Gerenciar prefixos** na página Geral.',
          'Seu prefixo próprio (`!myprefix`) e os comandos personalizados funcionam com todos os prefixos do servidor.',
        ],
      },
      {
        title: 'Mais quieto',
        items: [
          '`, es el mejor`, `! hola` e `petto es el mejor` são conversa: um prefixo de símbolo precisa do comando logo depois, e um prefixo de palavra só vale antes de um comando de verdade.',
          'Só o prefixo principal responde "Não conheço esse comando"; os outros prefixos ficam em silêncio.',
        ],
      },
    ],
  },
  'v0.7.9-1': {
    label: 'v0.7.9~1 · Donut: imagens que combinam, !send e RSS corrigidos',
    summary: 'Uma correção do Donut: feeds de imagens que seguem todas as palavras e perguntam o que uma palavra quer dizer, `!send` que acha o seu canal, e feeds RSS que avisam quando um link não é um feed.',
    sections: [
      {
        title: 'Temporizadores',
        items: [
          'Temporizadores: todo dia ou semana em um horário e fuso, numerados 1, 2, 3 em cada servidor, e `!timer run`, `edit`, `message`, `channel`, `pause` e `resume`.',
        ],
      },
      {
        title: 'Feeds de imagens',
        items: [
          'Toda palavra conta: `flor rosa anime` só traz desenhos de flores rosa, nunca uma montanha ou uma foto.',
          'Uma palavra com vários significados (`rosa`: a flor, a cor ou a montanha) é perguntada com um botão para cada um antes de salvar o feed.',
          'O feed e cada imagem dizem o que é buscado, e as imagens são conferidas antes, então nenhuma aparece quebrada.',
        ],
      },
      {
        title: 'Correções',
        items: [
          '`!send` acha o canal no começo ou no fim, por menção, ID, link ou nome, e avisa quando ele não existe.',
          'Um feed RSS que aponta para uma página web não é salvo como um feed vazio: o Petto procura o feed de verdade ou avisa que não há.',
          'A DM de entrada mantém só os botões de link, e um formulário do Petto Code com opções marcadas demais é avisado como um erro.',
          'Um temporizador com um embed salvo V2 volta a publicar (o texto dele não quebra mais a mensagem), e um envio que falha aparece no `!timer view` e no dashboard.',
        ],
      },
    ],
  },
  'v0.7.9': {
    label: 'v0.7.9 · Donut: feeds para todos, !send, botões com ação e buscas novas',
    summary: 'Feeds abertos a todos os servidores, `!send`, botões que fazem coisas, formulários com todas as partes do Discord, buscas novas, `!stats`, um cartão de subida de nível novo e um banco de dados mais leve.',
    sections: [
      {
        title: 'Feeds',
        items: [
          'Os feeds estão abertos a todos os servidores. `!feed add` segue YouTube, Twitch, Kick, Bluesky, Reddit, Steam, GitHub, npm, PyPI, AniList, Pinterest, Spotify, Deezer, Apple Music, Mastodon, Tumblr, Letterboxd, os jogos grátis da Epic e qualquer blog, buscando enquanto você digita. O Premium segue 25 contas de cada plataforma (Free, 5).',
          'Feeds automáticos com ritmo próprio, de cada 15 minutos a uma vez por dia: um único feed de **Animais**, imagens por etiquetas (`15m anime roses`), uma música aleatória dos charts do Deezer, Apple Music e Spotify, Pokémon, Wikipédia e Chess.com.',
          'O YouTube avisa quando um canal publica, então um vídeo sai em segundos, e um Short é publicado como player. Os avisos de live da Kick saem em um minuto, e uma live encerrada mantém o verde com um botão de reprise.',
          'Os feeds de música seguem playlists, charts e os álbuns novos de um país, e as listas do Modrinth seguem os mods, shaders ou plugins mais novos em um único feed. Os avisos têm um botão que os abre (ativado por padrão), e os usuários e cargos das suas palavras são realmente notificados.',
        ],
      },
      {
        title: 'Códigos de embed e Petto Code',
        items: [
          '`!send` envia uma mensagem como o Petto, e `!welcome`, `!leave`, `!boost` e `!dmonjoin` podem usar um código de embed como mensagem.',
          'Botões que fazem coisas, em códigos de embed, designs de Components V2 e no editor do dashboard: dão, tiram ou alternam um cargo, ou mostram um embed salvo (em privado, no canal ou na mensagem direta).',
          'Os formulários do Petto Code (`cmodal`) podem ter todas as partes do Discord: menus, seletores de membros, cargos e canais, envio de arquivos, botões de opção e caixas de seleção.',
          '`!steal` e `!jumbo` encontram os emojis de um cartão de Components V2.',
          '`!jumbo` avisa quando o servidor já tem o emoji ou o sticker.',
        ],
      },
      {
        title: 'Buscas, estatísticas e cartões',
        items: [
          'Buscas em outros serviços: `!minecraft`, `!github`, `!roblox`, `!steam`, `!twitch`, `!youtube`, `!lastfm` e mais, com formas curtas de escrevê-las (`!mu Notch`).',
          '`!stats` analisa um servidor só com números (nunca o que foi escrito), com um painel de privacidade.',
          'Um cartão de subida de nível no estilo do Petto, `!userinfo` e `!serverinfo` redesenhados, `!usercosmetics`, e cartões sem cor exceto para dizer sim ou não.',
          'Mais buscas com uma imagem para músicas, álbuns e artistas, e cartões com divisores, ícones planos e sem títulos grandes.',
        ],
      },
      {
        title: 'Servidores e ajustes',
        items: [
          'O XP de voz não precisa mais de uma segunda pessoa por padrão, e há dois novos limites de XP em `/level rules`.',
          'O que o Petto guardou de um servidor que saiu é apagado 3 dias depois, e os dados pesados podem viver em um segundo banco de dados.',
          'As cópias de avatares do histórico de perfil pesam a metade, as listas públicas de ameaças esquecem o que deixaram de listar, e os contadores não são mais desligados por um canal que ainda existe.',
          'A configuração de um servidor novo nunca é colocada em um canal público. A música continua desligada por enquanto.',
        ],
      },
      {
        title: 'Correções',
        items: [
          'A página de verificação abre no idioma do servidor, `!massunban` para quando o servidor não existe mais, as menções de AFK são apagadas, e a lista de links maliciosos do URLhaus volta a ser lida.',
          'Um título com colchetes aparece como link, dá para seguir quadros do Pinterest com nomes em outros alfabetos, e um canal do YouTube cujo feed responde 404 ou 500 continua funcionando.',
        ],
      },
    ],
  },
  'v0.7.8': {
    label: 'v0.7.8 · Mochi: IA para tickets, canais de mídia, quadros e ferramentas novas',
    summary: 'Um assistente de IA para tickets (beta), tickets ao vivo e transcrições melhores, canais de mídia, um clownboard e quadros com vários emojis, temporizadores com embed, comandos novos (páginas, citações, efeitos de imagem), mais controle sobre as apelações e um dashboard cujos cartões mostram o que o bot envia.',
    sections: [
      {
        title: 'Comandos e ferramentas novas',
        items: [
          '`!pagination` cria uma mensagem com até 25 páginas e botões para passá-las. `!quote` transforma uma mensagem em uma imagem de citação em preto e branco, `!image <efeito>` muda uma imagem (inverter, desfocar, pixelar, deep fry…) e `!hex` encontra a cor principal de uma imagem.',
          '`!imgonly` e `!urlonly` criam canais de mídia: só imagens e vídeos, ou só links dos sites que você escolher. O que não se encaixa é apagado, com um aviso que se apaga sozinho.',
          'Bloquear comandos ficou mais fácil: `!dc suggest #cmds` funciona, com vários comandos e canais de uma vez, uma categoria inteira e `!dc list`. O Petto também pode publicar suas estatísticas no Omniplex.',
        ],
      },
      {
        title: 'Tickets e o assistente de IA',
        items: [
          'Um assistente de IA para tickets (beta): responde a quem abriu o ticket com as instruções e o conhecimento que o dono escreveu, pode ler mensagens do servidor como as regras, conhece os canais e responde com cartões que têm um botão **Falar com uma pessoa**.',
          'Tickets ao vivo no dashboard: os tickets abertos, suas mensagens e as respostas da equipe.',
          'As transcrições parecem o Discord e mostram o Petto como ele aparece no seu servidor, um canal de ticket apagado fecha o ticket, as avaliações são dadas uma única vez, e as mensagens de ticket padrão são cartões mais acolhedores com seus próprios emojis.',
        ],
      },
      {
        title: 'Apelações',
        items: [
          'Softbans podem ser apelados (ative em Apelações → Configurações ou com `!appeals types ban, mute, softban`).',
          'Escolha se as DMs de sanção levam o link de apelação, escreva sua própria linha sobre apelações e peça aos membros que esperem até 720 horas antes de apelar, tudo com `!appeals`.',
        ],
      },
      {
        title: 'Quadros, temporizadores e mensagens',
        items: [
          'Um clownboard (`!clownboard`) se junta ao starboard e ao monkeyboard, e cada quadro pode contar até cinco emojis (`!starboard emoji ⭐ 🍌`).',
          'Os temporizadores podem enviar um embed salvo, apagar a mensagem da vez anterior (`!timer previous`) e se repetir a cada tantos segundos, minutos, horas, dias, semanas, meses ou anos. As autorrespostas também podem apagar a resposta anterior.',
        ],
      },
      {
        title: 'Dashboard',
        items: [
          'Páginas novas de Boards e Canais de mídia, com um cartão para cada quadro ou canal e uma amostra de como fica.',
          'As autorrespostas, os comandos próprios, os temporizadores e as mensagens fixas são cartões com um pequeno chat que mostra o que o bot envia: formatação, emojis, embeds salvos e GIFs.',
          'Um novo visual para o painel de verificação, e configurar a verificação não dá mais timeout em servidores grandes.',
        ],
      },
      {
        title: 'Correções',
        items: [
          '`!dc suggest #cmds` não fazia nada, `/channel clear` falhava, o painel de verificação podia ser publicado duas vezes, e o histórico de perfil agora guarda os avatares antigos para sempre.',
        ],
      },
    ],
  },
  'v0.7.7': {
    label: 'v0.7.7 · Tiramisu: formulários, contadores ao vivo, espanhol e português e comandos de barra',
    summary: 'Formulários com página web própria, contadores ao vivo renovados, o Petto em espanhol e português, um anti-nuke mais forte, comandos de barra para o dia a dia, limites grátis generosos e um painel mais rápido.',
    sections: [
      {
        title: 'Formulários',
        items: [
          'Formulários e candidaturas com `!form`: até 25 perguntas, regras (cargos, idade da conta, esperas, limites, uma data de encerramento), painéis e um cartão de revisão com **Aceitar**, **Recusar** e **Abrir tópico** que dá os cargos e avisa o resultado por DM.',
          'Cada formulário tem sua própria página web (`petto.sbs/form/<id>`) com um link que ninguém consegue adivinhar: os membros entram com o Discord e respondem lá. A página usa a cor, o banner e o fundo do formulário, e o link mostra uma prévia que você pode personalizar.',
          'As perguntas podem ter uma descrição e uma imagem, decidir uma resposta fecha o tópico dela, e o painel tem uma página de Formulários com as respostas e os painéis.',
        ],
      },
      {
        title: 'Contadores e comunidade',
        items: [
          'Contadores ao vivo, renovados: muito mais tipos (online, um cargo, impulsos, uma meta de membros, um relógio, mensagens de hoje…), nomes com `{count}`, pacotes com `!counter setup`, contadores no nome de uma categoria ou no tópico de um canal, e anúncios de metas com `!counter announce`.',
          'As renomeações respeitam o limite do Discord (duas a cada 10 minutos) e são espalhadas no tempo, e o painel tem uma página de Contadores com prévias, arrastar para ordenar e renomear ali mesmo.',
        ],
      },
      {
        title: 'Moderação',
        items: [
          '70 comandos, subcomandos e atalhos de moderação novos: apelidos forçados, `!stripstaff`, silenciamentos de imagens e reações, `!raid clean`, cargos temporários, `!restrictcommand`, mais filtros do `!purge` e mais.',
          'Anti-nuke: cinco proteções novas (mudanças de cargos e canais, menções em massa, spam de webhooks, prune), modo pânico, admins de confiança, só o dono e uma DM ao dono quando uma proteção age.',
          'A moderação em massa deixa em paz os membros que você não pode moderar, `!lock` tranca o canal onde você está, e o Honeypot pode ser configurado pelo painel.',
        ],
      },
      {
        title: 'Idiomas e comandos de barra',
        items: [
          'O Petto fala inglês, espanhol e português do Brasil: respostas, cartões, painéis, DMs e logs seguem o idioma do servidor. Mude com `!language`.',
          '21 comandos do dia a dia também funcionam como comandos de barra (`/help`, `/ping`, `/userinfo`, `/warn`, `/ban`, `/purge`, `/ticket`…) e o `/help` mostra as duas formas. O `/embed` entra também, e os comandos de barra não aparecem mais duas vezes.',
          'Mais eventos são registrados nas categorias que você já tem, um cargo pode ser ignorado nos logs, e o `!serverinfo` aceita o ID de outro servidor.',
        ],
      },
      {
        title: 'Painel e Premium',
        items: [
          'O grátis é generoso e o Premium é mais ou menos o dobro: 125 comandos personalizados (250 com Premium), 75 respostas automáticas (150), 25 contadores (50) e mais. Recompensas de nível e logs não têm limite, e 15 fontes de cartões são grátis.',
          'Acesso ao painel por cargo, páginas de Contadores e Formulários mais rápidas, um botão de Sincronizar, uma página de Honeypot, e as páginas de Permissões e Cobertura de comandos refeitas.',
          'Restaurar um backup pergunta antes, mostra o progresso, pode ser parado e pode trazer só algumas partes (os backups ainda estão em manutenção).',
        ],
      },
      {
        title: 'Correções',
        items: [
          'Os botões do VoiceMaster não falham mais quando o bot está lento, nomes de regras do Vanity com espaços funcionam, a página de Formulários do painel volta a carregar, e os logs usam o nome e a imagem que o servidor deu ao Petto.',
        ],
      },
    ],
  },
  'v0.7.6': {
    label: 'v0.7.6 · Macaron: apelações, moderação mais forte e mais ferramentas para a comunidade',
    summary: 'Um sistema completo de apelações com página própria, moderação mais forte (antigolpe, lockdown, anti-nuke por proteção), tickets melhores, sugestões, contagem e confissões, e um visual novo para o painel.',
    sections: [
      {
        title: 'Apelações',
        items: [
          'Uma página para cada servidor (`petto.sbs/appeal/<ID ou seu nome>`): os membros entram com o Discord, veem suas punições, preenchem os formulários que você cria e acompanham a apelação. Em inglês, espanhol e português.',
          'A equipe recebe cada apelação com **Aceitar**, **Recusar** e **Responder**. Aceitar remove o banimento, o castigo e as sanções ativas e pode criar um convite de uso único (e diz qual). Recusar pode bloquear uma nova apelação por um dia, uma semana, um mês ou para sempre.',
          'Seu próprio nome de link (`petto.sbs/appeal/amor`), com nomes reservados e ofensivos bloqueados, um pedido à equipe do Petto quando um nome já está em uso (de 1 a 72 horas), 30 dias de reserva quando você o troca, e os nomes que ninguém usa são liberados. As imagens podem ser enviadas do dispositivo.',
          '`!appeals` mostra o link, e a DM da sanção aponta para ele. Tudo começa desativado.',
        ],
      },
      {
        title: 'Moderação',
        items: [
          'Antigolpe (o golpe do MrBeast, por comportamento, palavras e contas novas), `!lockdown` para raids, anti-nuke com limites, listas de permissões e restauração para cada proteção, e modelos de AutoMod (regras do Discord e filtros do Petto) com strikes e exceções.',
          'Remova sanções pelo painel, pesquise casos, adicione provas e veja estatísticas. O VoiceMaster pode copiar as permissões da categoria, com cargos de acesso, privacidade e permissões do dono (tudo desativado por padrão).',
        ],
      },
      {
        title: 'Comunidade',
        items: [
          'Sugestões (`!suggest`, votos, tópicos e respostas da equipe), Contagem (salvamentos, recordes, cargos e um ranking) e Confissões (anônimas, revisadas pela equipe, com respostas).',
          'Tickets: painéis com cor, imagem e rodapé, um limite por membro, horário da equipe, lembretes, respostas rápidas, transcrições como link, como arquivo ou ambos, e `!ticket panel edit`.',
          'A verificação pode ser configurada pelo painel com um só clique. Os cartões de imagem vão em qualquer lugar com `{imgcard:name}` (40 fontes).',
        ],
      },
      {
        title: 'Visual e painel',
        items: [
          'As republicações do starboard e do monkeyboard ficam iguais à mensagem original, com um botão **Mensagem original**; `!ping` e `!userinfo` têm cartões novos, e as mensagens novas são cartões aconchegantes de Components V2.',
          'O painel tem fontes novas, cores mais suaves, um seletor de cor mais fácil de arrastar, uma barra de salvar menor e uma página de status de verdade. O site tem uma página de marca (`/brand`).',
        ],
      },
      {
        title: 'Correções',
        items: [
          'As respostas funcionam sem a permissão Ver histórico de mensagens, uma permissão que falta é explicada em palavras simples, `!prefix set ?` funciona e os alertas de lançamentos mostram só o que mudou.',
        ],
      },
    ],
  },
  'v0.7.5': {
    label: 'v0.7.5 · Waffle: aniversários, verificação em um canal e um painel mais rápido',
    summary: 'Aniversários, histórico de perfil, um teste de letras para a verificação (também dentro do Discord e em um canal), o monkeyboard, um ranking público, níveis com sorteios, alertas de lançamentos e um painel muito mais rápido.',
    sections: [
      {
        title: 'Novidades',
        items: [
          'Aniversários: `!birthday set`, `view`, `upcoming`, `remove` e `config`. O Petto comemora com uma mensagem no horário que você escolher e, se quiser, com um cargo para o dia.',
          'Histórico de perfil: `!avatars` mostra todos os avatares em uma só imagem, `!names` e `!nicknames` listam o resto, `!clear` apaga o seu e uma página de Histórico no painel tem busca por ID.',
          'Verificação: os membros podem digitar as letras de uma imagem (na página ou dentro do Discord, sem link) e o servidor pode publicar um painel de verificação em um canal (`!verify channel`, ou pelo painel).',
          'Monkeyboard 🐒: o oposto do starboard, com configurações próprias e variáveis `{monkey.*}`.',
          'Ranking público: `petto.sbs/lb/<nome>`, em três idiomas, desativado até o servidor ativá-lo.',
        ],
      },
      {
        title: 'Níveis e sorteios',
        items: [
          'O aviso de subida de nível responde à mensagem, se apaga sozinho quando você quiser, a voz tem seus próprios cargos de recompensa, os multiplicadores funcionam por categoria e você escolhe quem ganha XP.',
          'Os sorteios podem exigir um nível e dar participações extras por nível. Um novo cartão de rank padrão, e `!level manage sync`.',
        ],
      },
      {
        title: 'Lançamentos e missões',
        items: [
          'Alertas de lançamentos: os experimentos do Discord são anunciados em um canal com `!rollouts`, com uma fila, designs salvos e uma página no painel.',
          'A lista compacta de missões é a fonte principal, e os cartões de missão padrão não têm mais a linha de créditos.',
        ],
      },
      {
        title: 'Velocidade e painel',
        items: [
          'O painel carrega de 3 a 16 vezes mais rápido, as configurações mudam na hora e o Petto faz muito menos requisições ao Discord.',
          'Mais mensagens podem ter nome e imagem próprios (`!sender`), e o painel de Níveis tem um único Salvar.',
        ],
      },
    ],
  },
  'v0.7.4': {
    label: 'v0.7.4 · Brownie: Vanity no Petto, estatísticas e hardban',
    summary: 'Cargos de Vanity e de Server Tag dentro do Petto, um visual novo para as sanções, um hardban de verdade, `!summary` com sanções, entradas, saídas e convites, um rastreador de convites mais completo, um prefixo só seu e o Petto funcionando em GMT-5 (Colômbia).',
    sections: [
      {
        title: 'Vanity e Server Tag',
        items: [
          '`!vanity`, `!guildtag` e `!identity` (nomes curtos `!vy` e `!tag`) dão ou tiram um cargo conforme o status personalizado, o nome ou o Server Tag de um membro, com uma mensagem de agradecimento, um registro e cargos persistentes. Os dados do antigo bot Vanity podem ser importados.',
          'Cargos por reação: botões com cor, linha e só um emoji, e `!reactionrole add new` publica um embed salvo com o botão do cargo.',
        ],
      },
      {
        title: 'Moderação',
        items: [
          'Um novo visual padrão para as sanções (resposta, registro e DM ao membro) em Components V2 com ícones novos, e mais tipos de mensagem para `!sender`.',
          '`!hardban` é de verdade: só o dono do servidor e os administradores do antinuke podem desbanir, e o Petto refaz o banimento se outra pessoa o remover. Um hackban é um banimento por ID.',
          'Expulsar ou banir um bot administrador funciona quando o Petto está acima dele.',
        ],
      },
      {
        title: 'Estatísticas',
        items: [
          '`!summary` por `messages`, `voice`, `joins`, `leaves`, `invites` ou `sanctions`, com o horário mais ativo, uma imagem nova e a página de Estatísticas no painel.',
          'O rastreador de convites conta convites falsos e bônus, dá cargos ao atingir um número de convites, tem variáveis `{inviter}` para a mensagem de boas-vindas e um ranking por semana ou por mês.',
        ],
      },
      {
        title: 'Seu próprio prefixo e horário',
        items: [
          '`!myprefix` dá aos boosters do servidor de suporte, aos usuários Premium, aos parceiros e à equipe do Petto um prefixo próprio em todos os servidores.',
          'O Petto funciona em GMT-5 (Colômbia) e avisa: dias, semanas, horas e os horários que você escreve.',
        ],
      },
    ],
  },
  'v0.7.3': {
    label: 'v0.7.3 · Flan: tickets mais fáceis, cartões de configuração e votos',
    summary: 'Uma configuração guiada para os tickets, um cartão `!<comando>config` para cada comando, votos do top.gg com um cargo para quem vota, e o Petto online com o ícone de celular.',
    sections: [
      {
        title: 'Tickets',
        items: [
          '`!ticket setup` é uma configuração guiada: escolha o canal, os cargos de suporte e um canal de registro, escreva o título e o texto, adicione os tipos de ticket e publique tudo com um só clique.',
          'Os formulários de ticket são montados com botões (`!ticket form create name:<nome>`), sem precisar digitar a sintaxe dos campos.',
          'Cada tipo de ticket tem seu próprio texto de boas-vindas, e o nome do canal aceita `{userid}` e `{category}`.',
          'Ferramentas da equipe dentro de um ticket: `!ticket priority`, `!ticket transfer`, `!ticket note` e `!ticket request-close`.',
        ],
      },
      {
        title: 'Cartões de configuração',
        items: [
          'Cada módulo tem um cartão `!<módulo>config` com o que o servidor tem configurado agora e todos os comandos do módulo: `!brconfig`, `!welcomeconfig`, `!levelconfig`, `!ticketconfig`, `!automodconfig`, `!logsconfig` e mais 36.',
          'Todos os outros comandos ganham seu próprio cartão quando o Petto inicia (`!banconfig`, `!purgeconfig`...), e um comando com nome curto também tem seu cartão com esse nome (`!arconfig`).',
          '`!cmdconfig` mostra a configuração recomendada do Petto com comandos prontos para copiar.',
        ],
      },
      {
        title: 'Votos',
        items: [
          'O Petto recebe os votos do top.gg: cada um é contado uma só vez, agradecido em um canal com um cartão, e dá a quem votou um cargo que fica.',
          '`!votes` mostra os votos do Petto e de um membro, e `!votes top` os membros que mais votaram.',
        ],
      },
      {
        title: 'Sorteios e status',
        items: [
          'Um sorteio em andamento pode ser alterado pelo painel (prêmio, vencedores e fim), e `!giveaway edit` lê um prêmio com várias palavras sem aspas.',
          'O Petto fica online com o ícone de celular por padrão, e a equipe do Petto pode trocar a bolinha com `!botstatus`.',
          'A mudança de várias permissões de um canal aparece em uma só mensagem de registro.',
        ],
      },
      {
        title: 'Correções',
        items: [
          'As respostas de parceria agora mencionam de verdade o responsável pela parceria.',
          'As mensagens fixadas e desafixadas voltam a ser registradas (o registro falhava com um erro toda vez).',
        ],
      },
    ],
  },
  'v0.7.2': {
    label: 'v0.7.2 · Churro: registros, códigos de embed e tópicos de missões',
    summary: 'Um tópico e uma mensagem de "como completar" para os alertas de missões, códigos de embed nas respostas automáticas e no `!editembed`, e muito mais eventos nos registros do servidor.',
    sections: [
      {
        title: 'Alertas de missões',
        items: [
          'Mensagens com nome e imagem próprios (`!sender`): alertas de missões e mensagens de boas-vindas, saída, boost e sanção podem sair por um webhook que parece outra pessoa.',
          'Uma resposta de botão pode apagar a mensagem em que está, reagir a ela ou enviar a resposta em outro canal.',
          'Um embed salvo diferente (normal ou V2) para cada tipo de recompensa: Orbs, decorações, Nitro, códigos e itens de jogos, para o alerta e para o método (`!quests type`).',
          'Muito mais variáveis `{quest.*}`: todos os estilos de timestamp para o início e o fim (`{quest.starts.relative}`, `{quest.expires.full}`...) e os mesmos momentos por extenso para títulos e rodapés (`{quest.starts_ago}`, `{quest.expires_in}`, `{quest.time_left}`).',
          '`!quests thread on` abre um tópico embaixo de cada alerta, com nome próprio, uma menção opcional do cargo de alertas dentro dele e o tempo até ele se esconder.',
          'O método das missões: uma mensagem que explica como completar as missões, escrita uma vez (um texto com as variáveis `{quest.*}` ou um embed salvo com vários textos e imagens) e enviada no tópico ou em um canal, com ou sem menção. `!quests method send` a envia agora, e o painel tem as mesmas configurações.',
        ],
      },
      {
        title: 'Códigos de embed',
        items: [
          'Uma resposta automática pode responder com um código de embed, com opções como `--reply`, `--ping`, `--delete`, `--strict` e `--mode`.',
          '`!editembed <link da mensagem> <código>` altera uma mensagem que o Petto já enviou.',
        ],
      },
      {
        title: 'Registros do servidor',
        items: [
          'Novas categorias: `webhooks`, `threads`, `integrations` e `commands`. Figurinhas, sons da soundboard, eventos agendados, regras do AutoMod, mensagens fixadas, palcos, castigos, boosts, expulsões e muitas configurações do servidor também são registrados, com quem fez.',
          'No registro de canais, o cargo @everyone aparece escrito certo e uma mudança de permissões diz quem a fez.',
        ],
      },
      {
        title: 'Correções',
        items: [
          'Um nome que já está em uso no painel não é mais informado como um erro do Petto.',
          'Um código de embed com um bloco que perdeu a chave de fechamento termina esse bloco onde o próximo começa.',
          'O total de membros nas mensagens de status não perde mais, por um momento, os membros de um servidor inteiro.',
        ],
      },
    ],
  },
  'v0.7.1-2': {
    label: 'v0.7.1~2 · Boba: sorteios pelo painel',
    summary: 'Uma versão pequena para o painel: inicie sorteios, encerre-os e sorteie os vencedores pela web, e uma correção para os botões de página das listas.',
    sections: [
      {
        title: 'Painel',
        items: [
          'Os sorteios podem ser iniciados pelo painel, encerrados na hora e sorteados de novo, com o mesmo motor do `!giveaway`.',
        ],
      },
      {
        title: 'Correções',
        items: [
          'Os botões de página de `!roles`, `!emojis` e das outras listas não falham mais em algumas páginas.',
        ],
      },
    ],
  },
  'v0.7.1-1': {
    label: 'v0.7.1~1 · Mochi: listas, horários e equipe',
    summary: 'Uma versão de melhorias: listas longas com botões, novos comandos de informação, bloqueio de comandos melhor, tempos escritos por extenso e uma equipe que você pode editar pelo painel.',
    sections: [
      {
        title: 'Listas com botões',
        items: [
          '`!roles` mostra uma página por vez com botões e um menu para ordenar (mais membros, mais novos, nome) ou filtrar (com cor, vazios).',
          'Novos: `!emojis`, `!channels`, `!boosters` e `!inrole <cargo>` (também `!members`), todos com páginas e um menu para filtrar. Só quem pediu pode virar as páginas.',
        ],
      },
      {
        title: 'Bloqueio de comandos',
        items: [
          '`!disablecommand disable roles emojis channels` bloqueia vários comandos de uma vez, `enable all` apaga todas as regras e `list` tem páginas. `disablecommand` e `help` não podem ser bloqueados, então ninguém fica trancado do lado de fora.',
          'Um comando bloqueado também fica bloqueado como comando de barra, não só com o prefixo.',
        ],
      },
      {
        title: 'Horários',
        items: [
          'Todo comando que recebe uma duração entende `3d 4h`, `1 hour 30 minutes`, `1h30m` e espanhol (`2 horas`). `!remind` também aceita um momento: `tomorrow 8pm`, `2026-10-12 18:00`.',
          'Novas variáveis: `{timestamp}`, `{timestamp.relative}`, `{timestamp.full_long}` e `{timestamp:tomorrow 8pm|R}` para qualquer momento escrito por extenso.',
        ],
      },
      {
        title: 'Outros',
        items: [
          'A página pública de estatísticas mostra o top 5 de servidores.',
          'A página da equipe pode ser editada pelo dono no painel (até 100 pessoas por cargo).',
          'Toda versão tem um nome. Esta é a Mochi.',
        ],
      },
    ],
  },
  'v0.7.1': {
    label: 'v0.7.1 · Parcerias, painéis e mais',
    summary: 'Ferramentas para comunidades: parcerias com ranking, uploads, pedidos, avaliações e perfis, botões e painéis sem código, embeds salvos para mensagens fixas e alertas de missões com quatro fontes.',
    sections: [
      {
        title: 'Parcerias',
        items: [
          'Um Partner Manager publica o convite de outro servidor em um canal de parcerias e, se ele cumprir os requisitos (mínimo de membros, idade mínima, um tempo de espera com o mesmo servidor, uma lista de bloqueio), a parceria é contada e respondida.',
          '`!partnerconfig` define os canais (Grátis 6, Premium 25), o cargo de gerente, os requisitos e 8 respostas, cada uma com texto ou um embed salvo. `!partner stats` e `!partner leaderboard` mostram hoje, esta semana e todo o período.',
        ],
      },
      {
        title: 'Botões e painéis, sem código',
        items: [
          '`!responder add` cria um botão (ou uma opção de um menu) que responde em privado e dá, tira ou alterna cargos, com um cargo exigido opcional.',
          '`!panel` os mostra como botões ou como um único menu, publica a mensagem e a atualiza no mesmo lugar. Servidores grátis podem ter 20 respostas de botão e 10 painéis; os Premium, 250 e 50.',
          'As mensagens fixas podem ser um dos seus embeds salvos (também um design V2) e podem ser editadas no painel.',
        ],
      },
      {
        title: 'Uploads, pedidos e avaliações',
        items: [
          'Uploads: os arquivos enviados nos canais que você escolher são contados por membro, com um cargo e boas-vindas no primeiro (`!uploadconfig`, `!uploads`). Grátis 20 canais, Premium 100.',
          'Pedidos: `!request make` publica um cartão com os botões Assumir, Concluir, Liberar e Cancelar para a equipe. Com Premium, um pedido assumido volta a ficar aberto se não for concluído a tempo.',
          'Avaliações e perfis: `!review give @member 4` avalia um membro de 1 a 5 estrelas e `!profile` mostra a avaliação com os uploads, os pedidos e as parcerias.',
        ],
      },
      {
        title: 'Painel e melhorias',
        items: [
          'Novas páginas do painel: Parcerias, Botões e painéis, Uploads, Pedidos, e Avaliações e perfis.',
          'Os alertas de missões leem quatro fontes (primeiro a lista curta do repositório discord-api-tracker), então uma nova missão é vista minutos depois de começar, mesmo quando a API da comunidade está fora do ar.',
          'O Omniplex entra na página de Parcerias do site.',
        ],
      },
      {
        title: 'Correções',
        items: [
          'Uma missão publicada antes de começar é anunciada quando começa, e não horas depois.',
        ],
      },
    ],
  },
  'v0.7.0': {
    label: 'v0.7.0 · Petto Code, missões e Embeds V2',
    summary: 'Uma versão grande: comandos personalizados em código para todos os servidores (Grátis 50, Premium 100), com botões, formulários e reações, um editor no painel, alertas de missões, embeds de Components V2 e estatísticas globais.',
    sections: [
      {
        title: 'Petto Code',
        items: [
          'Agora os comandos personalizados podem ser escritos em **Petto Code**, uma pequena linguagem de texto e ações `{{ }}`: variáveis, `if`, `range`, cerca de 70 funções, embeds, menções e tempo. `!customcommand code`, `codeshow`, `codetest` (executa sem enviar nada), `template`, `export` e `import`.',
          'Botões e menus que executam código (`cbutton`, `cselect`), formulários que aparecem na tela (`cmodal`, `ctext`, `showModal`) e reações que executam código (`"reactions"` em `complexMessage`, `.Trigger "reaction"`, `removeReaction`). Um só comando contém o sistema inteiro.',
          'Os comandos podem guardar informações: contadores, pontos, rankings, tempos de espera e listas, por servidor ou por membro (`dbSet`, `dbIncr`, `dbTop`...), até no próprio banco de dados.',
          'Os comandos podem ser acionados por um prefixo próprio ou por palavras (`!customcommand trigger`): `?hello`, `hey bot`, `good morning`.',
          'Os embeds levam o avatar ao lado do autor (`authorIcon`), e há modelos prontos: votação, pedido, assumir pedido, sugestão, denúncia, perfil, botão de cargo e cargo por reação.',
          'Para todo servidor que pode gerenciar comandos: até 50 comandos personalizados nos servidores grátis e 100 nos Premium.',
          'Tudo roda com limites, e o que o código pede é verificado com as permissões de quem o escreveu. Documentação: https://code.petto.sbs',
        ],
      },
      {
        title: 'Alertas de missões',
        items: [
          '`!quests`: o Petto publica em um canal quando o Discord tem uma nova missão, com a imagem, a recompensa (Orbs ou a decoração de avatar), as tarefas, as plataformas, as datas e os limites de país ou de +18.',
          'Adicione um cargo para mencionar, filtre por recompensa (`orbs`, `decoration`, `code`, `ingame`, `nitro`) ou por tarefa, e receba um aviso horas antes de acabar. `!quests list` é para todos.',
        ],
      },
      {
        title: 'Embeds V2',
        items: [
          'Um novo **editor V2** em Embeds: contêineres, texto, imagens, seções, divisores e botões de link. Use os designs nos alertas de missões, nas sanções, no starboard, na verificação e nas mensagens de bump, e com `!embed send` e `!embed preview`.',
          'Os designs V2 são compartilhados com o Embed Builder por um código `p2.`, e usam as variáveis de sempre (e `{quest.*}`).',
        ],
      },
      {
        title: 'Estatísticas globais',
        items: [
          'Uma página pública de **Estatísticas** (`petto.sbs/stats`): mensagens, horas de voz e reações de todos os servidores, contadores em movimento, um top 3 de servidores e um top 10 de membros.',
          'Cada servidor pode se esconder pelo painel (Geral) e cada membro com `!globalranking off`.',
        ],
      },
      {
        title: 'Painel e melhorias',
        items: [
          'Novas páginas do painel: **Comandos em código** (um editor de verdade que confere seu código enquanto você escreve, com modelos, funções e um botão de teste) e **Missões**.',
          'O menu agrupa as seções (Moderação, Segurança, Níveis, Automação, Comunidade...) e no celular é uma gaveta lateral.',
          'A página de comandos personalizados mostra o prefixo do seu servidor, e o site diz que o Petto funciona com prefixo, não com comandos de barra.',
          '`!help` leva ao painel, ao servidor de suporte e à documentação do Petto Code.',
        ],
      },
      {
        title: 'Correções',
        items: [
          'O túnel do Cloudflare não escreve mais o token nos registros.',
          'Corrigimos erros do painel que pediam dados que não existem, e os textos do Premium que pareciam indisponíveis.',
          'A contagem de servidores da página inicial e a da página de status agora batem.',
        ],
      },
    ],
  },
  'v0.6.1': {
    label: 'v0.6.1 · Níveis, cartões e mensagens personalizadas',
    summary: 'Uma versão grande: um novo sistema de níveis com cartões de rank, cartões de imagem para todas as mensagens, embeds salvos para sanções, starboard, sorteios e mais, além de prisão, purge, histórico, gestão de denúncias e novos comandos de diversão.',
    sections: [
      {
        title: 'Níveis',
        items: [
          '`!rank` responde com um cartão de rank, com o embed melhorado ou com os dois (`!level rank-style`). O embed mostra a posição, o XP para o próximo nível, as mensagens, o tempo em voz, a sequência e a semana.',
          'Regras antiabuso (`!level rules`): tamanho mínimo, links e menções, texto repetido e mínimos de voz.',
          'Eventos de XP com multiplicador (`!level event`), bônus diário e sequências, e `!top 1 messages week` ou `!top 1 messages month`.',
        ],
      },
      {
        title: 'Cartões de imagem e embeds',
        items: [
          'Cartões de imagem: imagens desenhadas para boas-vindas, saída, boost, tickets, sorteios, subida de nível e mais. O editor básico é grátis; o editor de camadas é Premium.',
          '`!embed create name code:` monta um embed completo (até 10) a partir de um código e o salva na hora.',
          'Agora os embeds salvos podem substituir a mensagem padrão das sanções (DM, resposta e registro, por tipo, com `!sanctionmessage`), do starboard, dos sorteios, das DMs de verificação e dos bumps. Novas variáveis: `{case.*}`, `{star.*}`, `{verify.link}`, `{nextBump}`.',
        ],
      },
      {
        title: 'Moderação e denúncias',
        items: [
          'Prisão (`!jail`, `!unjail`): o membro perde seus cargos e só vê o canal da prisão. Prisões com tempo terminam sozinhas e os cargos voltam na soltura. Também pode ser usada em `warn escalation`.',
          '`!purge` apaga mensagens recentes por membro, tipo ou texto, e `!history` mostra todo o histórico de moderação de um membro em um cartão.',
          'As denúncias são numeradas, com botões Assumir, Resolver, Descartar e Reabrir, categorias, tempo de espera, limite diário, bloqueio, um motivo ao fechar, um tópico que acompanha a denúncia e um painel de configurações.',
          'Menus Report User em usuários e mensagens.',
        ],
      },
      {
        title: 'Utilidades e diversão',
        items: [
          '`!roll` (`2d6+3`, `4d6kh3`), `!choose` e a categoria Diversão: `!8ball`, `!ship` (com imagem) e `!rps`.',
          'Personalizar (Premium): dê ao Petto um estilo de nome no seu servidor, com degradê, neon ou brilho, pelo painel.',
        ],
      },
      {
        title: 'Melhorias',
        items: [
          '`!setup` abre um painel de status na hora, com uma configuração rápida já preenchida.',
          'Comandos de informação (`serverinfo`, `userinfo`, `botinfo`, `roleinfo`...) e `!case list` redesenhados como cartões. As respostas de roleplay respondem à mensagem original. `!remind 2h text` funciona sem `add`.',
        ],
      },
      {
        title: 'Correções',
        items: [
          'Os contadores ao vivo voltaram a atualizar, e os contadores de usuários, bots e boosters contam a lista inteira de membros.',
          'Comandos de bots não acionam mais as respostas automáticas, e as dicas mostram o prefixo que foi digitado.',
        ],
      },
    ],
  },
  'v0.6.0': {
    label: 'v0.6.0 · Painel, embeds e Petto Vanity',
    summary: 'Uma versão focada no painel: ele fala espanhol e português do Brasil, mostra prévias das mensagens como o Discord, se conecta ao Embed Builder e agora também gerencia o bot separado Petto Vanity.',
    sections: [
      {
        title: 'Painel',
        items: [
          'Todo o painel está traduzido para espanhol e português do Brasil, com `/es/dash` e `/pt-br/dash` e um menu de idioma que lembra a escolha.',
          'As prévias das mensagens ficam iguais às do Embed Builder, com markdown, links, menções, emojis e timestamps, e mostram o nome e o avatar do próprio bot, inclusive um personalizado, também no join gate.',
          'As listas de servidores ficam em cache por pouco tempo e o Premium é lido uma vez por requisição, então as páginas carregam mais rápido.',
          'Corrigimos o painel que não rolava em telas pequenas no site compilado, e corrigimos os travamentos da prévia.',
        ],
      },
      {
        title: 'Embeds e variáveis',
        items: [
          'As mensagens do painel podem ser enviadas ao Embed Builder com um código de compartilhamento, as mensagens enviadas por ele podem ser abertas no painel, e uma mensagem de teste pode ser enviada a um canal.',
          'Adicionamos um registro das variáveis de embed e `GET /api/dashboard/variables`, para o painel ler a lista direto do bot. Agora o `npm run check` falha quando o registro e o motor de variáveis não batem.',
          'Corrigimos uma falha quando um comando de embed era usado sem nome de embed.',
        ],
      },
      {
        title: 'Petto Vanity',
        items: [
          'O bot separado Petto Vanity pode ser gerenciado pelo painel: regras de vanity, regras de Server Tag, mensagens de agradecimento e o registro da equipe.',
          'O Petto Vanity informa seu estado, servidores, latência e tempo online, com uma página de status pública no site do Petto.',
        ],
      },
    ],
  },
  'v0.5.1-46': {
    label: 'v0.5.1-46 · Confiabilidade, segurança e automação',
    summary: 'Uma versão de confiabilidade e segurança com detecção persistente de links maliciosos, operações de servidor mais robustas, casos de moderação independentes e comandos personalizados que entendem argumentos.',
    sections: [
      {
        title: 'Confiabilidade e integração',
        items: [
          'Corrigimos os contadores de webhooks e o tratamento de menções ao enviar notificações por webhook.',
          'Corrigimos o tratamento de interações do VoiceMaster e melhoramos a resistência a timeouts temporários do gateway do PostgreSQL.',
          'Adicionamos novas tentativas seguras para leituras do banco de dados com falhas temporárias e dados em cache como reserva para configurações conhecidas.',
          'Reduzimos a carga no banco de dados causada por mensagens fixas e respostas automáticas, evitando novas tentativas inseguras ao gravar XP.',
          'Corrigimos substituições de permissões em excesso e melhoramos a criação dos canais de integração em servidores grandes.',
        ],
      },
      {
        title: 'AutoMod e links maliciosos',
        items: [
          'Adicionamos a detecção persistente de URLs maliciosas para os links descobertos pelo `!am`.',
          'URLs maliciosas conhecidas são reaproveitadas do armazenamento, em vez de serem verificadas com um serviço externo a cada mensagem.',
          'Links maliciosos conhecidos são removidos automaticamente, e a equipe de desenvolvimento é alertada quando uma URL nova é detectada.',
        ],
      },
      {
        title: 'Operações de servidor e conformidade',
        items: [
          'Adicionamos o comando da equipe do Petto `guildsend`, além do diagnóstico e do monitoramento de conformidade automáticos dos servidores.',
          'Adicionamos a detecção de lojas/vendas/conformidade, alertas de revisão para a equipe do Petto, verificações manuais, controles de confirmação de saída e avisos mais claros aos servidores.',
        ],
      },
      {
        title: 'Casos de moderação',
        items: [
          'Os números de caso agora são independentes em cada servidor e guardados com contadores persistentes por servidor.',
          'Todas as sanções de moderação e as ações automáticas compartilham uma sequência por servidor, com uma migração para o histórico de casos existente.',
          '`case list` não exige mais um usuário e agora permite filtrar por usuário de forma opcional, com paginação.',
        ],
      },
      {
        title: 'Argumentos de comandos personalizados',
        items: [
          'Adicionamos `{args}`, `{arg1}` até `{arg10}`, `{args_from:N}`, `{arg_count}`, `{command_name}` e `{prefix}`.',
          'Texto entre aspas fica junto como um só argumento, os modelos de embeds salvos aceitam as novas variáveis, e os argumentos escritos pelos usuários não podem criar menções em massa.',
          'Os comandos personalizados agora podem usar modelos só de embed, editar preserva os campos que não mudaram, e o editor de comandos inclui uma referência de variáveis.',
        ],
      },
    ],
  },
  'v0.5.0': {
    label: 'v0.5.0 · Cargos conectados e atividade',
    summary: 'Uma versão conectada para cargos vinculados, sincronização instantânea do prefixo, resumos de atividade mais completos e roleplay social.',
    sections: [
      {
        title: 'Cargos conectados e painel',
        items: [
          'Adicionamos o fluxo de conexão de cargos vinculados para que os membros conectem o Petto ao Discord e recebam o cargo Petto Verified nos servidores participantes.',
          'O site salva o prefixo do servidor pela API privada do bot e avisa o bot na hora.',
          'O bot atualiza o cache de prefixos na hora, e redefinir o prefixo volta a sincronizar o prefixo `!` padrão.',
          'Os apelidos no servidor continuam grátis; o Premium continua cobrindo os outros campos de personalização do perfil no servidor.',
        ],
      },
      {
        title: 'Atividade e roleplay',
        items: [
          'Adicionamos o gráfico de atividade de `!summary`, `!weekly` e `!digest` com o estilo escuro do Overview, séries diárias verdes/laranjas e uma alternativa só em texto quando o Canvas não está disponível.',
          'Adicionamos os controles Responder/Recusar aos comandos de roleplay com alvo. O membro mencionado pode responder uma vez com a mesma ação ou recusar com um tapa.',
          'Adicionamos contadores de roleplay persistentes por servidor, por usuário e por ação, e novos comandos: `!hi`, `!bye`, `!yes`, `!no`, `!laugh`, `!sad` e `!angry`.',
        ],
      },
      {
        title: 'Correções e segurança',
        items: [
          'Corrigimos o tratamento do `.catch()` da tarefa de estatísticas e atualizamos as mensagens de configuração e remoção para deixar a configuração do servidor mais clara.',
          'Adicionamos limite de requisições à API interna de prefixos para reduzir abusos e atender às verificações de segurança.',
          'Mudamos o texto sobre quem pode ser booster para usar o termo `server booster` do Discord.',
        ],
      },
    ],
  },
  'v0.4.1': {
    label: 'v0.4.1 · Denúncias e confiabilidade',
    summary: 'Uma atualização focada em denúncias, mudanças de servidor Premium, detalhes de perfil e registros operacionais.',
    sections: [
      {
        title: 'Denúncias',
        items: [
          'Melhoramos o sistema de denúncias e adicionamos o formulário de configuração nativo `/report config`.',
          'Adicionamos o seletor do cargo de moderador urgente e conectamos as novas configurações de denúncias às Community Configs.',
          'Os cartões de denúncia mantêm o link, o texto e as imagens anexadas da mensagem denunciada quando disponíveis.',
        ],
      },
      {
        title: 'Correções e confiabilidade',
        items: [
          'Corrigimos o problema do Premium que podia impedir a troca do servidor ativo ou esconder uma atribuição de Premium existente.',
          'Melhoramos o cache do registro de auditoria, as novas tentativas, os dados antigos de reserva e o tratamento de mensagens parciais.',
          'Centralizamos o tratamento de erros dos eventos para que um handler com falha não desapareça em silêncio.',
        ],
      },
      {
        title: 'Ferramentas de perfil',
        items: [
          'Melhoramos `!ui` e `!userinfo` com dados de perfil atualizados, banners, avatares, cargos, insígnias, timestamps e links de perfil.',
          'Adicionamos uma detecção melhor de mudanças de imagem e mais informações úteis para a equipe que analisa um membro.',
        ],
      },
    ],
  },
  'v0.4.0': {
    label: 'v0.4.0 · Sistemas de segurança',
    summary: 'Uma grande versão de segurança com Honeypot, Petto Vault, leitura do prefixo mais robusta e configurações mais seguras.',
    sections: [
      {
        title: 'Novos sistemas',
        items: [
          'Adicionamos o painel do Honeypot em Components V2 com contagem de acionamentos, casos de moderação, registros de sanções e registros do automod.',
          'Adicionamos os fluxos de backup do Petto Vault para criar, listar, exportar, restaurar, agendar, ver o histórico de auditoria e fazer backups de segurança.',
          'Os números dos backups são por servidor, então a equipe vê `#1`, `#2` e assim por diante, em vez dos IDs internos do banco de dados.',
        ],
      },
      {
        title: 'Moderação e segurança',
        items: [
          'Os prefixos personalizados não diferenciam maiúsculas de minúsculas e aceitam espaços opcionais antes de um comando.',
          'Os alvos de moderação aceitam menções, IDs, nomes de usuário exatos e nomes de exibição exatos, e recusam nomes ambíguos.',
          'A configuração agora ativa o AutoMod de forma explícita e informa separadamente falhas parciais de permissões ou de canais.',
        ],
      },
      {
        title: 'Experiência',
        items: [
          'Os painéis do Honeypot e do Vault usam artes do Petto e controles de Components V2.',
          'As denúncias aceitam cargos urgentes, denúncias anônimas, imagens anexadas e os novos indicadores vermelhos de denúncia.',
          'Removemos a criação automática de convites para o Top.gg para manter o fluxo oficial de convite privado e intencional.',
        ],
      },
    ],
  },
  'v0.3.0-2': {
    label: 'v0.3.0-2 · Visibilidade operacional',
    summary: 'A versão de visibilidade operacional para os limites de requisições da API REST do Discord e o acompanhamento da versão do bot.',
    sections: [
      {
        title: 'Confiabilidade',
        items: [
          'Adicionamos telemetria dos limites de requisições da API REST do Discord com método, rota sanitizada, escopo, tempo de nova tentativa e limite do bucket.',
          'Eventos repetidos de limite de requisições são agrupados por um minuto para o registro continuar útil sem inundar a equipe.',
        ],
      },
      {
        title: 'Notas de versão',
        items: [
          'Atualizamos a versão do bot de `0.1.0` para `0.3.0-2` e documentamos o status da validação.',
        ],
      },
    ],
  },
  'v0.3.0-1': {
    label: 'v0.3.0-1 · Sistema Vanity',
    summary: 'Apresentou o sistema Vanity do Petto e documentou a primeira versão pública desse lançamento.',
    sections: [
      {
        title: 'Vanity',
        items: [
          'Adicionamos o sistema Vanity para gerenciar e apresentar a identidade vanity de um servidor pelo Petto.',
          'A entrada original da versão e as notas completas estão disponíveis no changelog público.',
        ],
      },
      {
        title: 'Mais detalhes',
        items: [
          'Veja a entrada de 13 de agosto de 2026 no changelog do Petto para o contexto completo da versão.',
        ],
      },
    ],
  },
};
