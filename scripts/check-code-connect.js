// Checks how commands of Petto Code are connected: callCC (the code of another command inside this one, by name or by number), getCC and listCC, templates
// (`define`, `template`, `execTemplate`) and `return value`, with their limits.
const assert = require('node:assert/strict');
const { run, parse, check, functionNames, DEFAULT_LIMITS } = require('../src/scripting');

for (const name of ['callCC', 'getCC', 'listCC', 'execTemplate']) assert.ok(functionNames().includes(name), `${name} exists`);
assert.equal(DEFAULT_LIMITS.maxCalls, 5);
assert.equal(DEFAULT_LIMITS.maxCallDepth, 3);

const commands = new Map([
  ['greet', { number: 75, name: 'greet', code: 'Hello {{ index .Args 0 }}!', trigger_type: 'command' }],
  ['double', { number: 76, name: 'double', code: '{{ return (mult (index .Args 0) 2) }}', trigger_type: 'command' }],
  ['whoami', { number: 77, name: 'whoami', code: '{{ .Cmd }} called by {{ .CalledBy }} with {{ .RawArgs }} ({{ len .Args }})', trigger_type: 'command' }],
  ['plain', { number: 78, name: 'plain', code: null, trigger_type: 'command' }],
  ['loop-a', { number: 79, name: 'loop-a', code: 'a{{ callCC "loop-b" }}', trigger_type: 'command' }],
  ['loop-b', { number: 80, name: 'loop-b', code: 'b{{ callCC "loop-a" }}', trigger_type: 'command' }],
  ['bad', { number: 81, name: 'bad', code: '{{ nope }}', trigger_type: 'command' }],
  ['syntax', { number: 82, name: 'syntax', code: '{{ if }}', trigger_type: 'command' }],
  ['level1', { number: 83, name: 'level1', code: '1{{ callCC "level2" }}', trigger_type: 'command' }],
  ['level2', { number: 84, name: 'level2', code: '2{{ callCC "level3" }}', trigger_type: 'command' }],
  ['level3', { number: 85, name: 'level3', code: '3{{ callCC "level4" }}', trigger_type: 'command' }],
  ['level4', { number: 86, name: 'level4', code: '4{{ callCC "level5" }}', trigger_type: 'command' }],
  ['level5', { number: 87, name: 'level5', code: '5', trigger_type: 'command' }],
  ['sender', { number: 88, name: 'sender', code: '{{ sendMessage nil (print "from sender: " (index .Args 0)) }}', trigger_type: 'command' }],
  ['locker', { number: 89, name: 'locker', code: '{{ lockChannel }}', trigger_type: 'command' }],
  ['shop', { number: 90, name: 'shop', code: 'x', trigger_type: 'contains', trigger_text: 'buy' }],
]);
const byRef = (ref) => {
  const text = String(ref);
  if (/^\d+$/.test(text)) return [...commands.values()].find((row) => row.number === Number(text)) ?? null;
  return commands.get(text) ?? null;
};
const mapOf = (row) => ({ Number: row.number, Name: row.name, HasCode: Boolean(row.code), Trigger: row.trigger_type, TriggerText: row.trigger_text ?? null });
const asked = [];
const cc = {
  async code(ref) { asked.push(ref); const row = byRef(ref); return row?.code ? { number: row.number, name: row.name, code: row.code } : null; },
  async get(ref) { const row = byRef(ref); return row ? mapOf(row) : null; },
  async list() { return [...commands.values()].map(mapOf); },
};
const data = { Cmd: 'main', Origin: 'command', Args: [], User: { ID: '1', Username: 'liam' }, Channel: { ID: '200000000000000001' } };
const out = async (code, extra = {}, options = {}) => (await run(code, { ...data, ...extra }, { cc, command: 'main', ...options })).output;
const fails = async (code, includes, options = {}) => {
  try { await run(code, data, { cc, command: 'main', ...options }); } catch (error) {
    assert.ok(error.message.includes(includes), `"${error.message}" should say "${includes}" for ${code}`);
    return error;
  }
  return assert.fail(`${code} should have failed`);
};

