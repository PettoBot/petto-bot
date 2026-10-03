// Checks Petto Code, the template language of custom commands: the syntax, the functions, the effects, the safety, and the limits.
const assert = require('node:assert/strict');
const { run, check, PettoCodeError, functionNames } = require('../src/scripting');

const data = {
  User: { ID: '123456789012345678', Username: 'Liam', Mention: '<@123456789012345678>' },
  Member: { RoleIDs: ['223456789012345678'] },
  Guild: { ID: '323456789012345678', Name: 'Petto HQ', MemberCount: 90 },
  Args: ['5', 'three', '7'],
};
const out = async (code, extra = {}, options = {}) => (await run(code, { ...data, ...extra }, options)).output;
const fails = async (code, kind, includes, options) => {
  try { await run(code, data, options); } catch (error) {
    assert.ok(error instanceof PettoCodeError, `a PettoCodeError for ${code}`);
    assert.equal(error.kind, kind, `${kind} for ${code}: ${error.message}`);
    if (includes) assert.ok(error.message.includes(includes), `"${error.message}" should say "${includes}"`);
    return error;
  }
  return assert.fail(`${code} should have failed`);
};

(async () => {
// Text, printing and values.
assert.equal(await out('Hello {{ .User.Username }}!'), 'Hello Liam!');
assert.equal(await out('{{ .Guild.MemberCount }} {{ true }} {{ nil }}|{{ 1.5 }} {{ "a\\nb" }} {{ `raw\\n` }}'), '90 true |1.5 a\nb raw\\n');
assert.equal(await out('{{/* a comment */}}x{{- /* trimmed */ -}}  y'), 'xy');
assert.equal(await out('a  {{- "b" -}}  c'), 'abc', 'the trim markers take away the white space');
assert.equal(await out('{{ .Args }} {{ index .Args 1 }} {{ len .Args }}'), '[5 three 7] three 3');
assert.equal(await out('{{ (dict "a" 1 "b" 2).b }} {{ index (dict "k" "v") "k" }}'), '2 v');

// A path is one value only while its parts touch: .A.B is a path, .A .B are two values.
assert.equal(await out('{{ printf "%s/%s/%s" .Guild.Name .User.Username .Guild.MemberCount }}'), 'Petto HQ/Liam/90');
assert.equal(await out('{{ print .Guild.Name " " .Guild.ID }}'), 'Petto HQ 323456789012345678');
assert.equal(await out('{{ $g := .Guild }}{{ print $g.Name $g.MemberCount }}'), 'Petto HQ90');
assert.equal(await out('{{ print (dict "a" 1).a (dict "b" 2).b }}'), '12');

// Variables, assignment and scope.
assert.equal(await out('{{ $x := 1 }}{{ $x = add $x 4 }}{{ $x }}'), '5');
assert.equal(await out('{{ $x := 1 }}{{ if true }}{{ $x = 2 }}{{ $y := 9 }}{{ end }}{{ $x }}'), '2', 'an inner block changes the outer variable');
await fails('{{ if true }}{{ $y := 9 }}{{ end }}{{ $y }}', 'runtime', '$y is not defined');
await fails('{{ $z = 1 }}', 'runtime', 'not defined');
assert.equal(await out('{{ range .L }}{{ $.Name }}{{ end }}', { L: [1, 2], Name: 'n' }), 'nn', '$ is the data in any block');

// Conditions.
assert.equal(await out('{{ if eq (index .Args 0) "5" }}five{{ else if gt (toInt (index .Args 0)) 9 }}big{{ else }}other{{ end }}'), 'five');
assert.equal(await out('{{ if .Missing }}a{{ else if .User.Username }}b{{ else }}c{{ end }}', { Missing: null }), 'b');
assert.equal(await out('{{ if and 1 "" }}t{{ else }}f{{ end }}{{ if or 0 "x" }}t{{ end }}{{ if not 0 }}n{{ end }}'), 'ftn');
assert.equal(await out('{{ if eq 1 2 3 1 }}in{{ end }}{{ if ne "a" "b" }}ne{{ end }}{{ if lt 1 2 }}lt{{ end }}{{ if ge "b" "a" }}ge{{ end }}'), 'inneltge');
assert.equal(await out('{{ with .User }}{{ .Username }}{{ else }}none{{ end }}{{ with .Nope }}x{{ else }}none{{ end }}', { Nope: null }), 'Liamnone');
await fails('{{ lt 1 "a" }}', 'runtime', 'Cannot compare');

// Loops.
assert.equal(await out('{{ range $i, $v := .Args }}{{ $i }}={{ $v }};{{ end }}'), '0=5;1=three;2=7;');
assert.equal(await out('{{ range .Args }}{{ . }},{{ end }}'), '5,three,7,');
assert.equal(await out('{{ range $v := seq 0 6 }}{{ if eq $v 2 }}{{ continue }}{{ end }}{{ if eq $v 4 }}{{ break }}{{ end }}{{ $v }}{{ end }}'), '013');
assert.equal(await out('{{ range .Empty }}x{{ else }}empty{{ end }}', { Empty: [] }), 'empty');
assert.equal(await out('{{ range $k, $v := .M }}{{ $k }}{{ $v }}{{ end }}', { M: { b: 2, a: 1 } }), 'a1b2', 'a map is walked in the order of its keys');
assert.equal(await out('a{{ return }}b'), 'a', 'return ends the code');
await fails('{{ break }}', 'runtime', 'inside a range');

// Pipes and parentheses.
assert.equal(await out('{{ "  hello world " | trim | title }}'), 'Hello World');
assert.equal(await out('{{ 3 | add 4 | mult 2 }}'), '14', 'the value of a pipe is the last argument');
assert.equal(await out('{{ sub 10 (mult 2 3) }}'), '4');
assert.equal(await out('{{ join (split "a-b-c" "-") "+" }}'), 'a+b+c');
assert.equal(await out('{{ "-" | split "a-b" | len }}'), '2', 'the value of a pipe is the last argument, as in Go templates');

// Math and conversions.
assert.equal(await out('{{ add 1 2 3 }} {{ sub 10 1 2 }} {{ mult 2 3 4 }} {{ div 9 2 }} {{ mod 9 4 }} {{ pow 2 10 }} {{ floor 2.7 }} {{ ceil 2.1 }} {{ round 2.5 }} {{ abs -3 }} {{ min 4 2 9 }} {{ max 4 2 9 }}'), '6 7 24 4.5 1 1024 2 3 3 3 2 9');
assert.equal(await out('{{ add (index .Args 0) (index .Args 2) }}'), '12', 'the text of an argument that is a number works in math');
assert.equal(await out('{{ toInt "42abc" }}|{{ toInt " 7 " }}|{{ toInt 3.9 }}|{{ toFloat "2.5" }}'), '0|7|3|2.5');
await fails('{{ div 1 0 }}', 'runtime', 'divide by zero');
await fails('{{ add 1 "x" }}', 'runtime', 'Expected a number');
assert.equal(((await run('{{ randInt 5 6 }}{{ randInt 3 }}', data, { random: () => 0 }))).output, '50');
assert.equal((await run('{{ index (shuffle (cslice 1 2 3)) 0 }}', data, { random: () => 0 })).output, '2');
await fails('{{ randInt 5 5 }}', 'runtime', 'above');

// Text functions.
assert.equal(await out('{{ lower "AbC" }}{{ upper "abc" }}{{ str 5 }}{{ print "a" 1 true }}'), 'abcABC5a1true');
assert.equal(await out('{{ contains "hello" "ell" }} {{ hasPrefix "hello" "he" }} {{ hasSuffix "hello" "lo" }} {{ replace "aXbXc" "X" "-" }} {{ replace "abc" "" "-" }}'), 'true true true a-b-c abc');
assert.equal(await out('{{ printf "%s has %d (%.1f) %5s|%-5s| %t %q %x %%" "x" 3 2.5 "r" "l" 1 "q" 255 }}'), 'x has 3 (2.5)     r|l    | true "q" ff %');
assert.equal(await out('{{ printf "%d" }}'), '%!d(MISSING)');
assert.equal(await out('{{ len "héllo" }}{{ slice "hello" 1 3 }}{{ slice (cslice 1 2 3) 1 }}'), '5el[2 3]');

// Lists and maps.
assert.equal(await out('{{ $l := cslice 1 2 }}{{ $l = append $l 3 }}{{ $l }}{{ in $l 2 }}{{ in $l 9 }}'), '[1 2 3]truefalse');
assert.equal(await out('{{ join (keys (sdict "a" 1 "b" 2)) "," }}'), 'a,b');
await fails('{{ index (cslice 1) 5 }}', 'runtime', 'out of the list');
await fails('{{ dict "a" }}', 'runtime', 'pairs');

// Mentions, time.
assert.equal(await out('{{ mentionUser .User.ID }}{{ mentionRole "223456789012345678" }}{{ mentionChannel .Guild.ID }}'), '<@123456789012345678><@&223456789012345678><#323456789012345678>');
assert.equal(check('{{ mentionUser 123456789012345678 }}').kind, 'syntax', 'an ID written as a number would lose digits');
await fails('{{ mentionUser 12345 }}', 'runtime', 'in quotes');
await fails('{{ mentionUser "everyone" }}', 'runtime', 'Discord ID');
assert.equal(await out('{{ timestamp 1700000000 "R" }}{{ timestamp 1700000000 }}'), '<t:1700000000:R><t:1700000000:f>');
assert.equal((await run('{{ unix }}', data, { now: () => 5_000_000 })).output, '5000');
assert.equal(await out('{{ humanizeDuration 90061 }}|{{ humanizeDuration 0 }}'), '1d 1h 1m 1s|0s');
assert.equal(await out('{{ hasRole "223456789012345678" }}{{ hasRole "999999999999999999" }}'), 'truefalse');

// Effects: nothing is done, it is noted.
let result = await run('{{ sendMessage nil "hi" }}{{ sendMessage .User.ID (cembed "title" "T") }}{{ sendDM "psst" }}{{ addRole "223456789012345678" }}{{ removeRole "223456789012345678" }}{{ addReaction "👍" }}{{ deleteTrigger }}', data);
assert.deepEqual(result.effects.map((e) => e.type), ['message', 'message', 'dm', 'addRole', 'removeRole', 'reaction', 'deleteTrigger']);
assert.deepEqual(result.effects[0], { type: 'message', channelId: null, content: 'hi' });
assert.equal(result.effects[1].channelId, '123456789012345678');
assert.equal(result.output, '', 'a function that does something prints nothing');
result = await run('{{ sendMessage nil (complexMessage "content" "c" "embed" (cembed "description" "d")) }}', data);
assert.deepEqual(result.effects[0], { type: 'message', channelId: null, content: 'c', embed: { description: 'd' } });
await fails('{{ sendMessage nil "" }}', 'runtime', 'empty');
await fails('{{ sendMessage nil (dict "title" "x") }}', 'runtime', 'cembed');
await fails('{{ sendMessage "nope" "x" }}', 'runtime', 'Discord ID');
await fails('{{ range seq 0 6 }}{{ sendMessage nil "x" }}{{ end }}', 'limit', 'at most 5');
await fails('{{ sendDM "a" }}{{ sendDM "b" }}{{ sendDM "c" }}', 'limit', 'at most 2');

// Embeds.
const embed = (await run('{{ sendMessage nil (cembed "title" "Hi" "description" "Body" "color" "#ff91c2" "url" "https://petto.sbs" "footer" "f" "author" "a" "thumbnail" "https://x.test/t.png" "image" "https://x.test/i.png" "timestamp" true "fields" (cslice (cslice "n" "v" true) (cslice "n2" "v2"))) }}', data, { now: () => 0 })).effects[0].embed;
assert.deepEqual(embed, { title: 'Hi', description: 'Body', color: 16748994, url: 'https://petto.sbs', footer: { text: 'f' }, author: { name: 'a' }, thumbnail: { url: 'https://x.test/t.png' }, image: { url: 'https://x.test/i.png' }, timestamp: '1970-01-01T00:00:00.000Z', fields: [{ name: 'n', value: 'v', inline: true }, { name: 'n2', value: 'v2', inline: false }] });
await fails('{{ cembed "title" (printf "%300s" "x") }}', 'runtime', '256');
await fails('{{ cembed "color" 99999999 }}', 'runtime', 'color');
await fails('{{ cembed "url" "javascript:alert(1)" }}', 'runtime', 'http');
await fails('{{ cembed "nope" 1 }}', 'runtime', 'does not know');
await fails('{{ cembed "title" }}', 'runtime', 'pairs');
assert.equal((await run('{{ sendMessage nil (cembed "title" nil "description" "d") }}', data)).effects[0].embed.title, undefined, 'a nil value leaves a part out');

// Syntax mistakes say where.
for (const [code, text] of [
  ['{{ if }}x{{ end }}', 'empty'], ['{{ end }}', 'without a block'], ['{{ if true }}x', 'never closed'], ['x {{ foo', 'never closed'],
  ['{{ range .A }}x', 'never closed'], ['{{ else }}', 'outside'], ['{{ "abc }}', 'never closed'], ['{{ (add 1 2 }}', '( is never closed'],
  ['{{ $a := }}', 'empty'], ['{{ 1 2 }}', 'Only a function'], ['{{ @ }}', 'Unexpected character'], ['{{ foo "x" | }}', 'empty'],
]) {
  const problem = check(code);
  assert.ok(problem && problem.kind === 'syntax' && problem.message.toLowerCase().includes(text.toLowerCase()), `${code} -> ${JSON.stringify(problem)}`);
}
assert.equal(check('Hello {{ .User.ID }}'), null);
assert.equal(check('a\n  {{ @ }}').line, 2, 'a mistake says its line');
await fails('{{ nope 1 }}', 'runtime', 'no function called "nope"');
await fails('{{ add 1 }}', 'runtime', 'at least 2');
await fails('{{ add }}', 'runtime', 'at least 2');
await fails('{{ len 1 2 }}', 'runtime', '1 argument');
await fails('{{ .Nope.Deep }}', 'runtime', 'Cannot read .Deep of nil');
await fails('{{ add }}{{ .User.Username.X }}', 'runtime');

// Safety: nothing reaches the inside of JavaScript.
assert.equal(await out('{{ .User.constructor }}|{{ .User.__proto__ }}|{{ index .User "constructor" }}|{{ index .User "__proto__" }}'), '|||');
await fails('{{ dict "__proto__" 1 }}', 'runtime', 'cannot be a key');
assert.equal(await out('{{ .toString }}'), '');
await fails('{{ add 1 2 | }}', 'syntax');

// Stored data: it needs a store, and keys, users and values are checked.
const memory = () => {
  const map = new Map(); const calls = [];
  const id = (key, user) => `${user}|${key}`;
  return {
    calls,
    async get(key, user) { calls.push('get'); return map.has(id(key, user)) ? map.get(id(key, user)) : null; },
    async set(key, value, user, ttl) { calls.push(`set${ttl ? `:${ttl}` : ''}`); map.set(id(key, user), value); },
    async del(key, user) { calls.push('del'); map.delete(id(key, user)); },
    async incr(key, amount, user) { calls.push('incr'); const next = (map.get(id(key, user)) ?? 0) + amount; map.set(id(key, user), next); return next; },
    async top(key, limit) { calls.push('top'); return [...map.entries()].filter(([k]) => k.endsWith(`|${key}`) && !k.startsWith('|')).map(([k, v]) => ({ UserID: k.split('|')[0], Value: v })).sort((x, y) => y.Value - x.Value).slice(0, limit); },
    async keys(prefix, user) { calls.push('keys'); return [...map.keys()].filter((k) => k.startsWith(`${user}|`)).map((k) => k.slice(user.length + 1)).filter((k) => k.startsWith(prefix)).sort(); },
  };
};
const store = memory();
const withStore = async (code) => (await run(code, data, { store })).output;
assert.equal(await withStore('{{ dbSet "visits" 5 }}{{ dbGet "visits" }} {{ dbIncr "visits" 2 }} {{ dbGet "missing" }}|{{ dbDel "visits" }}{{ dbGet "visits" }}'), '5 7 |');
assert.equal(await withStore('{{ dbSet "note" (sdict "a" (cslice 1 2) "b" "x") }}{{ (dbGet "note").b }}{{ index (dbGet "note").a 1 }}'), 'x2');
assert.equal(await withStore('{{ dbIncr "points" 10 "123456789012345678" }}{{ dbIncr "points" 30 "223456789012345678" }}{{ dbIncr "points" 20 "323456789012345678" }}{{ range dbTop "points" 2 }}{{ .UserID }}={{ .Value }};{{ end }}'), '103020223456789012345678=30;323456789012345678=20;', 'dbIncr gives the new number, which prints');
assert.equal(await withStore('{{ dbSet "k1" 1 }}{{ dbSet "k2" 2 }}{{ dbSet "other" 3 }}{{ join (dbKeys "k") "," }}'), 'k1,k2');
assert.equal(await withStore('{{ dbSet "mine" "a" .User.ID }}{{ dbGet "mine" }}|{{ dbGet "mine" .User.ID }}'), '|a', 'data of a member is apart from the data of the server');
await withStore('{{ dbSetExpire "temp" 1 60 }}'); assert.ok(store.calls.includes('set:60'), 'an expiry is passed on');
await fails('{{ dbSet "k" 1 }}', 'runtime', 'not available here');
store.calls.length = 0;
for (const [code, text] of [
  ['{{ dbSet "bad key!" 1 }}', 'A key is a text'], ['{{ dbSet "" 1 }}', 'A key is a text'], ['{{ dbSet "k" 1 "nope" }}', 'Discord ID'],
  ['{{ dbSet "k" (cembed "title" "x") }}', 'cannot be stored'], ['{{ dbSetExpire "k" 1 0 }}', 'from 1 second'], ['{{ dbTop "k" 99 }}', 'from 1 to 25'],
  ['{{ dbSet "k" (join (seq 0 1000) ", ") }}', 'at most 4000'],
]) {
  try { await run(code, data, { store }); assert.fail(`${code} should fail`); } catch (error) { assert.ok(error instanceof PettoCodeError && error.message.includes(text), `${code}: ${error.message}`); }
}
assert.equal(store.calls.length, 0, 'a mistake in the arguments reaches no database');
try { await run('{{ range seq 0 30 }}{{ dbGet "k" }}{{ end }}', data, { store: memory() }); assert.fail('too many calls'); } catch (error) { assert.equal(error.kind, 'limit'); assert.ok(error.message.includes('at most 25')); }
// Waiting for the data does not count as running the code.
let clock = 0;
const slow = { ...memory(), async get() { clock += 1000; return 1; } };
const waited = await run('{{ dbGet "k" }}{{ dbGet "k" }}done', data, { store: slow, now: () => clock });
assert.equal(waited.output, '1' + '1' + 'done', 'two slow reads do not stop the code');

// Buttons and menus.
const rowCode = '{{ sendMessage nil (complexMessage "content" "Pick" "components" (cslice (crow (cbutton "label" "Yes" "id" "yes" "style" "success" "data" "a1") (cbutton "label" "Docs" "url" "https://petto.sbs") (cbutton "emoji" "👍" "id" "up" "disabled" true "user" "123456789012345678")))) }}';
const rows = (await run(rowCode, data)).effects[0].components;
assert.deepEqual(rows[0].items.map((item) => [item.label ?? item.emoji, item.handler ?? null, item.style, item.url ?? null]), [['Yes', 'yes', 3, null], ['Docs', null, 5, 'https://petto.sbs'], ['👍', 'up', 2, null]]);
assert.equal(rows[0].items[0].data, 'a1'); assert.equal(rows[0].items[2].disabled, true); assert.equal(rows[0].items[2].userId, '123456789012345678');
const menu = (await run('{{ sendMessage nil (complexMessage "components" (cslice (crow (cselect "id" "pick" "placeholder" "Choose" "min" 0 "max" 2 "options" (cslice (cslice "A" "a" "first") (cslice "B" "b")))))) }}', data)).effects[0].components[0].items[0];
assert.deepEqual([menu.type, menu.handler, menu.placeholder, menu.min, menu.max, menu.options.length, menu.options[0].description], ['select', 'pick', 'Choose', 0, 2, 2, 'first']);
for (const [code, text] of [
  ['{{ cbutton "label" "x" }}', 'needs an id'], ['{{ cbutton "id" "x" }}', 'label or an emoji'], ['{{ cbutton "label" "x" "id" "bad id" }}', 'id of 1 to 20'],
  ['{{ cbutton "label" "x" "id" "y" "style" "purple" }}', 'primary, secondary'], ['{{ cbutton "label" "x" "id" "y" "data" "has space" }}', 'data of a button'],
  ['{{ cbutton "label" "x" "url" "javascript:1" }}', 'http'], ['{{ cbutton "label" "x" "url" "https://a.test" "id" "y" }}', 'cannot also have an id'],
  ['{{ cbutton "label" "x" "id" "y" "nope" 1 }}', 'does not know'], ['{{ cbutton "label" (printf "%90s" "x") "id" "y" }}', '80'],
  ['{{ crow }}', '1 to 5 arguments'], ['{{ crow "text" }}', 'buttons made with cbutton'], ['{{ crow (cselect "id" "a" "options" (cslice (cslice "A" "a"))) (cbutton "label" "x" "id" "y") }}', 'whole row'],
  ['{{ cselect "id" "a" "options" (cslice) }}', '1 to 25'], ['{{ cselect "id" "a" "max" 3 "options" (cslice (cslice "A" "a")) }}', 'min is at least 0'],
  ['{{ sendMessage nil (complexMessage "components" (cslice (dict "a" 1))) }}', 'made with crow'], ['{{ sendDM (complexMessage "components" (cslice (crow (cbutton "label" "x" "id" "y")))) }}', 'cannot have buttons'],
  ['{{ respond "x" }}', 'button or a menu'], ['{{ updateMessage "x" }}', 'button or a menu'],
]) await fails(code, 'runtime', text);
await fails(`{{ sendMessage nil (complexMessage "components" (cslice ${'(crow (cbutton "label" "x" "id" "y")) '.repeat(6)})) }}`, 'runtime', 'at most 5 rows');
const clicked = (code, extra = {}) => run(code, { ...data, Trigger: 'button', Button: { ID: 'yes', Data: '' }, Values: [], ...extra });
let answer = await clicked('{{ respond "hi" true }}'); assert.deepEqual(answer.effects[0], { type: 'respond', content: 'hi', ephemeral: true });
answer = await clicked('{{ updateMessage (cembed "title" "T") }}'); assert.equal(answer.effects[0].type, 'update'); assert.equal(answer.effects[0].embed.title, 'T');
await assert.rejects(clicked('{{ respond "a" }}{{ respond "b" }}'), (error) => error.kind === 'limit');
assert.equal((await run('{{ .Trigger }}|{{ .Button }}|{{ len .Values }}', { Trigger: 'command', Button: null, Values: [] })).output, 'command||0');

// Limits.
const tooLong = await fails('{{ range seq 0 1000 }}{{ range seq 0 1000 }}x{{ end }}{{ end }}', 'limit');
assert.ok(/steps|turns|characters/.test(tooLong.message));
await fails('{{ $x := 0 }}{{ range seq 0 1000 }}{{ range seq 0 3 }}{{ $x = add $x 1 }}{{ end }}{{ end }}', 'limit', 'turns');
await fails('{{ range seq 0 1000 }}0123456789012345678901234567890123456789{{ end }}', 'limit');
await fails('{{ seq 0 5000 }}', 'runtime', '1000');
await fails('{{ $s := "x" }}{{ range seq 0 100 }}{{ $s = print $s $s }}{{ end }}', 'limit', 'too long');
await fails('x'.repeat(20) + '{{ range seq 0 1000 }}{{ end }}{{ "a" }}'.repeat(5), 'limit', null, { limits: { maxSteps: 50 } });
let tick = 0;
await fails('{{ range seq 0 300 }}{{ add 1 1 }}{{ end }}', 'limit', 'longer than', { now: () => { tick += 20; return tick; } });
await assert.rejects(run('x'.repeat(10_001)), (error) => error.kind === 'limit' && error.message.includes('too long'));
await fails('{{ (((((((((((((((((((((((add 1 2))))))))))))))))))))))) }}', 'syntax', 'parentheses');
assert.ok(functionNames().length > 50 && functionNames().includes('cembed'));

// Modals: the form of a button, its fields, and the mistakes.
{
  const click = { Trigger: 'button', Button: { ID: 'open', Data: '' } };
  const shown = await run('{{ showModal (cmodal "id" "form" "title" "Hi" "fields" (cslice (ctext "id" "name" "label" "Name"))) }}', { ...data, ...click });
  assert.equal(shown.effects[0].type, 'modal');
  assert.equal(shown.effects[0].modal.fields[0].style, 1, 'a field is short by default');
  assert.equal(shown.effects[0].modal.fields[0].required, true);
  const submitted = { Trigger: 'modal', Modal: { ID: 'form', Data: '' }, Fields: { name: 'Santi' } };
  assert.equal(await out('{{ .Fields.name }}', submitted), 'Santi', 'the fields of a modal are read with .Fields');
  const bad = async (code, extra, part) => { try { await run(code, { ...data, ...extra }); assert.fail(`${code} should fail`); } catch (error) { assert.match(error.detail ?? error.message, part, code); } };
  await bad('{{ showModal (cmodal "id" "f" "title" "T" "fields" (cslice (ctext "id" "a" "label" "A"))) }}', {}, /button or a menu/);
  await bad('{{ showModal (cmodal "id" "f" "title" "T" "fields" (cslice (ctext "id" "a" "label" "A"))) }}', { Trigger: 'modal' }, /button or a menu/);
  await bad('{{ cmodal "id" "f" "title" "T" "fields" (cslice) }}', click, /1 to 5/);
  await bad('{{ cmodal "id" "f" "title" "T" "fields" (cslice 1) }}', click, /ctext/);
  await bad('{{ ctext "id" "bad id" "label" "A" }}', click, /id of 1 to 20/);
  await bad('{{ ctext "id" "a" "label" "A" "style" "huge" }}', click, /short or paragraph/);
  await bad('{{ cmodal "id" "f" "title" "T" "fields" (cslice (ctext "id" "a" "label" "A") (ctext "id" "a" "label" "B")) }}', click, /two fields|Two fields/i);
  const answered = await run('{{ respond "ok" true }}', { ...data, ...submitted });
  assert.equal(answered.effects[0].type, 'respond', 'a modal can be answered');
}

console.log('Checked Petto Code: the syntax, the functions, the effects, the safety and the limits.');
})().catch((error) => { console.error(error); process.exit(1); });
