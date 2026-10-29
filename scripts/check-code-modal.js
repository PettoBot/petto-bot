// Checks the parts a form of Petto Code can have besides ctext (cmenu, cusers, croles, cmentions, cchannels, cfile, cradio, cchecks, ccheck, cdisplay):
// what the code may write, the modal that discord.js builds from it, and what a submitted form gives back (.Fields, .FieldText and .Files).
const assert = require('node:assert/strict');
const path = require('node:path');
const { Collection, ComponentType } = require('discord.js');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
stub('src/config.js', { ownerId: 'owner', developerIds: [], codeCommandsDisabled: false });
stub('src/utils/logger.js', { info() {}, warn() {}, error() {} });
stub('src/handlers/prefixInteraction.js', { tokenize: (text) => String(text).split(/\s+/) });
stub('src/db/database.js', { from: () => { throw new Error('no database'); } });
stub('src/db/commandData.js', { forGuild: () => ({}) });
const codeCommands = require('../src/utils/codeCommands');
const { run, PettoCodeError } = require('../src/scripting');

const data = { Trigger: 'button', User: { ID: '1' } };
const modalOf = async (fields) => {
  const result = await run(`{{ showModal (cmodal "id" "form" "title" "A form" "fields" (cslice ${fields})) }}`, data, {});
  return result.effects.find((effect) => effect.type === 'modal').modal;
};
const built = async (fields) => codeCommands.buildModal(await modalOf(fields), 'demo').toJSON();
const refused = async (fields, what) => assert.rejects(modalOf(fields), (error) => error instanceof PettoCodeError && error.message.includes(what) || (console.error(error.message), false));

