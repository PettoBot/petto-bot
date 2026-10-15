// Ready-made commands in Petto Code. `!customcommand template` lists them and installs one under a name the server picks.
// Every one is checked and run by scripts/check-petto-code.js, so none of them can be broken.
//
// Once installed, the code is the server's own, so it is installed with its sentences in the language of the server. In a
// `source`, the sentences are marks of the `scripting` catalog (`scripting.template.<id>.<key>`):
//   [[key]]   the sentence as it is: in the text the command prints, or inside a string of the code. Its {placeholders} are
//             the actions of `vars[key]` (`{{ .User.Mention }}`).
//   [[@key]]  the sentence as one or more strings of the code ("Hello, " (or .Member.Nick …) "!"): its {placeholders} are the
//             values of `vars[key]`, pieces of code put between the strings.
const { t, currentLanguage } = require('../i18n');

// i18n-ignore: Petto Code, the command as the member typed it, in the examples of how to use it
const COMMAND = '{{ .Prefix }}{{ .Cmd }}';

const DEFINITIONS = [
  {
    id: 'hello',
    suggestedName: 'hello',
    vars: { title: { name: '(or .Member.Nick .User.GlobalName .User.Username)' } }, // i18n-ignore: Petto Code
    source: `{{ sendMessage nil (cembed
  "title" (print [[@title]])
  "description" (printf [[@welcome]] .Guild.Name .Guild.MemberCount)
  "thumbnail" .User.Avatar
  "color" "#ff91c2"
) }}`,
  },
  {
    id: 'roll',
    suggestedName: 'roll',
    vars: { useNumber: { command: COMMAND }, rolled: { user: '{{ .User.Mention }}', result: '{{ add 1 (randInt $sides) }}', sides: '{{ $sides }}' } }, // i18n-ignore: Petto Code
    source: `{{ $sides := 6 }}
{{ if .Args }}{{ $sides = toInt (index .Args 0) }}{{ end }}
{{ if or (lt $sides 2) (gt $sides 1000) }}[[useNumber]]{{ return }}{{ end }}
🎲 [[rolled]]`,
  },
  {
    id: '8ball',
    suggestedName: '8ball',
    vars: { ask: { command: COMMAND } }, // i18n-ignore: Petto Code
    source: `{{ if not .Args }}[[ask]]{{ return }}{{ end }}
{{ $answers := cslice [[@answer1]] [[@answer2]] [[@answer3]] [[@answer4]] [[@answer5]] [[@answer6]] [[@answer7]] [[@answer8]] [[@answer9]] }}
🎱 {{ index $answers (randInt (len $answers)) }}`,
  },
  {
    id: 'choose',
    suggestedName: 'choose',
    vars: { needTwo: { command: COMMAND }, chose: { choice: '{{ index .Args (randInt (len .Args)) }}' } }, // i18n-ignore: Petto Code
    source: `{{ if lt (len .Args) 2 }}[[needTwo]]{{ return }}{{ end }}
[[chose]]`,
  },
  {
    id: 'userinfo',
    suggestedName: 'userinfo', // i18n-ignore: Petto Code
    source: `{{ sendMessage nil (cembed
  "title" .User.Username
  "thumbnail" .User.Avatar
  "color" "#8399ff"
  "fields" (cslice
    (cslice [[@nickname]] (or .Member.Nick [[@none]]) true)
    (cslice [[@roles]] (str (len .Member.RoleIDs)) true)
    (cslice [[@joined]] (timestamp .Member.JoinedAt "R") true)
    (cslice "ID" .User.ID true))
) }}`,
  },
  {
    id: 'serverinfo',
    suggestedName: 'serverinfo', // i18n-ignore: Petto Code
    source: `{{ sendMessage nil (cembed
  "title" .Guild.Name
  "thumbnail" .Guild.Icon
  "color" "#8399ff"
  "fields" (cslice
    (cslice [[@members]] (str .Guild.MemberCount) true)
    (cslice [[@channel]] .Channel.Mention true)
    (cslice "ID" .Guild.ID true))
) }}`,
  },
  {
    id: 'avatar',
    suggestedName: 'avatar',
    vars: { title: { name: '.User.Username' } }, // i18n-ignore: Petto Code
    source: `{{ sendMessage nil (cembed "title" (print [[@title]]) "image" .User.Avatar "color" "#ff91c2") }}`,
  },
  {
    id: 'say',
    suggestedName: 'say',
    vars: { write: { command: COMMAND } }, // i18n-ignore: Petto Code
    source: `{{ if not .Args }}[[write]]{{ return }}{{ end }}
{{ deleteTrigger }}
{{ sendMessage nil (cembed "description" .RawArgs "author" (or .Member.Nick .User.Username) "color" "#8399ff") }}`,
  },
  {
    id: 'countdown',
    suggestedName: 'countdown',
    vars: { giveDate: { command: COMMAND }, future: { when: '{{ timestamp $target "R" }}', left: '{{ humanizeDuration $left }}' }, past: { when: '{{ timestamp $target "R" }}' } }, // i18n-ignore: Petto Code
    source: `{{ if not .Args }}[[giveDate]]{{ return }}{{ end }}
{{ $target := toInt (index .Args 0) }}
{{ $left := sub $target (unix) }}
{{ if gt $left 0 }}⏳ [[future]]{{ else }}[[past]]{{ end }}`,
  },
  {
    id: 'vote',
    suggestedName: 'vote',
    vars: { ask: { command: COMMAND } }, // i18n-ignore: Petto Code
    source: `{{ if eq .Trigger "command" }}
{{ if not .Args }}[[ask]]{{ return }}{{ end }}
{{ sendMessage nil (complexMessage
  "embed" (cembed "title" [[@title]] "description" .RawArgs "footer" [[@footerStart]] "color" "#8399ff")
  "components" (cslice (crow
    (cbutton "label" [[@yes.button]] "id" "yes" "style" "success")
    (cbutton "label" [[@no.button]] "id" "no" "style" "danger")))) }}
{{ return }}{{ end }}
{{ $poll := .Message.ID }}
{{ $before := dbGet (print "vote:" $poll) .User.ID }}
{{ if eq $before .Button.ID }}{{ respond [[@already]] true }}{{ return }}{{ end }}
{{ if $before }}{{ $x := dbIncr (print "votes:" $poll ":" $before) -1 }}{{ end }}
{{ dbSet (print "vote:" $poll) .Button.ID .User.ID }}
{{ $x := dbIncr (print "votes:" $poll ":" .Button.ID) 1 }}
{{ $yes := or (dbGet (print "votes:" $poll ":yes")) 0 }}
{{ $no := or (dbGet (print "votes:" $poll ":no")) 0 }}
{{ $first := index .Message.Embeds 0 }}
{{ updateMessage (cembed "title" [[@title]] "description" $first.Description "footer" (printf [[@footer]] $yes $no) "color" "#8399ff") }}`,
  },
  {
    id: 'clicker',
    suggestedName: 'clicker', // i18n-ignore: Petto Code
    source: `{{ if eq .Trigger "command" }}
{{ sendMessage nil (complexMessage "content" [[@start]] "components" (cslice (crow (cbutton "label" [[@click.button]] "emoji" "👆" "id" "click" "style" "primary")))) }}
{{ return }}{{ end }}
{{ $total := dbIncr "clicks" 1 }}
{{ $mine := dbIncr "clicks" 1 .User.ID }}
{{ updateMessage (complexMessage "content" (printf [[@clicks]] $total .User.Username $mine)) }}`,
  },
  {
    id: 'favorite',
    suggestedName: 'favorite', // i18n-ignore: Petto Code
    source: `{{ if eq .Trigger "command" }}
{{ sendMessage nil (complexMessage "content" [[@question]] "components" (cslice (crow
  (cselect "id" "pick" "placeholder" [[@choose.menu]] "options" (cslice
    (cslice [[@pizza.menu]] "pizza" [[@pizzaInfo.menu]])
    (cslice [[@sushi.menu]] "sushi" [[@sushiInfo.menu]])
    (cslice [[@tacos.menu]] "tacos" [[@tacosInfo.menu]])))))) }}
{{ return }}{{ end }}
{{ respond (printf [[@chose]] (index .Values 0)) true }}`,
  },
  {
    id: 'request',
    suggestedName: 'request',
    vars: { use: { command: COMMAND }, claimedBy: { name: '(or .Member.DisplayName .User.Username)' } }, // i18n-ignore: Petto Code
    source: `{{ if eq .Trigger "command" }}
  {{ if lt (len .Args) 1 }}[[use]]{{ return }}{{ end }}
  {{ sendMessage nil (complexMessage
       "embed" (cembed
         "author" (or .Member.DisplayName .User.Username)
         "authorIcon" .User.Avatar
         "thumbnail" .Guild.Icon
         "description" (printf "[[asks]]\\n**%s**\\n\\n[[useButtons]]" .User.Mention .RawArgs)
         "color" "#ff91c2")
       "components" (cslice (crow
         (cbutton "emoji" "🦋" "label" [[@claim.button]] "id" "claim" "data" .User.ID)
         (cbutton "emoji" "🎀" "label" [[@delivered.button]] "id" "done" "data" .User.ID "style" "success")))) }}
  {{ deleteTrigger }}
{{ return }}{{ end }}

{{ $embed := index .Message.Embeds 0 }}
{{ if eq .Button.ID "claim" }}
  {{ updateMessage (cembed "author" $embed.Author "authorIcon" $embed.AuthorIcon "thumbnail" $embed.Thumbnail "description" $embed.Description "footer" (print [[@claimedBy]]) "color" "#ffd166") }}
  {{ return }}
{{ end }}
{{ if ne .User.ID .Button.Data }}{{ respond [[@onlyAsker]] true }}{{ return }}{{ end }}
{{ updateMessage (complexMessage "embed" (cembed "author" $embed.Author "authorIcon" $embed.AuthorIcon "thumbnail" $embed.Thumbnail "description" $embed.Description "footer" [[@delivered]] "color" "#57f287") "components" (cslice)) }}`,
  },
  {
    id: 'suggest',
    suggestedName: 'suggest',
    vars: { suggestedBy: { name: '(or .Member.DisplayName .User.Username)' } }, // i18n-ignore: Petto Code
    source: `{{ if eq .Trigger "command" }}
  {{ sendMessage nil (complexMessage "content" [[@idea]] "components" (cslice (crow
    (cbutton "emoji" "💡" "label" [[@suggest.button]] "id" "open" "style" "primary")))) }}
{{ return }}{{ end }}

{{ if eq .Trigger "button" }}
  {{ showModal (cmodal "id" "send" "title" [[@formTitle]] "fields" (cslice
    (ctext "id" "title" "label" [[@titleLabel]] "max" 80 "placeholder" [[@titlePlaceholder]])
    (ctext "id" "details" "label" [[@detailsLabel]] "style" "paragraph" "max" 1000 "required" false))) }}
{{ return }}{{ end }}

{{ sendMessage nil (cembed
  "title" (print "💡 " .Fields.title)
  "description" (or .Fields.details [[@noDetails]])
  "footer" (print [[@suggestedBy]])
  "color" "#ff91c2") }}
{{ respond [[@thanks]] true }}`,
  },
  {
    id: 'claim',
    suggestedName: 'claim',
    vars: { use: { command: COMMAND }, claimedBy: { name: '(or .Member.DisplayName .User.Username)' } }, // i18n-ignore: Petto Code
    source: `{{ if eq .Trigger "command" }}
  {{ if lt (len .Args) 1 }}[[use]]{{ return }}{{ end }}
  {{ sendMessage nil (complexMessage
       "embed" (cembed
         "author" (or .Member.DisplayName .User.Username)
         "authorIcon" .User.Avatar
         "thumbnail" .Guild.Icon
         "description" (printf "[[asks]]\\n**%s**\\n\\n[[reactHow]]" .User.Mention .RawArgs)
         "color" "#ff91c2")
       "reactions" (cslice "🦋" "🎀")) }}
  {{ deleteTrigger }}
{{ return }}{{ end }}

{{ $embed := index .Message.Embeds 0 }}
{{ if eq $embed.Footer [[@delivered]] }}{{ return }}{{ end }}
{{ if eq .Reaction.Emoji "🦋" }}
  {{ updateMessage (cembed "author" $embed.Author "authorIcon" $embed.AuthorIcon "thumbnail" $embed.Thumbnail "description" $embed.Description "footer" (print [[@claimedBy]]) "color" "#ffd166") }}
  {{ removeReaction }}
{{ return }}{{ end }}
{{ if not (contains $embed.Description (print "<@" .User.ID ">")) }}{{ removeReaction }}{{ return }}{{ end }}
{{ updateMessage (cembed "author" $embed.Author "authorIcon" $embed.AuthorIcon "thumbnail" $embed.Thumbnail "description" $embed.Description "footer" [[@delivered]] "color" "#57f287") }}`,
  },
  {
    id: 'profile',
    suggestedName: 'profile', // i18n-ignore: Petto Code
    source: `{{ $name := or .Member.DisplayName .User.GlobalName .User.Username }}
{{ sendMessage nil (cembed
  "author" $name
  "authorIcon" .User.Avatar
  "thumbnail" .User.Avatar
  "description" (printf [[@welcome]] .Guild.Name)
  "fields" (cslice
    (cslice [[@memberSince]] (printf "<t:%d:D>" .Member.JoinedAt) true)
    (cslice [[@roles]] (str (len .Member.RoleIDs)) true))
  "footer" .Guild.Name
  "footerIcon" .Guild.Icon
  "color" "#ff91c2") }}`,
  },
  {
    id: 'rolebutton',
    suggestedName: 'rolebutton',
    vars: { use: { command: COMMAND } }, // i18n-ignore: Petto Code
    source: `{{ if eq .Trigger "command" }}
  {{ if lt (len .Args) 1 }}[[use]]{{ return }}{{ end }}
  {{ $id := replace (replace (replace (index .Args 0) "<@&" "") ">" "") " " "" }}
  {{ sendMessage nil (complexMessage
       "embed" (cembed "description" (printf [[@press]] (index .Args 0)) "color" "#ff91c2")
       "components" (cslice (crow (cbutton "label" [[@toggle.button]] "emoji" "🎀" "id" "toggle" "data" $id "style" "primary")))) }}
  {{ deleteTrigger }}
{{ return }}{{ end }}

{{ if hasRole .Button.Data }}
  {{ removeRole .Button.Data }}
  {{ respond (printf [[@left]] (mentionRole .Button.Data)) true }}
{{ else }}
  {{ addRole .Button.Data }}
  {{ respond (printf [[@got]] (mentionRole .Button.Data)) true }}
{{ end }}`,
  },
  {
    id: 'reactrole',
    suggestedName: 'reactrole',
    vars: { use: { command: COMMAND } }, // i18n-ignore: Petto Code
    source: `{{ if eq .Trigger "command" }}
  {{ if lt (len .Args) 1 }}[[use]]{{ return }}{{ end }}
  {{ $id := replace (replace (replace (index .Args 0) "<@&" "") ">" "") " " "" }}
  {{ sendMessage nil (complexMessage
       "embed" (cembed "description" (printf [[@react]] (index .Args 0)) "footer" (print [[@footerPrefix]] $id) "color" "#ff91c2")
       "reactions" (cslice "🎀")) }}
  {{ deleteTrigger }}
{{ return }}{{ end }}

{{ $e := index .Message.Embeds 0 }}
{{ $id := replace $e.Footer [[@footerPrefix]] "" }}
{{ if hasRole $id }}{{ removeRole $id }}{{ else }}{{ addRole $id }}{{ end }}
{{ removeReaction }}`,
  },
  {
    id: 'report',
    suggestedName: 'report',
    vars: { title: { who: '.Fields.who' } }, // i18n-ignore: Petto Code
    source: `{{ if eq .Trigger "command" }}
  {{ sendMessage nil (complexMessage "content" [[@wrong]] "components" (cslice (crow
    (cbutton "emoji" "📢" "label" [[@report.button]] "id" "open" "style" "danger")))) }}
{{ return }}{{ end }}

{{ if eq .Trigger "button" }}
  {{ showModal (cmodal "id" "send" "title" [[@formTitle]] "fields" (cslice
    (ctext "id" "who" "label" [[@whoLabel]] "max" 100)
    (ctext "id" "why" "label" [[@whyLabel]] "style" "paragraph" "max" 1000))) }}
{{ return }}{{ end }}

{{ sendMessage nil (cembed
  "title" (print [[@title]])
  "description" .Fields.why
  "author" (or .Member.DisplayName .User.Username)
  "authorIcon" .User.Avatar
  "color" "#ed4245") }}
{{ respond [[@thanks]] true }}`,
  },
  {
    id: 'whois',
    suggestedName: 'whois', // i18n-ignore: Petto Code
    source: `{{ $id := .User.ID }}{{ with .Mentions }}{{ $id = (index . 0).ID }}{{ else }}{{ with .Args }}{{ with userID (index . 0) }}{{ $id = . }}{{ end }}{{ end }}{{ end }}
{{ $m := getMember $id }}
{{ if not $m }}[[notFound]]{{ return }}{{ end }}
{{ $roles := cslice }}{{ range $m.RoleIDs }}{{ $roles = append $roles (mentionRole .) }}{{ end }}
{{ sendMessage nil (cembed
  "author" $m.DisplayName
  "authorIcon" $m.Avatar
  "thumbnail" $m.Avatar
  "color" (or $m.Color "#ff91c2")
  "fields" (cslice
    (cslice [[@user]] (print $m.Mention " · " $m.Username) true)
    (cslice "ID" $m.ID true)
    (cslice [[@accountMade]] (timestamp $m.CreatedAt "R") true)
    (cslice [[@joined]] (or (and $m.JoinedAt (timestamp $m.JoinedAt "R")) "?") true)
    (cslice (printf [[@roles]] (len $roles)) (or (truncate (joinStr " " $roles) 1000) [[@none]])))
) }}`,
  },
  {
    id: 'roleinfo',
    suggestedName: 'roleinfo',
    vars: { use: { command: COMMAND } }, // i18n-ignore: Petto Code
    source: `{{ if not .Args }}[[use]]{{ return }}{{ end }}
{{ $r := getRole (index .Args 0) }}
{{ if not $r }}[[notFound]]{{ return }}{{ end }}
{{ sendMessage nil (cembed
  "title" $r.Name
  "color" (or $r.Color "#99aab5")
  "fields" (cslice
    (cslice [[@members]] (str (or $r.MemberCount 0)) true)
    (cslice [[@color]] (or $r.Color [[@noColor]]) true)
    (cslice [[@position]] (str $r.Position) true)
    (cslice [[@mentionable]] (str $r.Mentionable) true)
    (cslice [[@created]] (timestamp $r.CreatedAt "D") true))
  "footer" (print "ID " $r.ID)
) }}`,
  },
  {
    id: 'rank',
    suggestedName: 'rank',
    vars: { place: { user: '{{ mentionUser $id }}', place: '{{ $place }}', coins: '{{ formatNumber $coins }}' }, noCoins: { user: '{{ mentionUser $id }}' } }, // i18n-ignore: Petto Code
    source: `{{ $id := .User.ID }}{{ with .Mentions }}{{ $id = (index . 0).ID }}{{ end }}
{{ $coins := or (dbGet "coins" $id) 0 }}
{{ $place := dbRank "coins" $id }}
{{ if $place }}[[place]]{{ else }}[[noCoins]]{{ end }}`,
  },
];

