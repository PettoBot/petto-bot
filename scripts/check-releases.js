// The release notes of `!version` in every language: src/utils/releases.js holds each release without its texts, and
// src/i18n/releases/<lang>.js holds the texts. Every release is written in English, Spanish and Portuguese with the same
// sections, items and Markdown; the English is still the text it was before the translation (scripts/fixtures/releases-en.json);
// and the card fits a Components V2 message in every language.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { LANGUAGES, runWithLanguage } = require('../src/i18n');
const { EMOJI } = require('../src/utils/emojis');
const releases = require('../src/utils/releases');
const { RELEASES, RELEASE_TEXTS, getReleases, getRelease, getLatestRelease, getReleaseIndex } = releases;
const { buildVersionPayload } = require('../src/interactions/version');

const ROOT = path.join(__dirname, '..');
const TEXTS_DIR = path.join(ROOT, 'src', 'i18n', 'releases');
const fileOf = (lang) => `src/i18n/releases/${lang}.js`;

// The shape a translation keeps from the English text.
const sorted = (list) => [...list].sort().join(' ');
const commandsIn = (text) => (text.match(/`[^`]*`/g) ?? [])
  .map((span) => span.slice(1, -1))
  .filter((span) => /^[!/]/.test(span))
  .map((span) => span.replace(/^\//, '!').replace(/<[^>]*>/g, '<>')); // `/summary` may be written `!summary`; `<name>` is translated
const SHAPES = {
  placeholders: (text) => sorted(text.match(/\{[^{}\n]*\}/g) ?? []),
  'code marks (`)': (text) => (text.match(/`/g) ?? []).length,
  'bold marks (**)': (text) => (text.match(/\*\*/g) ?? []).length,
  'line breaks': (text) => (text.match(/\n/g) ?? []).length,
  links: (text) => sorted(text.match(/https?:\/\/[^\s)>]+/g) ?? []),
  'mentions and custom emojis': (text) => sorted(text.match(/<(?:@[!&]?|#|a?:\w+:)\d+>/g) ?? []),
  commands: (text) => sorted(commandsIn(text)),
};

/** Everything wrong with a list of releases and their texts, as messages a maintainer can act on. */
function releaseProblems(list, textsByLang, languages) {
  const problems = [];
  const problem = (text) => problems.push(text);
  const versions = new Set();

  list.forEach((release, index) => {
    const where = `src/utils/releases.js ${release.version ?? `#${index + 1}`}`;
    if (typeof release.version !== 'string' || !release.version) problem(`${where}: has no version`);
    if (versions.has(release.version)) problem(`${where}: the version is written twice`);
    versions.add(release.version);
    if (typeof release.name !== 'string' || !release.name) problem(`${where}: has no codename (name)`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(release.date ?? '')) problem(`${where}: the date must be YYYY-MM-DD`);
    if (!Number.isInteger(release.accent)) problem(`${where}: the accent must be a color number like 0xf0a88f`);
    const expectedStatus = index === 0 ? 'latest' : 'published';
    if (release.status !== expectedStatus) problem(`${where}: the status must be '${expectedStatus}' (only the first release is 'latest')`);
    if (!Array.isArray(release.sectionEmojis) || !release.sectionEmojis.length || release.sectionEmojis.some((emoji) => typeof emoji !== 'string' || !emoji)) {
      problem(`${where}: sectionEmojis must list one emoji per section`);
      return;
    }
    for (const field of ['label', 'summary', 'sections', 'title', 'items']) {
      if (Object.hasOwn(release, field)) problem(`${where}: ${field} is text; write it in ${languages.map(fileOf).join(', ')} instead`);
    }

    const english = textsByLang.en?.[release.version];
    for (const lang of languages) {
      const texts = textsByLang[lang]?.[release.version];
      const at = `${fileOf(lang)} ${release.version}`;
      if (!texts) {
        problem(`${fileOf(lang)} has no '${release.version}': every release is written in ${languages.join(', ')} (${languages.map(fileOf).join(', ')})`);
        continue;
      }
      for (const field of ['label', 'summary']) {
        if (typeof texts[field] !== 'string' || !texts[field].trim()) problem(`${at}: ${field} is missing or empty`);
      }
      if (!Array.isArray(texts.sections)) { problem(`${at}: sections is missing`); continue; }
      if (texts.sections.length !== release.sectionEmojis.length) {
        problem(`${at}: ${texts.sections.length} sections, but src/utils/releases.js lists ${release.sectionEmojis.length} section emojis`);
        continue;
      }
      texts.sections.forEach((section, s) => {
        if (typeof section?.title !== 'string' || !section.title.trim()) problem(`${at}: section ${s + 1} has no title`);
        else if (/^(<a?:\w+:\d+>|\p{Extended_Pictographic})/u.test(section.title)) problem(`${at}: section ${s + 1} title starts with an emoji; the emoji goes in sectionEmojis of src/utils/releases.js`);
        if (!Array.isArray(section?.items) || !section.items.length) problem(`${at}: section ${s + 1} has no items`);
        else section.items.forEach((item, i) => { if (typeof item !== 'string' || !item.trim()) problem(`${at}: section ${s + 1} item ${i + 1} is empty`); });
      });
      if (typeof texts.label === 'string') {
        if (texts.label.length > 100) problem(`${at}: the label is ${texts.label.length} characters; a select menu option can have 100`);
        const prefix = `${release.display ?? release.version} · `;
        if (!texts.label.startsWith(prefix)) problem(`${at}: the label must start with "${prefix}"`);
        if (english?.label?.includes(release.name) && !texts.label.includes(release.name)) problem(`${at}: the label must keep the codename "${release.name}" (codenames are never translated)`);
      }
      if (lang === 'en' || !english || !Array.isArray(english.sections) || english.sections.length !== texts.sections.length) continue;

      // The translation has the shape of the English text, piece by piece.
      const pairs = [['label', english.label, texts.label], ['summary', english.summary, texts.summary]];
      texts.sections.forEach((section, s) => {
        const englishSection = english.sections[s];
        pairs.push([`section ${s + 1} title`, englishSection.title, section.title]);
        if (!Array.isArray(englishSection.items) || !Array.isArray(section.items)) return;
        if (section.items.length !== englishSection.items.length) {
          problem(`${at}: section ${s + 1} has ${section.items.length} items, English has ${englishSection.items.length}`);
          return;
        }
        section.items.forEach((item, i) => pairs.push([`section ${s + 1} item ${i + 1}`, englishSection.items[i], item]));
      });
      for (const [what, source, translation] of pairs) {
        if (typeof source !== 'string' || typeof translation !== 'string') continue;
        for (const [name, shape] of Object.entries(SHAPES)) {
          if (shape(translation) !== shape(source)) problem(`${at}: ${what} has different ${name} than English (${JSON.stringify(shape(translation))} vs ${JSON.stringify(shape(source))})`);
        }
        if (!what.includes('title') && translation === source) problem(`${at}: ${what} is still the English text; translate it`);
      }
    }
  });

  for (const lang of languages) {
    for (const version of Object.keys(textsByLang[lang] ?? {})) {
      if (!versions.has(version)) problem(`${fileOf(lang)} has '${version}', which is not in src/utils/releases.js`);
    }
  }
  return problems;
}

// One file per language, and no file for a language Petto does not speak.
for (const lang of LANGUAGES) assert.ok(fs.existsSync(path.join(TEXTS_DIR, `${lang}.js`)), `${fileOf(lang)} exists`);
for (const file of fs.readdirSync(TEXTS_DIR)) assert.ok(LANGUAGES.includes(file.replace(/\.js$/, '')), `${file} in src/i18n/releases is not a language of Petto`);
assert.deepEqual(Object.keys(RELEASE_TEXTS).sort(), [...LANGUAGES].sort(), 'src/utils/releases.js loads the texts of every language');

const problems = releaseProblems(RELEASES, RELEASE_TEXTS, LANGUAGES);
assert.deepEqual(problems, [], `Release notes problems:\n${problems.join('\n')}`);
assert.ok(RELEASES.length <= 25, `the !version menu lists every release and Discord allows 25 options; there are ${RELEASES.length}`);

// The check itself catches a release that is not written in every language, a missing section, a lost Markdown mark, a
// language with a release nobody has, and an English text left untranslated.
{
  const copy = (value) => JSON.parse(JSON.stringify(value));
  const newRelease = { version: 'v9.9.9', name: 'Cheesecake', date: '2099-01-01', accent: 0xffffff, status: 'latest', sectionEmojis: [EMOJI.RELEASE_ROCKET] };
  const list = [newRelease, ...copy(RELEASES).map((release) => ({ ...release, status: 'published' }))];
  const texts = copy(RELEASE_TEXTS);
  texts.en['v9.9.9'] = { label: 'v9.9.9 · Cheesecake: a test', summary: 'A test.', sections: [{ title: 'New', items: ['`!test` works.'] }] };
  let found = releaseProblems(list, texts, LANGUAGES);
  assert.ok(found.some((text) => text.startsWith("src/i18n/releases/es.js has no 'v9.9.9'")), 'a release missing in Spanish is reported');
  assert.ok(found.some((text) => text.startsWith("src/i18n/releases/pt-BR.js has no 'v9.9.9'")), 'and in Portuguese');
  texts.es['v9.9.9'] = { label: 'v9.9.9 · Cheesecake: una prueba', summary: 'Una prueba.', sections: [{ title: 'Novedades', items: ['!test funciona.'] }] };
  texts['pt-BR']['v9.9.9'] = { label: 'v9.9.9 · Cheesecake: um teste', summary: 'A test.', sections: [{ title: 'Novidades', items: ['`!test` funciona.'] }] };
  texts['pt-BR']['v0.7.6'].sections.pop();
  texts.es['v0.0.1'] = texts.es['v9.9.9'];
  found = releaseProblems(list, texts, LANGUAGES);
  assert.ok(found.some((text) => text.includes('es.js v9.9.9: section 1 item 1 has different code marks')), 'a lost backtick is reported');
  assert.ok(found.some((text) => text.includes('pt-BR.js v0.7.6: 4 sections, but src/utils/releases.js lists 5')), 'a missing section is reported');
  assert.ok(found.some((text) => text.includes('pt-BR.js v9.9.9: summary is still the English text')), 'an untranslated text is reported');
  assert.ok(found.some((text) => text.includes("es.js has 'v0.0.1', which is not in src/utils/releases.js")), 'a version only a language has is reported');
  assert.ok(releaseProblems(copy(RELEASES).reverse(), RELEASE_TEXTS, LANGUAGES).some((text) => text.includes("the status must be 'latest'")), 'only the first release is the latest');
}

// The English is the text the release notes had before they were translated, word for word.
const before = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'releases-en.json'), 'utf8'));
const englishNow = new Map(getReleases('en').map((release) => [release.version, JSON.parse(JSON.stringify(release))]));
for (const old of before) {
  const now = englishNow.get(old.version);
  assert.ok(now, `${old.version} is still a release`);
  for (const field of ['version', 'display', 'name', 'label', 'date', 'accent', 'summary', 'sections']) {
    assert.deepEqual(now[field], old[field], `${old.version}: the English ${field} is unchanged`);
  }
}
assert.equal(getLatestRelease('en').status, `${EMOJI.RELEASE_APPROVED} Latest`);
assert.ok(getReleases('en').slice(1).every((release) => release.status === `${EMOJI.RELEASE_APPROVED} Published`));
assert.equal(getRelease('v0.7.6').label, 'v0.7.6 · Macaron: appeals, stronger moderation & more community tools', 'English outside of a command');
assert.equal(getRelease('v0.7.6').sections[0].title, `${EMOJI.RELEASE_ROCKET} Appeals`);

