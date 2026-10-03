// Checks Petto Code, the template language of custom commands: the syntax, the functions, the effects, the safety, and the limits.
const assert = require('node:assert/strict');
const { run, check, PettoCodeError, functionNames } = require('../src/scripting');

const data = {
  User: { ID: '123456789012345678', Username: 'Liam', Mention: '<@123456789012345678>' },
  Member: { RoleIDs: ['223456789012345678'] },
  Guild: { ID: '323456789012345678', Name: 'Petto HQ', MemberCount: 90 },
  Args: ['5', 'three', '7'],
};
const out = (code, extra = {}, options = {}) => run(code, { ...data, ...extra }, options).output;
const fails = (code, kind, includes, options) => {
  try { run(code, data, options); } catch (error) {
    assert.ok(error instanceof PettoCodeError, `a PettoCodeError for ${code}`);
    assert.equal(error.kind, kind, `${kind} for ${code}: ${error.message}`);
    if (includes) assert.ok(error.message.includes(includes), `"${error.message}" should say "${includes}"`);
    return error;
  }
  return assert.fail(`${code} should have failed`);
};

// Text, printing and values.
assert.equal(out('Hello {{ .User.Username }}!'), 'Hello Liam!');
assert.equal(out('{{ .Guild.MemberCount }} {{ true }} {{ nil }}|{{ 1.5 }} {{ "a\\nb" }} {{ `raw\\n` }}'), '90 true |1.5 a\nb raw\\n');
assert.equal(out('{{/* a comment */}}x{{- /* trimmed */ -}}  y'), 'xy');
assert.equal(out('a  {{- "b" -}}  c'), 'abc', 'the trim markers take away the white space');
assert.equal(out('{{ .Args }} {{ index .Args 1 }} {{ len .Args }}'), '[5 three 7] three 3');
assert.equal(out('{{ (dict "a" 1 "b" 2).b }} {{ index (dict "k" "v") "k" }}'), '2 v');

// Variables, assignment and scope.
assert.equal(out('{{ $x := 1 }}{{ $x = add $x 4 }}{{ $x }}'), '5');
assert.equal(out('{{ $x := 1 }}{{ if true }}{{ $x = 2 }}{{ $y := 9 }}{{ end }}{{ $x }}'), '2', 'an inner block changes the outer variable');
fails('{{ if true }}{{ $y := 9 }}{{ end }}{{ $y }}', 'runtime', '$y is not defined');
fails('{{ $z = 1 }}', 'runtime', 'not defined');
assert.equal(out('{{ range .L }}{{ $.Name }}{{ end }}', { L: [1, 2], Name: 'n' }), 'nn', '$ is the data in any block');

// Conditions.
assert.equal(out('{{ if eq (index .Args 0) "5" }}five{{ else if gt (toInt (index .Args 0)) 9 }}big{{ else }}other{{ end }}'), 'five');
assert.equal(out('{{ if .Missing }}a{{ else if .User.Username }}b{{ else }}c{{ end }}', { Missing: null }), 'b');
assert.equal(out('{{ if and 1 "" }}t{{ else }}f{{ end }}{{ if or 0 "x" }}t{{ end }}{{ if not 0 }}n{{ end }}'), 'ftn');
assert.equal(out('{{ if eq 1 2 3 1 }}in{{ end }}{{ if ne "a" "b" }}ne{{ end }}{{ if lt 1 2 }}lt{{ end }}{{ if ge "b" "a" }}ge{{ end }}'), 'inneltge');
assert.equal(out('{{ with .User }}{{ .Username }}{{ else }}none{{ end }}{{ with .Nope }}x{{ else }}none{{ end }}', { Nope: null }), 'Liamnone');
fails('{{ lt 1 "a" }}', 'runtime', 'Cannot compare');

// Loops.
assert.equal(out('{{ range $i, $v := .Args }}{{ $i }}={{ $v }};{{ end }}'), '0=5;1=three;2=7;');
assert.equal(out('{{ range .Args }}{{ . }},{{ end }}'), '5,three,7,');
assert.equal(out('{{ range $v := seq 0 6 }}{{ if eq $v 2 }}{{ continue }}{{ end }}{{ if eq $v 4 }}{{ break }}{{ end }}{{ $v }}{{ end }}'), '013');
assert.equal(out('{{ range .Empty }}x{{ else }}empty{{ end }}', { Empty: [] }), 'empty');
assert.equal(out('{{ range $k, $v := .M }}{{ $k }}{{ $v }}{{ end }}', { M: { b: 2, a: 1 } }), 'a1b2', 'a map is walked in the order of its keys');
assert.equal(out('a{{ return }}b'), 'a', 'return ends the code');
fails('{{ break }}', 'runtime', 'inside a range');

