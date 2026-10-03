// Ready-made commands in Petto Code. `!customcommand template` lists them and installs one under a name the server picks.
// Every one is checked and run by scripts/check-petto-code.js, so none of them can be broken.
const TEMPLATES = [
  {
    id: 'hello',
    name: 'Hello',
    description: 'Greets the person with an embed.',
    suggestedName: 'hello',
    code: `{{ sendMessage nil (cembed
  "title" (print "Hello, " (or .Member.Nick .User.GlobalName .User.Username) "!")
  "description" (printf "Welcome to **%s**. We are %d members." .Guild.Name .Guild.MemberCount)
  "thumbnail" .User.Avatar
  "color" "#ff91c2"
) }}`,
  },
  {
    id: 'roll',
    name: 'Dice',
    description: 'Rolls a dice. `!roll 20` rolls from 1 to 20, `!roll` uses 6 sides.',
    suggestedName: 'roll',
    code: `{{ $sides := 6 }}
{{ if .Args }}{{ $sides = toInt (index .Args 0) }}{{ end }}
{{ if or (lt $sides 2) (gt $sides 1000) }}Use a number from 2 to 1000: {{ .Prefix }}{{ .Cmd }} 20{{ return }}{{ end }}
🎲 {{ .User.Mention }} rolled **{{ add 1 (randInt $sides) }}** (1 to {{ $sides }}).`,
  },
  {
    id: '8ball',
    name: 'Magic 8-ball',
    description: 'Answers a question. `!8ball will it rain?`',
    suggestedName: '8ball',
    code: `{{ if not .Args }}Ask me something: {{ .Prefix }}{{ .Cmd }} will it rain?{{ return }}{{ end }}
{{ $answers := cslice "It is certain." "Without a doubt." "Yes." "Most likely." "Ask again later." "I cannot tell now." "Do not count on it." "My answer is no." "Very doubtful." }}
🎱 {{ index $answers (randInt (len $answers)) }}`,
  },
  {
    id: 'choose',
    name: 'Choose',
    description: 'Picks one of the options. `!choose pizza "ice cream" salad`',
    suggestedName: 'choose',
    code: `{{ if lt (len .Args) 2 }}Give me at least two options: {{ .Prefix }}{{ .Cmd }} pizza "ice cream" salad{{ return }}{{ end }}
I choose **{{ index .Args (randInt (len .Args)) }}**.`,
  },
  {
    id: 'userinfo',
    name: 'User info',
    description: 'Shows the name, the roles and when the person joined.',
    suggestedName: 'userinfo',
    code: `{{ sendMessage nil (cembed
  "title" .User.Username
  "thumbnail" .User.Avatar
  "color" "#8399ff"
  "fields" (cslice
    (cslice "Nickname" (or .Member.Nick "None") true)
    (cslice "Roles" (str (len .Member.RoleIDs)) true)
    (cslice "Joined" (timestamp .Member.JoinedAt "R") true)
    (cslice "ID" .User.ID true))
) }}`,
  },
  {
    id: 'serverinfo',
    name: 'Server info',
    description: 'Shows the name and the members of the server.',
    suggestedName: 'serverinfo',
    code: `{{ sendMessage nil (cembed
  "title" .Guild.Name
  "thumbnail" .Guild.Icon
  "color" "#8399ff"
  "fields" (cslice
    (cslice "Members" (str .Guild.MemberCount) true)
    (cslice "Channel" .Channel.Mention true)
    (cslice "ID" .Guild.ID true))
) }}`,
  },
  {
    id: 'avatar',
    name: 'Avatar',
    description: 'Shows the picture of the person who uses it.',
    suggestedName: 'avatar',
    code: `{{ sendMessage nil (cembed "title" (print .User.Username "'s avatar") "image" .User.Avatar "color" "#ff91c2") }}`,
  },
  {
    id: 'say',
    name: 'Say',
    description: 'Repeats what you write inside an embed, with your name. `!say hello everyone`',
    suggestedName: 'say',
    code: `{{ if not .Args }}Write something: {{ .Prefix }}{{ .Cmd }} hello everyone{{ return }}{{ end }}
{{ deleteTrigger }}
{{ sendMessage nil (cembed "description" .RawArgs "author" (or .Member.Nick .User.Username) "color" "#8399ff") }}`,
  },
  {
    id: 'countdown',
    name: 'Countdown',
    description: 'Time left until a date in unix seconds. `!countdown 1893456000`',
    suggestedName: 'countdown',
    code: `{{ if not .Args }}Give me a date in unix seconds: {{ .Prefix }}{{ .Cmd }} 1893456000{{ return }}{{ end }}
{{ $target := toInt (index .Args 0) }}
{{ $left := sub $target (unix) }}
{{ if gt $left 0 }}⏳ It happens {{ timestamp $target "R" }} (in {{ humanizeDuration $left }}).{{ else }}It already happened {{ timestamp $target "R" }}.{{ end }}`,
  },
  {
    id: 'vote',
    name: 'Vote',
    description: 'A yes or no vote with buttons that count. `!vote pizza tonight?`',
    suggestedName: 'vote',
    code: `{{ if eq .Trigger "command" }}
{{ if not .Args }}Ask something: {{ .Prefix }}{{ .Cmd }} pizza tonight?{{ return }}{{ end }}
{{ sendMessage nil (complexMessage
  "embed" (cembed "title" "📊 Vote" "description" .RawArgs "footer" "Yes: 0 · No: 0" "color" "#8399ff")
  "components" (cslice (crow
    (cbutton "label" "Yes" "id" "yes" "style" "success")
    (cbutton "label" "No" "id" "no" "style" "danger")))) }}
{{ return }}{{ end }}
{{ $poll := .Message.ID }}
{{ $before := dbGet (print "vote:" $poll) .User.ID }}
{{ if eq $before .Button.ID }}{{ respond "You already voted that." true }}{{ return }}{{ end }}
{{ if $before }}{{ $x := dbIncr (print "votes:" $poll ":" $before) -1 }}{{ end }}
{{ dbSet (print "vote:" $poll) .Button.ID .User.ID }}
{{ $x := dbIncr (print "votes:" $poll ":" .Button.ID) 1 }}
{{ $yes := or (dbGet (print "votes:" $poll ":yes")) 0 }}
{{ $no := or (dbGet (print "votes:" $poll ":no")) 0 }}
{{ $first := index .Message.Embeds 0 }}
{{ updateMessage (cembed "title" "📊 Vote" "description" $first.Description "footer" (printf "Yes: %d · No: %d" $yes $no) "color" "#8399ff") }}`,
  },
  {
    id: 'clicker',
    name: 'Clicker',
    description: 'A button that counts every click of the whole server. `!clicker`',
    suggestedName: 'clicker',
    code: `{{ if eq .Trigger "command" }}
{{ sendMessage nil (complexMessage "content" "Clicks: **0**" "components" (cslice (crow (cbutton "label" "Click me!" "emoji" "👆" "id" "click" "style" "primary")))) }}
{{ return }}{{ end }}
{{ $total := dbIncr "clicks" 1 }}
{{ $mine := dbIncr "clicks" 1 .User.ID }}
{{ updateMessage (complexMessage "content" (printf "Clicks: **%d**\nLast click: %s (their %dth)" $total .User.Username $mine)) }}`,
  },
  {
    id: 'favorite',
    name: 'Favorite',
    description: 'A menu to pick a favorite, answered in private. `!favorite`',
    suggestedName: 'favorite',
    code: `{{ if eq .Trigger "command" }}
{{ sendMessage nil (complexMessage "content" "What is your favorite?" "components" (cslice (crow
  (cselect "id" "pick" "placeholder" "Choose one" "options" (cslice
    (cslice "Pizza 🍕" "pizza" "Cheesy and warm")
    (cslice "Sushi 🍣" "sushi" "Fresh")
    (cslice "Tacos 🌮" "tacos" "Crunchy")))))) }}
{{ return }}{{ end }}
{{ respond (printf "You chose **%s**!" (index .Values 0)) true }}`,
  },
  {
    id: 'request',
    name: 'Request',
    description: 'A request card with two buttons: one to claim it and one for whoever asked to confirm the delivery. `!request a cake`',
    suggestedName: 'request',
    code: `{{ if eq .Trigger "command" }}
  {{ if lt (len .Args) 1 }}Use: {{ .Prefix }}{{ .Cmd }} <what you ask for>{{ return }}{{ end }}
  {{ sendMessage nil (complexMessage
       "embed" (cembed
         "author" (or .Member.DisplayName .User.Username)
         "thumbnail" .Guild.Icon
         "description" (printf "%s asks for:\\n**%s**\\n\\nUse the buttons to claim it or to confirm the delivery." .User.Mention .RawArgs)
         "color" "#ff91c2")
       "components" (cslice (crow
         (cbutton "emoji" "🦋" "label" "Claim" "id" "claim" "data" .User.ID)
         (cbutton "emoji" "🎀" "label" "Delivered" "id" "done" "data" .User.ID "style" "success")))) }}
  {{ deleteTrigger }}
{{ return }}{{ end }}

{{ $embed := index .Message.Embeds 0 }}
{{ if eq .Button.ID "claim" }}
  {{ updateMessage (cembed "description" $embed.Description "footer" (print "Claimed by " (or .Member.DisplayName .User.Username)) "color" "#ffd166") }}
  {{ return }}
{{ end }}
{{ if ne .User.ID .Button.Data }}{{ respond "Only who made the request can confirm the delivery." true }}{{ return }}{{ end }}
{{ updateMessage (complexMessage "embed" (cembed "description" $embed.Description "footer" "Delivered" "color" "#57f287") "components" (cslice)) }}`,
  },
  {
    id: 'suggest',
    name: 'Suggest',
    description: 'A button that opens a form (a modal) to write a suggestion, which is then posted in the channel. `!suggest`',
    suggestedName: 'suggest',
    code: `{{ if eq .Trigger "command" }}
  {{ sendMessage nil (complexMessage "content" "Have an idea for the server?" "components" (cslice (crow
    (cbutton "emoji" "💡" "label" "Suggest" "id" "open" "style" "primary")))) }}
{{ return }}{{ end }}

{{ if eq .Trigger "button" }}
  {{ showModal (cmodal "id" "send" "title" "Your suggestion" "fields" (cslice
    (ctext "id" "title" "label" "Title" "max" 80 "placeholder" "A short summary")
    (ctext "id" "details" "label" "Details" "style" "paragraph" "max" 1000 "required" false))) }}
{{ return }}{{ end }}

{{ sendMessage nil (cembed
  "title" (print "💡 " .Fields.title)
  "description" (or .Fields.details "No more details.")
  "footer" (print "Suggested by " (or .Member.DisplayName .User.Username))
  "color" "#ff91c2") }}
{{ respond "Thank you, your suggestion was posted." true }}`,
  },
];

const byId = (id) => TEMPLATES.find((template) => template.id === String(id ?? '').toLowerCase()) ?? null;

module.exports = { TEMPLATES, byId };