// Each language gets its own texts, with the codename, the date and the emojis of the release.
const es = getRelease('v0.7.6', 'es');
assert.equal(es.name, 'Macaron');
assert.equal(es.date, '2026-10-15');
assert.equal(es.status, `${EMOJI.RELEASE_APPROVED} Publicada`);
assert.equal(getRelease('v0.7.9-1', 'es').status, `${EMOJI.RELEASE_APPROVED} Última versión`, 'the latest release is the first one');
assert.equal(getRelease('v0.7.9', 'es').status, `${EMOJI.RELEASE_APPROVED} Publicada`);
assert.equal(getRelease('v0.7.8', 'es').status, `${EMOJI.RELEASE_APPROVED} Publicada`);
assert.equal(getRelease('v0.7.7', 'es').status, `${EMOJI.RELEASE_APPROVED} Publicada`);
assert.equal(es.sections[0].title, `${EMOJI.RELEASE_ROCKET} Apelaciones`);
assert.match(es.label, /^v0\.7\.6 · Macaron: apelaciones/);
const pt = getRelease('v0.7.5', 'pt-BR');
assert.equal(pt.status, `${EMOJI.RELEASE_APPROVED} Publicada`);
assert.equal(pt.sections[0].title, `${EMOJI.RELEASE_ROCKET} Novidades`);
assert.match(pt.summary, /^Aniversários/);
assert.equal(getRelease('v0.7.6', 'pt').label, getRelease('v0.7.6', 'pt-BR').label, '"pt" is read as pt-BR');
assert.equal(getRelease('v0.7.6', 'fr').label, getRelease('v0.7.6', 'en').label, 'an unknown language is English');
assert.equal(runWithLanguage('es', () => getLatestRelease().summary), getRelease('v0.7.9-1', 'es').summary, 'the language of the running command by default');
assert.equal(getRelease('v0.0.0', 'es'), null);
assert.equal(getReleaseIndex('v0.7.5'), 5);