(async () => {
  // Every part of a form goes under a label; a text that only informs goes alone.
  const json = await built(`
    (cdisplay "Read this first")
    (ctext "id" "name" "label" "Name" "description" "Your nickname")
    (cmenu "id" "color" "label" "Color" "options" (cslice (cslice "Pink" "pink" "Soft" true) (cslice "Blue" "blue")) "max" 2)
    (cusers "id" "friends" "label" "Friends" "max" 3 "required" false)
    (cchannels "id" "room" "label" "Room" "types" (cslice "text" "voice" "thread"))`.replace(/\n\s*/g, ' '));
  assert.deepEqual(json.components.map((part) => part.type), [10, 18, 18, 18, 18], 'a text display and four labels');
  assert.deepEqual(json.components[0], { type: 10, content: 'Read this first' });
  assert.deepEqual([json.components[1].label, json.components[1].description, json.components[1].component.type, json.components[1].component.custom_id], ['Name', 'Your nickname', ComponentType.TextInput, 'name']);
  const menu = json.components[2].component;
  assert.deepEqual([menu.type, menu.min_values, menu.max_values, menu.required, menu.options.length, menu.options[0].default], [ComponentType.StringSelect, 1, 2, true, 2, true]);
  const users = json.components[3].component;
  assert.deepEqual([users.type, users.min_values, users.max_values, users.required], [ComponentType.UserSelect, 0, 3, false], 'a part that is not required may be left empty');
  assert.deepEqual(json.components[4].component.channel_types, [0, 2, 10, 11, 12]);

  const second = await built(`
    (croles "id" "role" "label" "Role")
    (cmentions "id" "who" "label" "Who" "required" false)
    (cfile "id" "proof" "label" "Proof" "max" 3 "description" "A picture")
    (cradio "id" "mood" "label" "Mood" "options" (cslice (cslice "Happy" "happy" "" true) (cslice "Sad" "sad")))
    (cchecks "id" "likes" "label" "Likes" "options" (cslice (cslice "Cats" "cats") (cslice "Dogs" "dogs") (cslice "Birds" "birds")) "min" 1 "max" 2)`.replace(/\n\s*/g, ' '));
  assert.deepEqual(second.components.map((part) => part.component.type), [ComponentType.RoleSelect, ComponentType.MentionableSelect, ComponentType.FileUpload, ComponentType.RadioGroup, ComponentType.CheckboxGroup]);
  assert.deepEqual([second.components[2].component.min_values, second.components[2].component.max_values], [1, 3]);
  assert.equal(second.components[3].component.options[0].default, true);
  assert.deepEqual([second.components[4].component.min_values, second.components[4].component.max_values], [1, 2]);
  const single = await built('(ccheck "id" "agree" "label" "I agree" "default" true)');
  assert.deepEqual([single.components[0].component.type, single.components[0].component.default], [ComponentType.Checkbox, true]);

  // Mistakes are told, not sent to Discord.
  await refused('(cdisplay "only text")', 'at least one part');
  await refused('(ctext "id" "a" "label" "A") (ctext "id" "a" "label" "B")', 'the id "a"');
  await refused('(cradio "id" "r" "label" "R" "options" (cslice (cslice "One" "1")))', '2 to 10');
  await refused('(cradio "id" "r" "label" "R" "options" (cslice (cslice "One" "1" "" true) (cslice "Two" "2" "" true)))', 'Only one radio');
  await refused('(cmenu "id" "m" "label" "M" "options" (cslice (cslice "A" "x") (cslice "B" "x")))', 'the value "x"');
  await refused('(cchannels "id" "c" "label" "C" "types" (cslice "sofa"))', 'kinds of channel');
  await refused('(cfile "id" "f" "label" "F" "max" 11)', 'max is from 1 to 10');
  await refused('(cusers "id" "u" "label" "U" "color" "red")', 'does not know "color"');
  await refused('(ctext "id" "a" "label" "A") (ctext "id" "b" "label" "B") (ctext "id" "c" "label" "C") (ctext "id" "d" "label" "D") (ctext "id" "e" "label" "E") (ctext "id" "f" "label" "F")', '1 to 5');

  // What a submitted form gives back.
  const attachment = { id: '9', name: 'proof.png', url: 'https://cdn.discordapp.com/attachments/1/2/proof.png', size: 2048, contentType: 'image/png', description: null };
  const fields = new Collection([
    ['name', { type: ComponentType.TextInput, customId: 'name', value: 'Liam' }],
    ['color', { type: ComponentType.StringSelect, customId: 'color', values: ['pink', 'blue'] }],
    ['friends', { type: ComponentType.UserSelect, customId: 'friends', values: ['111', '222'] }],
    ['role', { type: ComponentType.RoleSelect, customId: 'role', values: ['333'] }],
    ['room', { type: ComponentType.ChannelSelect, customId: 'room', values: ['444'] }],
    ['who', { type: ComponentType.MentionableSelect, customId: 'who', values: ['555', '666'], roles: new Collection([['666', {}]]) }],
    ['proof', { type: ComponentType.FileUpload, customId: 'proof', values: ['9'], attachments: new Collection([['9', attachment]]) }],
    ['mood', { type: ComponentType.RadioGroup, customId: 'mood', value: null }],
    ['likes', { type: ComponentType.CheckboxGroup, customId: 'likes', values: ['cats'] }],
    ['agree', { type: ComponentType.Checkbox, customId: 'agree', value: true }],
  ]);
  const got = codeCommands.submittedFields(fields);
  assert.deepEqual([got.Fields.name, got.Fields.color, got.Fields.friends, got.Fields.mood, got.Fields.likes, got.Fields.agree], ['Liam', ['pink', 'blue'], ['111', '222'], '', ['cats'], true]);
  assert.deepEqual(got.Fields.proof, [{ ID: '9', Name: 'proof.png', URL: attachment.url, Size: 2048, Type: 'image/png', Description: '' }]);
  assert.deepEqual(got.Files, got.Fields.proof, 'every file of the form is also in .Files');
  assert.deepEqual([got.FieldText.color, got.FieldText.friends, got.FieldText.role, got.FieldText.room, got.FieldText.who, got.FieldText.agree], ['pink, blue', '<@111> <@222>', '<@&333>', '<#444>', '<@555> <@&666>', '✅']);
  assert.equal(got.FieldText.proof, attachment.url);
  // The code reads them like any other data.
  const printed = await run('{{ .Fields.name }} {{ index .Fields.color 1 }} {{ .FieldText.friends }} {{ if .Fields.agree }}agreed{{ end }} {{ (index .Files 0).Name }}', { Trigger: 'modal', ...got }, {});
  assert.equal(printed.output, 'Liam blue <@111> <@222> agreed proof.png');
  assert.ok(codeCommands.dataFields().top.includes('FieldText') && codeCommands.dataFields().top.includes('Files'), 'the editor knows the new names');
  console.log('Checked the parts of a form of Petto Code and what a submitted form gives back.');
})().catch((error) => { console.error(error); process.exit(1); });
