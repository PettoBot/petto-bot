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
         "authorIcon" .User.Avatar
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
  {{ updateMessage (cembed "author" $embed.Author "authorIcon" $embed.AuthorIcon "thumbnail" $embed.Thumbnail "description" $embed.Description "footer" (print "Claimed by " (or .Member.DisplayName .User.Username)) "color" "#ffd166") }}
  {{ return }}
{{ end }}
{{ if ne .User.ID .Button.Data }}{{ respond "Only who made the request can confirm the delivery." true }}{{ return }}{{ end }}
{{ updateMessage (complexMessage "embed" (cembed "author" $embed.Author "authorIcon" $embed.AuthorIcon "thumbnail" $embed.Thumbnail "description" $embed.Description "footer" "Delivered" "color" "#57f287") "components" (cslice)) }}`,
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
  {
    id: 'claim',
    name: 'Claim by reaction',
    description: 'A request card that works with reactions: 🦋 claims it and 🎀 (only by who asked) confirms the delivery. `!claim a cake`',
    suggestedName: 'claim',
    code: `{{ if eq .Trigger "command" }}
  {{ if lt (len .Args) 1 }}Use: {{ .Prefix }}{{ .Cmd }} <what you ask for>{{ return }}{{ end }}
  {{ sendMessage nil (complexMessage
       "embed" (cembed
         "author" (or .Member.DisplayName .User.Username)
         "authorIcon" .User.Avatar
         "thumbnail" .Guild.Icon
         "description" (printf "%s asks for:\\n**%s**\\n\\nReact with 🦋 to claim it, or with 🎀 to confirm the delivery." .User.Mention .RawArgs)
         "color" "#ff91c2")
       "reactions" (cslice "🦋" "🎀")) }}
  {{ deleteTrigger }}
{{ return }}{{ end }}

{{ $embed := index .Message.Embeds 0 }}
{{ if eq $embed.Footer "Delivered" }}{{ return }}{{ end }}
{{ if eq .Reaction.Emoji "🦋" }}
  {{ updateMessage (cembed "author" $embed.Author "authorIcon" $embed.AuthorIcon "thumbnail" $embed.Thumbnail "description" $embed.Description "footer" (print "Claimed by " (or .Member.DisplayName .User.Username)) "color" "#ffd166") }}
  {{ removeReaction }}
{{ return }}{{ end }}
{{ if not (contains $embed.Description (print "<@" .User.ID ">")) }}{{ removeReaction }}{{ return }}{{ end }}
{{ updateMessage (cembed "author" $embed.Author "authorIcon" $embed.AuthorIcon "thumbnail" $embed.Thumbnail "description" $embed.Description "footer" "Delivered" "color" "#57f287") }}`,
  },
  {
    id: 'profile',
    name: 'Profile',
    description: 'A card about a member with their avatar next to the name. `!profile`',
    suggestedName: 'profile',
    code: `{{ $name := or .Member.DisplayName .User.GlobalName .User.Username }}
{{ sendMessage nil (cembed
  "author" $name
  "authorIcon" .User.Avatar
  "thumbnail" .User.Avatar
  "description" (printf "Welcome to **%s**!" .Guild.Name)
  "fields" (cslice
    (cslice "Member since" (printf "<t:%d:D>" .Member.JoinedAt) true)
    (cslice "Roles" (str (len .Member.RoleIDs)) true))
  "footer" .Guild.Name
  "footerIcon" .Guild.Icon
  "color" "#ff91c2") }}`,
  },
  {
    id: 'rolebutton',
    name: 'Role button',
    description: 'A button that gives a role, and takes it away if the person already has it. `!rolebutton @Role`',
    suggestedName: 'rolebutton',
    code: `{{ if eq .Trigger "command" }}
  {{ if lt (len .Args) 1 }}Use: {{ .Prefix }}{{ .Cmd }} @Role{{ return }}{{ end }}
  {{ $id := replace (replace (replace (index .Args 0) "<@&" "") ">" "") " " "" }}
  {{ sendMessage nil (complexMessage
       "embed" (cembed "description" (printf "Press the button to get or leave %s." (index .Args 0)) "color" "#ff91c2")
       "components" (cslice (crow (cbutton "label" "Get or leave the role" "emoji" "🎀" "id" "toggle" "data" $id "style" "primary")))) }}
  {{ deleteTrigger }}
{{ return }}{{ end }}

{{ if hasRole .Button.Data }}
  {{ removeRole .Button.Data }}
  {{ respond (printf "You left %s." (mentionRole .Button.Data)) true }}
{{ else }}
  {{ addRole .Button.Data }}
  {{ respond (printf "You got %s." (mentionRole .Button.Data)) true }}
{{ end }}`,
  },
  {
    id: 'reactrole',
    name: 'Role by reaction',
    description: 'React with 🎀 to get a role. `!reactrole @Role`. Reacting again takes it away',
    suggestedName: 'reactrole',
    code: `{{ if eq .Trigger "command" }}
  {{ if lt (len .Args) 1 }}Use: {{ .Prefix }}{{ .Cmd }} @Role{{ return }}{{ end }}
  {{ $id := replace (replace (replace (index .Args 0) "<@&" "") ">" "") " " "" }}
  {{ sendMessage nil (complexMessage
       "embed" (cembed "description" (printf "React with 🎀 to get %s. React again to leave it." (index .Args 0)) "footer" (print "role " $id) "color" "#ff91c2")
       "reactions" (cslice "🎀")) }}
  {{ deleteTrigger }}
{{ return }}{{ end }}

