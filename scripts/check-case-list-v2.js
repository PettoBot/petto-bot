// The list of cases (`case list`): one section per case with a picture, the alert for a warning, the hammer for every other sanction, the question coin for
// what is not known (a type, a deleted member or moderator), no big titles, and a page that fits the 40 components a message can hold.
process.env.DISCORD_TOKEN ||= 'check-only';
const assert = require('node:assert/strict');
const { buildCaseListCard } = require('../src/utils/caseCard');
const { EMOJI } = require('../src/utils/emojis');

const now = Date.now();
const row = (n, type, extra = {}) => ({ case_number: n, type, user_id: `10${n}`, moderator_id: `20${n}`, reason: `reason ${n}`, created_at: new Date(now - n * 3600_000).toISOString(), expires_at: null, active: true, ...extra });
const rows = [row(6, 'warn'), row(5, 'ban'), row(4, 'tempmute', { expires_at: new Date(now + 3600_000).toISOString() }), row(3, 'softban'), row(2, 'unmute'), row(1, 'something-new')];
const known = (id) => [id, { id, known: true, avatarUrl: `https://cdn.example/${id}.png` }];
const people = new Map([...rows.flatMap((r) => [r.user_id, r.moderator_id]).filter((id) => id !== '103' && id !== '205').map(known), ['103', { id: '103', known: false, avatarUrl: null }], ['205', { id: '205', known: false, avatarUrl: null }]]);
const guild = { name: 'Petto Land', iconURL: () => 'https://cdn.example/guild.png' };

const count = (node) => 1 + (node.components ?? []).reduce((total, child) => total + count(child), 0) + (node.accessory ? 1 : 0);
const card = buildCaseListCard({ rows, count: 20, page: 0, perPage: 6, guild, people, ids: { previous: 'p', next: 'n' }, lang: 'en' }).toJSON();
const json = JSON.stringify(card);
assert.ok(count(card) <= 40, `a page of six cases fits what a message can hold (${count(card)} components)`);
assert.ok(!/"content":"#{1,3} /.test(json) && !json.includes('\\n#'), 'no title or subtitle of any size');
const sections = card.components.filter((component) => component.type === 9);
assert.equal(sections.length, 1 + rows.length, 'the header and one section for each case');
assert.ok(sections.every((section) => section.accessory?.type === 11), 'every section has its picture');
const texts = sections.slice(1).map((section) => section.components[0].content);

assert.ok(texts[0].startsWith(`**${EMOJI.PETTO_ALERT} #6 · Warn`), 'a warning has the alert');
for (const i of [1, 2, 3, 4]) assert.ok(texts[i].startsWith(`**${EMOJI.HAMMER} #`), `${rows[i].type} has the hammer`);
assert.ok(texts[5].startsWith(`**${EMOJI.PETTO_QUESTION} #1 · something-new`), 'a type that is not known has the question coin');
assert.ok(texts[3].includes(`${EMOJI.PETTO_QUESTION} Unknown user`), 'a deleted member is unknown');
assert.ok(!texts[3].includes('<@103>'), 'the mention of an unknown member is not written');
assert.ok(texts[3].includes('by <@203>'), 'a known moderator is mentioned');
assert.ok(texts[1].includes('<@105>'), 'a known member is mentioned');
assert.ok(texts[1].includes(`by ${EMOJI.PETTO_QUESTION} Unknown moderator`), 'a moderator that is not known is said so');
assert.equal(sections[1].accessory.media.url, 'https://cdn.example/106.png', 'the picture is the member of the case');
assert.equal(sections[4].accessory.media.url, 'https://cdn.discordapp.com/embed/avatars/0.png', 'an unknown member has the default picture');

const ofUser = buildCaseListCard({ rows: rows.slice(0, 2), count: 2, page: 0, perPage: 6, guild, user: { id: '999', toString: () => '<@999>', displayAvatarURL: () => 'https://cdn.example/u.png' }, people, lang: 'es' }).toJSON();
const userSections = ofUser.components.filter((component) => component.type === 9);
assert.ok(!userSections[1].components[0].content.includes('<@106>'), 'in the list of one member the member is not repeated');
assert.equal(userSections[1].accessory.media.url, 'https://cdn.example/206.png', 'in the list of one member the picture is the moderator');
assert.ok(JSON.stringify(ofUser).includes('Infracciones') || JSON.stringify(ofUser).includes('Infractions'), 'the header of a member');
console.log('Case list checks passed (sections with a picture, the alert, the hammer and the question coin, no titles, 40 components).');