const MARK = /\[\[(@?)([A-Za-z0-9.]+)\]\]/g;

/** A text as a string of Petto Code: "…", with its quotes and backslashes escaped. */
const quoted = (value) => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/** A sentence as strings of Petto Code with the pieces of code of its placeholders between them: "Hello, " (or …) "!". */
function asStrings(sentence, vars) {
  const pieces = [];
  let at = 0;
  for (const match of sentence.matchAll(/\{([A-Za-z0-9_]+)\}/g)) {
    if (!Object.hasOwn(vars, match[1])) continue;
    if (match.index > at) pieces.push(quoted(sentence.slice(at, match.index)));
    pieces.push(vars[match[1]]);
    at = match.index + match[0].length;
  }
  if (at < sentence.length || !pieces.length) pieces.push(quoted(sentence.slice(at)));
  return pieces.join(' ');
}

/** The code of a template with its sentences in `lang`. */
function templateCode(template, lang = currentLanguage()) {
  return template.source.replace(MARK, (mark, inCode, key) => {
    const vars = template.vars?.[key] ?? {};
    const sentence = t(lang, `scripting.template.${template.id}.${key}`, inCode ? undefined : vars);
    return inCode ? asStrings(sentence, vars) : sentence;
  });
}

/** The name, the description and the code of a template in `lang`, for a list or to install it. */
function templateIn(template, lang = currentLanguage()) {
  return {
    id: template.id,
    name: t(lang, `scripting.template.${template.id}.name`),
    description: t(lang, `scripting.template.${template.id}.description`),
    suggestedName: template.suggestedName,
    code: templateCode(template, lang),
  };
}

// `TEMPLATES` keep their English name, description and code, for the code that reads them without a language.
const TEMPLATES = DEFINITIONS.map((template) => ({ ...template, ...templateIn(template, 'en') }));

const byId = (id) => TEMPLATES.find((template) => template.id === String(id ?? '').toLowerCase()) ?? null;

module.exports = { TEMPLATES, byId, templateIn, templateCode };