{{ $e := index .Message.Embeds 0 }}
{{ $id := replace $e.Footer "role " "" }}
{{ if hasRole $id }}{{ removeRole $id }}{{ else }}{{ addRole $id }}{{ end }}
{{ removeReaction }}`,
  },
  {
    id: 'report',
    name: 'Report',
    description: 'A button that opens a form to report something, posted in the channel. `!report`',
    suggestedName: 'report',
    code: `{{ if eq .Trigger "command" }}
  {{ sendMessage nil (complexMessage "content" "Something wrong? Tell us in private." "components" (cslice (crow
    (cbutton "emoji" "📢" "label" "Report" "id" "open" "style" "danger")))) }}
{{ return }}{{ end }}

{{ if eq .Trigger "button" }}
  {{ showModal (cmodal "id" "send" "title" "New report" "fields" (cslice
    (ctext "id" "who" "label" "Who or what" "max" 100)
    (ctext "id" "why" "label" "What happened" "style" "paragraph" "max" 1000))) }}
{{ return }}{{ end }}

{{ sendMessage nil (cembed
  "title" (print "📢 Report about " .Fields.who)
  "description" .Fields.why
  "author" (or .Member.DisplayName .User.Username)
  "authorIcon" .User.Avatar
  "color" "#ed4245") }}
{{ respond "Thanks, the team will look at it." true }}`,
  },
  {
    id: 'whois',
    name: 'Who is',
    description: 'Shows a card about the member you mention, or about you. `!whois @Liam`',
    suggestedName: 'whois',
    code: `{{ $id := .User.ID }}{{ with .Mentions }}{{ $id = (index . 0).ID }}{{ else }}{{ with .Args }}{{ with userID (index . 0) }}{{ $id = . }}{{ end }}{{ end }}{{ end }}
{{ $m := getMember $id }}
{{ if not $m }}I cannot find that member in this server.{{ return }}{{ end }}
{{ $roles := cslice }}{{ range $m.RoleIDs }}{{ $roles = append $roles (mentionRole .) }}{{ end }}
{{ sendMessage nil (cembed
  "author" $m.DisplayName
  "authorIcon" $m.Avatar
  "thumbnail" $m.Avatar
  "color" (or $m.Color "#ff91c2")
  "fields" (cslice
    (cslice "User" (print $m.Mention " · " $m.Username) true)
    (cslice "ID" $m.ID true)
    (cslice "Account made" (timestamp $m.CreatedAt "R") true)
    (cslice "Joined" (or (and $m.JoinedAt (timestamp $m.JoinedAt "R")) "?") true)
    (cslice (printf "Roles (%d)" (len $roles)) (or (truncate (joinStr " " $roles) 1000) "None")))
) }}`,
  },
  {
    id: 'roleinfo',
    name: 'Role info',
    description: 'Shows the color, members and creation date of a role. `!roleinfo @Role`',
    suggestedName: 'roleinfo',
    code: `{{ if not .Args }}Use: {{ .Prefix }}{{ .Cmd }} @Role{{ return }}{{ end }}
{{ $r := getRole (index .Args 0) }}
{{ if not $r }}I cannot find that role.{{ return }}{{ end }}
{{ sendMessage nil (cembed
  "title" $r.Name
  "color" (or $r.Color "#99aab5")
  "fields" (cslice
    (cslice "Members" (str (or $r.MemberCount 0)) true)
    (cslice "Color" (or $r.Color "none") true)
    (cslice "Position" (str $r.Position) true)
    (cslice "Mentionable" (str $r.Mentionable) true)
    (cslice "Created" (timestamp $r.CreatedAt "D") true))
  "footer" (print "ID " $r.ID)
) }}`,
  },
  {
    id: 'rank',
    name: 'Rank',
    description: 'Your place in the coins ranking, or of the member you mention. Uses the coins of `daily`-style commands.',
    suggestedName: 'rank',
    code: `{{ $id := .User.ID }}{{ with .Mentions }}{{ $id = (index . 0).ID }}{{ end }}
{{ $coins := or (dbGet "coins" $id) 0 }}
{{ $place := dbRank "coins" $id }}
{{ if $place }}{{ mentionUser $id }} is **#{{ $place }}** with **{{ formatNumber $coins }}** coins.{{ else }}{{ mentionUser $id }} has no coins yet.{{ end }}`,
  },
];

const byId = (id) => TEMPLATES.find((template) => template.id === String(id ?? '').toLowerCase()) ?? null;

module.exports = { TEMPLATES, byId };