// A language that lacks a release shows it in English instead of breaking.
{
  const saved = RELEASE_TEXTS.es['v0.7.6'];
  delete RELEASE_TEXTS.es['v0.7.6'];
  try {
    const fallback = getRelease('v0.7.6', 'es');
    const english = getRelease('v0.7.6', 'en');
    assert.equal(fallback.summary, english.summary);
    assert.deepEqual(fallback.sections, english.sections);
    assert.ok(buildVersionPayload('v0.7.6', 'es'), 'the card is still built');
  } finally {
    RELEASE_TEXTS.es['v0.7.6'] = saved;
  }
}

// The !version card in every language: it fits, the menu and the buttons fit, and it is written in that language.
// Discord counts the text displays toward the 4000 characters (the menu and the buttons have their own limits, checked below).
const walk = (node, visit) => {
  if (Array.isArray(node)) { node.forEach((child) => walk(child, visit)); return; }
  if (!node || typeof node !== 'object') return;
  visit(node);
  Object.values(node).forEach((child) => walk(child, visit));
};
for (const lang of LANGUAGES) {
  for (const release of RELEASES) {
    const payload = buildVersionPayload(release.version, lang);
    const components = payload.components.map((component) => JSON.parse(JSON.stringify(component.toJSON())));
    const where = `the ${lang} !version card of ${release.version}`;
    let displayed = 0;
    walk(components, (node) => { if (node.type === 10) displayed += node.content.length; });
    assert.ok(displayed <= 4000, `${where} fits the 4000 characters of a Components V2 message (${displayed})`);
    walk(components, (node) => {
      if (node.type === 2 && node.label) assert.ok(node.label.length <= 80, `${where}: button "${node.label}" fits 80 characters`);
      if (node.type === 3) {
        assert.ok(node.options.length <= 25, `${where}: the menu has at most 25 options`);
        assert.ok(!node.placeholder || node.placeholder.length <= 100, `${where}: the menu placeholder fits 100 characters`);
        for (const option of node.options) {
          assert.ok(option.label.length <= 100, `${where}: menu label "${option.label}" fits 100 characters`);
          assert.ok(!option.description || option.description.length <= 100, `${where}: menu description fits 100 characters`);
        }
      }
    });
    const text = JSON.stringify(components);
    const localized = getRelease(release.version, lang);
    assert.ok(text.includes(JSON.stringify(`> ${localized.summary}`).slice(1, -1)), `${where} shows the ${lang} summary`);
    for (const section of localized.sections) assert.ok(text.includes(JSON.stringify(`### ${section.title}`).slice(1, -1)), `${where} shows the section ${section.title}`);
  }
}
const card = (version, lang) => JSON.stringify(buildVersionPayload(version, lang).components.map((component) => component.toJSON()));
assert.match(card('v0.7.6', 'es'), /Petto v0\.7\.6 “Macaron”/, 'the codename is never translated');
assert.match(card('v0.7.9', 'es'), /Petto v0\.7\.9 “Donut”/);
assert.match(card('v0.7.9-1', 'es'), /Petto v0\.7\.9~1 “Donut”/, 'a patch is shown with ~');
assert.match(card('v0.7.9-1', 'es'), /Última versión  ·  /);
assert.match(card('v0.7.9-1', 'es'), /Versión 1 de \d+/);
assert.match(card('v0.7.9', 'es'), /Publicada  ·  /);
assert.match(card('v0.7.8', 'es'), /Petto v0\.7\.8 “Mochi”/);
assert.match(card('v0.7.7', 'es'), /Petto v0\.7\.7 “Tiramisu”/);
assert.match(card('v0.7.7', 'es'), /Publicada  ·  /);
assert.match(card('v0.7.6', 'es'), /Publicada  ·  /);
assert.match(card('v0.7.6', 'es'), /Versión 5 de \d+/);
assert.match(card('v0.7.6', 'es'), /"label":"v0\.7\.5 · Waffle: cumpleaños/, 'the menu lists the releases in Spanish');
assert.match(card('v0.7.0', 'pt-BR'), /https:\/\/code\.petto\.sbs/, 'links are kept');
assert.match(card('v0.7.0', 'pt-BR'), /### <:\w+:\d+> Alertas de missões/);
assert.match(card('v0.7.6', 'en'), /"label":"v0\.7\.5 · Waffle: birthdays, verification in a channel & a faster dashboard"/);
assert.equal(card(undefined, 'pt-BR'), card(RELEASES[0].version, 'pt-BR'), 'without a version, the latest');

// The version of package.json is a release: package-lock.json says the same, `!version` shows it first, CHANGELOG.md has its notes (read the
// way .github/workflows/release.yml reads them), and the workflow makes it a normal release and the latest one, also for a patch (0.7.9-1),
// which semver would take for a prerelease older than 0.7.9.
{
  const root = path.join(__dirname, '..');
  const { version } = require('../package.json');
  const lock = require('../package-lock.json');
  assert.equal(lock.version, version, 'package-lock.json has the version of package.json');
  assert.equal(lock.packages?.['']?.version, version, 'and so does its root package');
  assert.match(version, /^\d+\.\d+\.\d+(?:-\d+)?$/, 'a version is x.y.z, or x.y.z-n for a patch');
  assert.equal(RELEASES[0].version, `v${version}`, '!version shows the version of package.json first');
  if (version.includes('-')) assert.equal(RELEASES[0].display, `v${version.replace('-', '~')}`, 'a patch is shown with ~');
  const notesOf = (changelog, wanted) => {
    const lines = [];
    let found = false;
    for (const line of changelog.split('\n')) {
      if (line.startsWith(`## [${wanted}]`)) { found = true; continue; }
      if (found && /^## \[/.test(line)) break;
      if (found) lines.push(line);
    }
    return lines.join('\n').trim();
  };
  const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
  assert.ok(notesOf(changelog, version).length > 50, `CHANGELOG.md has the notes of ${version}`);
  assert.ok(!notesOf(changelog, version).includes(`## [${version.split('-')[0]}]`), 'the notes of a patch stop before the version it patches');
  const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'release.yml'), 'utf8');
  for (const command of ['gh release create', 'gh release edit']) {
    const line = workflow.split('\n').find((each) => each.includes(command)) ?? '';
    assert.ok(line.includes('--prerelease=false') && line.includes('--latest'), `${command} makes a normal release and the latest one`);
  }
}

console.log(`release notes ok (${RELEASES.length} releases in ${LANGUAGES.join(', ')})`);