// Pipes and parentheses.
assert.equal(out('{{ "  hello world " | trim | title }}'), 'Hello World');
assert.equal(out('{{ 3 | add 4 | mult 2 }}'), '14', 'the value of a pipe is the last argument');
assert.equal(out('{{ sub 10 (mult 2 3) }}'), '4');
assert.equal(out('{{ join (split "a-b-c" "-") "+" }}'), 'a+b+c');
assert.equal(out('{{ "-" | split "a-b" | len }}'), '2', 'the value of a pipe is the last argument, as in Go templates');

// Math and conversions.
assert.equal(out('{{ add 1 2 3 }} {{ sub 10 1 2 }} {{ mult 2 3 4 }} {{ div 9 2 }} {{ mod 9 4 }} {{ pow 2 10 }} {{ floor 2.7 }} {{ ceil 2.1 }} {{ round 2.5 }} {{ abs -3 }} {{ min 4 2 9 }} {{ max 4 2 9 }}'), '6 7 24 4.5 1 1024 2 3 3 3 2 9');
assert.equal(out('{{ add (index .Args 0) (index .Args 2) }}'), '12', 'the text of an argument that is a number works in math');
assert.equal(out('{{ toInt "42abc" }}|{{ toInt " 7 " }}|{{ toInt 3.9 }}|{{ toFloat "2.5" }}'), '0|7|3|2.5');
fails('{{ div 1 0 }}', 'runtime', 'divide by zero');
fails('{{ add 1 "x" }}', 'runtime', 'Expected a number');
assert.equal(run('{{ randInt 5 6 }}{{ randInt 3 }}', data, { random: () => 0 }).output, '50');
assert.equal(run('{{ index (shuffle (cslice 1 2 3)) 0 }}', data, { random: () => 0 }).output, '2');
fails('{{ randInt 5 5 }}', 'runtime', 'above');

// Text functions.
assert.equal(out('{{ lower "AbC" }}{{ upper "abc" }}{{ str 5 }}{{ print "a" 1 true }}'), 'abcABC5a1true');
assert.equal(out('{{ contains "hello" "ell" }} {{ hasPrefix "hello" "he" }} {{ hasSuffix "hello" "lo" }} {{ replace "aXbXc" "X" "-" }} {{ replace "abc" "" "-" }}'), 'true true true a-b-c abc');
assert.equal(out('{{ printf "%s has %d (%.1f) %5s|%-5s| %t %q %x %%" "x" 3 2.5 "r" "l" 1 "q" 255 }}'), 'x has 3 (2.5)     r|l    | true "q" ff %');
assert.equal(out('{{ printf "%d" }}'), '%!d(MISSING)');
assert.equal(out('{{ len "héllo" }}{{ slice "hello" 1 3 }}{{ slice (cslice 1 2 3) 1 }}'), '5el[2 3]');

// Lists and maps.
assert.equal(out('{{ $l := cslice 1 2 }}{{ $l = append $l 3 }}{{ $l }}{{ in $l 2 }}{{ in $l 9 }}'), '[1 2 3]truefalse');
assert.equal(out('{{ join (keys (sdict "a" 1 "b" 2)) "," }}'), 'a,b');
fails('{{ index (cslice 1) 5 }}', 'runtime', 'out of the list');
fails('{{ dict "a" }}', 'runtime', 'pairs');

// Mentions, time.
assert.equal(out('{{ mentionUser .User.ID }}{{ mentionRole "223456789012345678" }}{{ mentionChannel .Guild.ID }}'), '<@123456789012345678><@&223456789012345678><#323456789012345678>');
assert.equal(check('{{ mentionUser 123456789012345678 }}').kind, 'syntax', 'an ID written as a number would lose digits');
fails('{{ mentionUser 12345 }}', 'runtime', 'in quotes');
fails('{{ mentionUser "everyone" }}', 'runtime', 'Discord ID');
assert.equal(out('{{ timestamp 1700000000 "R" }}{{ timestamp 1700000000 }}'), '<t:1700000000:R><t:1700000000:f>');
assert.equal(run('{{ unix }}', data, { now: () => 5_000_000 }).output, '5000');
assert.equal(out('{{ humanizeDuration 90061 }}|{{ humanizeDuration 0 }}'), '1d 1h 1m 1s|0s');
assert.equal(out('{{ hasRole "223456789012345678" }}{{ hasRole "999999999999999999" }}'), 'truefalse');