(async () => {
  // Calling a command: by name, by number, with arguments; what it prints is the answer.
  assert.equal(await out('{{ callCC "greet" "Liam" }}'), 'Hello Liam!');
  assert.equal(await out('{{ callCC 75 "Mara" }}'), 'Hello Mara!', 'by number');
  assert.equal(await out('{{ callCC "75" "Kai" }}'), 'Hello Kai!', 'a number as text');
  assert.equal(await out('{{ callCC "!Greet" "Noa" }}'), 'Hello Noa!', 'a prefix and capitals are ignored');
  assert.equal(await out('{{ $x := callCC "greet" "A" }}[{{ $x }}]'), '[Hello A!]', 'it can be kept in a variable');
  assert.equal(await out('{{ callCC "greet" "A" | upper }}'), 'HELLO A!', 'and piped');
  // return value: the value, not the text
  assert.equal(await out('{{ callCC "double" 21 }}'), '42');
  assert.equal(await out('{{ add (callCC "double" 4) 1 }}'), '9', 'it is a value, a number here');
  // what the command knows
  assert.equal(await out('{{ callCC "whoami" "a" "b c" }}'), 'whoami called by main with a b c (2)');
  assert.equal(await out('{{ callCC "whoami" }}', { Cmd: 'shop' }), 'whoami called by shop with  (0)');
  // the caller keeps its own data
  assert.equal(await out('{{ .Cmd }} {{ callCC "whoami" 1 }} {{ .Cmd }} {{ len .Args }}', { Args: ['x'] }), 'main whoami called by main with 1 (1) main 1', 'the arguments of the caller are not touched');
  // it can use the results together
  assert.equal(await out('{{ callCC "greet" (callCC "double" 3) }}'), 'Hello 6!');
  assert.equal(await out('{{ range seq 0 3 }}{{ callCC "greet" . }};{{ end }}'), 'Hello 0!;Hello 1!;Hello 2!;');
  // mistakes
  await fails('{{ callCC "ghost" }}', 'There is no command with code called "ghost"');
  await fails('{{ callCC "plain" }}', 'There is no command with code called "plain"');
  await fails('{{ callCC "bad name!" }}', 'name');
  await fails('{{ callCC "greet" "A" }}', 'cannot be read here', { cc: undefined });
  await fails('{{ callCC "loop-a" }}', 'already running', { command: 'main' });
  await fails('{{ callCC "greet" "x" }}', 'already running', { command: 'greet' });
  const inner = await fails('{{ callCC "bad" }}', 'In the command "bad"');
  assert.match(inner.message, /There is no function called "nope"/);
  await fails('{{ callCC "syntax" }}', 'In the command "syntax"');
  // depth: A calls B, B calls C, C calls D is allowed; one more is not
  assert.equal(await out('{{ callCC "level3" }}'), '345', 'a chain of three works');
  await fails('{{ callCC "level1" }}', 'at most 3 levels');
  // calls per run
  await fails('{{ range seq 0 6 }}{{ callCC "greet" . }}{{ end }}', 'at most 5');
  // reads count as reads (10), and give maps
  assert.equal(await out('{{ $c := getCC 75 }}{{ $c.Name }} #{{ $c.Number }} {{ $c.HasCode }} {{ $c.Trigger }}'), 'greet #75 true command');
  assert.equal(await out('{{ (getCC "plain").HasCode }} {{ (getCC "shop").Trigger }} {{ (getCC "shop").TriggerText }}'), 'false contains buy');
  assert.equal(await out('{{ getCC "ghost" }}|{{ getCC 999 }}|'), '||');
  assert.equal(await out('{{ len (listCC) }} {{ (index (listCC) 0).Name }}'), `${commands.size} greet`);
  await fails('{{ range seq 0 12 }}{{ getCC 75 }}{{ end }}', 'at most 10');
  // the actions of the called command join the actions of this one, with the same limits
  const sent = await run('{{ callCC "sender" "one" }}{{ callCC "sender" "two" }}{{ sendMessage nil "main" }}', data, { cc, command: 'main' });
  assert.deepEqual(sent.effects.map((effect) => effect.content), ['from sender: one', 'from sender: two', 'main']);
  await fails('{{ range seq 0 6 }}{{ sendMessage nil "x" }}{{ end }}', 'at most 5');
  // what started the code is kept, so a typed command cannot get around the rule of the tools that copy a command of Petto
  await fails('{{ callCC "locker" }}', 'only works in a button, a menu, a form or a reaction', { cc });
  assert.equal((await run('{{ callCC "locker" }}', { ...data, Origin: 'button' }, { cc, command: 'main' })).effects.length, 1, 'from a button it works');

  // return without a value still ends the code; return with a value ends it and gives the value
  assert.equal(await out('a{{ return }}b'), 'a');
  assert.equal(await out('a{{ return 5 }}b'), 'a', 'at the top it only ends the code');
  assert.equal(parse('{{ return (add 1 2) }}').nodes[0].pipeline.length, 1);

  // Templates: `define` at the top, `template` runs it where it stands, `execTemplate` gives back its value
  assert.equal(await out('{{ define "greet" }}Hi {{ . }}!{{ end }}{{ template "greet" "Liam" }} and {{ template "greet" .User.Username }}'), 'Hi Liam! and Hi liam!');
  assert.equal(await out('{{ define "double" }}{{ return (mult . 2) }}{{ end }}{{ execTemplate "double" 21 }}|{{ add (execTemplate "double" 4) 1 }}'), '42|9');
  assert.equal(await out('{{ define "text" }}a{{ . }}b{{ end }}{{ $t := execTemplate "text" 1 }}[{{ $t }}]'), '[a1b]', 'what it prints is its value when it returns nothing');
  assert.equal(await out('{{ define "line" }}{{ .name }}: {{ .score }}{{ end }}{{ range cslice (dict "name" "a" "score" 1) (dict "name" "b" "score" 2) }}{{ template "line" . }};{{ end }}'), 'a: 1;b: 2;');
  assert.equal(await out('{{ define "early" }}x{{ return }}y{{ end }}{{ template "early" }}z'), 'xz', 'return ends the template, not the code');
  assert.equal(await out('{{ define "a" }}A{{ template "b" }}{{ end }}{{ define "b" }}B{{ end }}{{ template "a" }}'), 'AB', 'a template can use another');
  assert.equal(await out('{{ define "noargs" }}{{ . }}|{{ end }}{{ template "noargs" }}'), '|', 'no value is nil');
  assert.equal(await out('{{ $x := "outer" }}{{ define "scope" }}{{ if . }}{{ . }}{{ else }}empty{{ end }}{{ end }}{{ template "scope" }}'), 'empty', 'a template does not see the variables outside');
  await fails('{{ template "ghost" }}', 'There is no template called "ghost"');
  await fails('{{ define "loop" }}{{ template "loop" }}{{ end }}{{ template "loop" }}', 'at most 8 levels');
  // the parse of a define
  assert.match(check('{{ if true }}{{ define "a" }}{{ end }}{{ end }}').message, /"define" goes at the top/);
  assert.match(check('{{ define a }}{{ end }}').message, /"define" needs the name/);
  assert.match(check('{{ define "a" }}x').message, /never closed/);
  assert.match(check('{{ define "a" }}{{ end }}{{ define "a" }}{{ end }}').message, /defined twice/);
  assert.match(check('{{ template a }}').message, /"template" needs the name/);
  assert.equal(check('{{ define "a" }}x{{ end }}{{ template "a" }}'), null);
  // a template of the called command is its own
  commands.set('withdef', { number: 91, name: 'withdef', code: '{{ define "t" }}inner{{ end }}{{ template "t" }}', trigger_type: 'command' });
  assert.equal(await out('{{ define "t" }}outer{{ end }}{{ callCC "withdef" }} {{ template "t" }}'), 'inner outer', 'each command keeps its own templates');

  console.log('Checked how commands are connected: callCC by name and number, getCC, listCC, return values, templates and their limits.');
})().catch((error) => { console.error(error); process.exit(1); });