// Effects: nothing is done, it is noted.
let result = run('{{ sendMessage nil "hi" }}{{ sendMessage .User.ID (cembed "title" "T") }}{{ sendDM "psst" }}{{ addRole "223456789012345678" }}{{ removeRole "223456789012345678" }}{{ addReaction "👍" }}{{ deleteTrigger }}', data);
assert.deepEqual(result.effects.map((e) => e.type), ['message', 'message', 'dm', 'addRole', 'removeRole', 'reaction', 'deleteTrigger']);
assert.deepEqual(result.effects[0], { type: 'message', channelId: null, content: 'hi' });
assert.equal(result.effects[1].channelId, '123456789012345678');
assert.equal(result.output, '', 'a function that does something prints nothing');
result = run('{{ sendMessage nil (complexMessage "content" "c" "embed" (cembed "description" "d")) }}', data);
assert.deepEqual(result.effects[0], { type: 'message', channelId: null, content: 'c', embed: { description: 'd' } });
fails('{{ sendMessage nil "" }}', 'runtime', 'empty');
fails('{{ sendMessage nil (dict "title" "x") }}', 'runtime', 'cembed');
fails('{{ sendMessage "nope" "x" }}', 'runtime', 'Discord ID');
fails('{{ range seq 0 6 }}{{ sendMessage nil "x" }}{{ end }}', 'limit', 'at most 5');
fails('{{ sendDM "a" }}{{ sendDM "b" }}{{ sendDM "c" }}', 'limit', 'at most 2');

// Embeds.
const embed = run('{{ sendMessage nil (cembed "title" "Hi" "description" "Body" "color" "#ff91c2" "url" "https://petto.sbs" "footer" "f" "author" "a" "thumbnail" "https://x.test/t.png" "image" "https://x.test/i.png" "timestamp" true "fields" (cslice (cslice "n" "v" true) (cslice "n2" "v2"))) }}', data, { now: () => 0 }).effects[0].embed;
assert.deepEqual(embed, { title: 'Hi', description: 'Body', color: 16748994, url: 'https://petto.sbs', footer: { text: 'f' }, author: { name: 'a' }, thumbnail: { url: 'https://x.test/t.png' }, image: { url: 'https://x.test/i.png' }, timestamp: '1970-01-01T00:00:00.000Z', fields: [{ name: 'n', value: 'v', inline: true }, { name: 'n2', value: 'v2', inline: false }] });
fails('{{ cembed "title" (printf "%300s" "x") }}', 'runtime', '256');
fails('{{ cembed "color" 99999999 }}', 'runtime', 'color');
fails('{{ cembed "url" "javascript:alert(1)" }}', 'runtime', 'http');
fails('{{ cembed "nope" 1 }}', 'runtime', 'does not know');
fails('{{ cembed "title" }}', 'runtime', 'pairs');
assert.equal(run('{{ sendMessage nil (cembed "title" nil "description" "d") }}', data).effects[0].embed.title, undefined, 'a nil value leaves a part out');

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
fails('{{ nope 1 }}', 'runtime', 'no function called "nope"');
fails('{{ add 1 }}', 'runtime', 'at least 2');
fails('{{ add }}', 'runtime', 'at least 2');
fails('{{ len 1 2 }}', 'runtime', '1 argument');
fails('{{ .Nope.Deep }}', 'runtime', 'Cannot read .Deep of nil');
fails('{{ add }}{{ .User.Username.X }}', 'runtime');

// Safety: nothing reaches the inside of JavaScript.
assert.equal(out('{{ .User.constructor }}|{{ .User.__proto__ }}|{{ index .User "constructor" }}|{{ index .User "__proto__" }}'), '|||');
fails('{{ dict "__proto__" 1 }}', 'runtime', 'cannot be a key');
assert.equal(out('{{ .toString }}'), '');
fails('{{ add 1 2 | }}', 'syntax');

// Limits.
const tooLong = fails('{{ range seq 0 1000 }}{{ range seq 0 1000 }}x{{ end }}{{ end }}', 'limit');
assert.ok(/steps|turns|characters/.test(tooLong.message));
fails('{{ $x := 0 }}{{ range seq 0 1000 }}{{ range seq 0 3 }}{{ $x = add $x 1 }}{{ end }}{{ end }}', 'limit', 'turns');
fails('{{ range seq 0 1000 }}0123456789012345678901234567890123456789{{ end }}', 'limit');
fails('{{ seq 0 5000 }}', 'runtime', '1000');
fails('{{ $s := "x" }}{{ range seq 0 100 }}{{ $s = print $s $s }}{{ end }}', 'limit', 'too long');
fails('x'.repeat(20) + '{{ range seq 0 1000 }}{{ end }}{{ "a" }}'.repeat(5), 'limit', null, { limits: { maxSteps: 50 } });
let tick = 0;
fails('{{ range seq 0 300 }}{{ add 1 1 }}{{ end }}', 'limit', 'longer than', { now: () => { tick += 20; return tick; } });
assert.throws(() => run('x'.repeat(10_001)), (error) => error.kind === 'limit' && error.message.includes('too long'));
fails('{{ (((((((((((((((((((((((add 1 2))))))))))))))))))))))) }}', 'syntax', 'parentheses');
assert.ok(functionNames().length > 50 && functionNames().includes('cembed'));

console.log('Checked Petto Code: the syntax, the functions, the effects, the safety and the limits.');
