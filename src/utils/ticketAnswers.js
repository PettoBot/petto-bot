// The answers of a ticket form: what the member sent is checked (a question that takes pictures only refuses anything else), the files
// are copied (Discord's links to what is uploaded in a form can stop working, so each file is downloaded and uploaded again into the
// ticket channel, where it lasts as long as the ticket does), and the answers are drawn as cards (Components V2): text, choices as a
// list, a mark for a checkbox, mentions that notify nobody, pictures in a gallery and the other files as files.
const { AttachmentBuilder, ContainerBuilder, TextDisplayBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, FileBuilder, MessageFlags } = require('discord.js');
const { fetchFileBuffer } = require('./safeImage');
const { looksLikeImage } = require('./ticketFormFields');
const { t, currentLanguage } = require('../i18n');
const { EMOJI } = require('./emojis');

const MAX_FILE_BYTES = 8 * 1024 * 1024; // the most Petto copies of one file
const MAX_COPIED_FILES = 10; // the most files copied for one ticket (what a message of Discord holds)
// What a message can carry in a server, by boost level (Discord: 10 MiB, more with boosts). Petto never goes over MAX_FILE_BYTES for one file.
const TIER_UPLOAD_BYTES = [10, 10, 50, 100].map((mib) => mib * 1024 * 1024);
const MAX_TEXT = 3800; // Discord counts at most 4000 characters of text in one Components V2 message
const MAX_COMPONENTS = 36; // and 40 components, the container included
const MAX_ANSWER = 1000;

/** The most bytes of files Petto puts in one message of this server: the lowest of its own limit and what the boost level allows. */
function uploadLimit(guild) {
  const tier = TIER_UPLOAD_BYTES[Number(guild?.premiumTier)] ?? TIER_UPLOAD_BYTES[0];
  return Math.min(MAX_FILE_BYTES, tier);
}

/** What kind of picture some bytes are, from their first bytes (not from what the name or the type says), or null. */
function sniffImage(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  if (buffer[0] === 0x89 && buffer.toString('latin1', 1, 4) === 'PNG') return 'png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg';
  if (buffer.toString('latin1', 0, 4) === 'GIF8') return 'gif';
  if (buffer.toString('latin1', 0, 4) === 'RIFF' && buffer.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return null;
}

/** A size for people: 512 B, 1.5 KB, 3.2 MB. */
function sizeText(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** A file name that is safe to show in Markdown: no line breaks, and nothing that formats, links or mentions. */
function showName(name) {
  return String(name ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, 80).replace(/[\\`*_~|>[\]()<@#:]/g, '\\$&') || 'file';
}

/** A name for the uploaded copy: letters, digits, dots, dashes and underscores only, with its extension, not used by another file of the message. */
function copyName(name, taken) {
  const raw = String(name ?? '').split(/[\\/]/).pop();
  const dot = raw.lastIndexOf('.');
  const ext = dot > 0 ? raw.slice(dot + 1).replace(/[^A-Za-z0-9]/g, '').slice(0, 8).toLowerCase() : '';
  const base = (dot > 0 ? raw.slice(0, dot) : raw).replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'file';
  let candidate = ext ? `${base}.${ext}` : base;
  for (let n = 2; taken.has(candidate); n += 1) candidate = ext ? `${base}-${n}.${ext}` : `${base}-${n}`;
  taken.add(candidate);
  return candidate;
}

/**
 * Checks and copies the files of the answers, in place. For each file: `image` (a picture, by its first bytes when they could be read,
 * else by what Discord says), `data` (the bytes, when they were downloaded) and `reason` (why it will not be copied: "big", "failed" or
 * "limit"). A question that takes pictures only refuses the first file that is not one: returns { refused: { label, name } }, else { refused: null }.
 * `download(url, undefined, { maxBytes })` can be replaced (the checks do); by default it is the safe download of Petto: public addresses only,
 * a time limit and a size limit.
 */
async function prepareFiles(entries, { guild = null, download = fetchFileBuffer } = {}) {
  const limit = uploadLimit(guild);
  let copies = 0;
  for (const entry of entries) {
    if (entry.type !== 'file') continue;
    const picturesOnly = entry.accept === 'images';
    for (const file of entry.value) {
      file.image = looksLikeImage(file);
      if (picturesOnly && !file.image) return { refused: { label: entry.label, name: file.name } };
      if (file.size > limit) { file.reason = 'big'; continue; }
      if (copies >= MAX_COPIED_FILES) { file.reason = 'limit'; continue; }
      try {
        file.data = await download(file.url, undefined, { maxBytes: limit });
        if (!Buffer.isBuffer(file.data) || !file.data.length) throw new Error('empty download'); // i18n-ignore: only logged
      } catch {
        file.data = null; file.reason = 'failed';
        continue;
      }
      // What the file really is, not what its name says.
      const kind = sniffImage(file.data);
      if (picturesOnly && !kind) return { refused: { label: entry.label, name: file.name } };
      file.image = Boolean(kind);
      copies += 1;
    }
  }
  return { refused: null };
}

/** What each answer is as plain text (what is kept in the database): a text, the choices joined, a mark, the mentions, the file names. */
function plainAnswer(entry) {
  switch (entry.type) {
    case 'check': return entry.value ? '✅' : '❌';
    case 'file': return entry.value.map((file) => file.name).join(', ');
    case 'user': return entry.value.map((id) => `<@${id}>`).join(' ');
    case 'role': return entry.value.map((id) => `<@&${id}>`).join(' ');
    case 'channel': return entry.value.map((id) => `<#${id}>`).join(' ');
    case 'select': case 'radio': case 'checkboxes': return entry.value.join(', ');
    default: return String(entry.value ?? '');
  }
}

/** The answers as { question: text }, how a ticket keeps them. Two questions with the same label do not overwrite each other. */
function answersMap(entries) {
  const map = {};
  for (const entry of entries) {
    let key = entry.label;
    for (let n = 2; Object.hasOwn(map, key); n += 1) key = `${entry.label} (${n})`;
    map[key] = plainAnswer(entry);
  }
  return map;
}

const cut = (text, max = MAX_ANSWER) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** The text of one answer, ready for the card (not for a file: those are pieces of their own). */
function answerText(entry) {
  switch (entry.type) {
    case 'check': return entry.value ? '✅' : '❌';
    case 'select': case 'radio': case 'checkboxes':
      if (!entry.value.length) return '—';
      return entry.value.length === 1 ? cut(entry.value[0]) : `\n${cut(entry.value.map((text) => `- ${text}`).join('\n'))}`;
    case 'user': case 'role': case 'channel':
      return entry.value.length ? cut(plainAnswer(entry)) : '—';
    default:
      return entry.value ? cut(String(entry.value)) : '—';
  }
}

/** The line of a file that was not copied: its name and size as a link, and why it may stop working. */
function linkLine(file, lang, limit) {
  const url = /^https:\/\//i.test(file.url) ? file.url.replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/[<>\s]/g, '') : '';
  const name = showName(file.name);
  const what = url ? `[${name}](${url})` : name;
  const why = t(lang, `tickets.answers.notCopied.${file.reason ?? 'failed'}`, { emoji: EMOJI.WARNING, limit: sizeText(limit), max: MAX_COPIED_FILES });
  return `${what} · ${sizeText(file.size)}\n-# ${why}`;
}

/**
 * The answers as pieces to lay out: a line of text, or a file. A file that was copied is a piece that carries its bytes; one that was not is
 * a line of text with its link. `header` goes first.
 */
function answerPieces(entries, { lang = currentLanguage(), guild = null } = {}) {
  const limit = uploadLimit(guild);
  const pieces = [{ kind: 'text', text: t(lang, 'tickets.open.submittedForm') }];
  for (const entry of entries) {
    if (entry.type !== 'file') {
      const text = answerText(entry);
      pieces.push({ kind: 'text', text: `**${entry.label}:**${text.startsWith('\n') ? '' : ' '}${text}` });
      continue;
    }
    pieces.push({ kind: 'text', text: `**${entry.label}:**${entry.value.length ? '' : ' —'}` });
    for (const file of entry.value) pieces.push({ kind: 'media', file, lang, limit });
  }
  return pieces;
}

/** Whether a file piece goes in the message as an attachment (it was downloaded) or as a line of text with its link. */
const isCopy = (piece) => piece.kind === 'media' && Buffer.isBuffer(piece.file.data);

function costOf(piece) {
  if (piece.kind === 'text') return { text: piece.text.length, parts: 1, files: 0, bytes: 0 };
  if (isCopy(piece)) return { text: 0, parts: piece.file.image ? 2 : 1, files: 1, bytes: piece.file.data.length };
  return { text: linkLine(piece.file, piece.lang, piece.limit).length, parts: 1, files: 0, bytes: 0 };
}

/** The pieces split into messages that fit what Discord allows: the characters of text, the components, the files and their weight. */
function packPieces(pieces, { lang = currentLanguage(), limit = MAX_FILE_BYTES } = {}) {
  const messages = [];
  let current = null;
  const open = (first) => {
    current = { pieces: first ? [] : [{ kind: 'text', text: t(lang, 'tickets.answers.continued') }], text: 0, parts: 1, files: 0, bytes: 0 };
    if (!first) current.text = current.pieces[0].text.length + 1;
    if (!first) current.parts += 1;
    messages.push(current);
  };
  open(true);
  for (const piece of pieces) {
    const cost = costOf(piece);
    const fits = current.text + cost.text <= MAX_TEXT && current.parts + cost.parts <= MAX_COMPONENTS && current.files + cost.files <= MAX_COPIED_FILES && current.bytes + cost.bytes <= limit;
    if (!fits && current.pieces.length) open(false);
    current.pieces.push(piece);
    current.text += cost.text + 1;
    current.parts += cost.parts;
    current.files += cost.files;
    current.bytes += cost.bytes;
  }
  return messages.map((message) => message.pieces);
}

/** One message (a Components V2 container, and the files it shows) from its pieces. */
function messageOf(pieces) {
  const container = new ContainerBuilder();
  const files = [];
  const taken = new Set();
  let lines = [];
  let gallery = [];
  const flushText = () => { if (lines.length) container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n'))); lines = []; };
  const flushGallery = () => { if (gallery.length) container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(gallery)); gallery = []; };
  for (const piece of pieces) {
    if (piece.kind === 'text') { flushGallery(); lines.push(piece.text); continue; }
    if (!isCopy(piece)) { flushGallery(); lines.push(linkLine(piece.file, piece.lang, piece.limit)); continue; }
    const name = copyName(piece.file.name, taken);
    files.push(new AttachmentBuilder(piece.file.data, { name, description: String(piece.file.name).slice(0, 1000) }));
    flushText();
    if (piece.file.image) {
      gallery.push(new MediaGalleryItemBuilder().setURL(`attachment://${name}`).setDescription(String(piece.file.name).slice(0, 1000)));
    } else {
      flushGallery();
      container.addFileComponents(new FileBuilder().setURL(`attachment://${name}`));
    }
  }
  flushText();
  flushGallery();
  return { components: [container], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] }, ...(files.length ? { files } : {}) };
}

/** The messages that show the answers (one card, or more when there is a lot), each as the payload to send. */
function buildAnswerMessages(entries, { lang = currentLanguage(), guild = null } = {}) {
  const limit = uploadLimit(guild);
  return packPieces(answerPieces(entries, { lang, guild }), { lang, limit }).map(messageOf);
}

/**
 * Sends the answers with `send(payload)`. When Discord refuses a message that carries files (a missing permission, a limit), its files are
 * not copied: the answers of that message are sent again with their links, so the staff still sees them.
 */
async function postAnswers(entries, { send, lang = currentLanguage(), guild = null, log = () => {} } = {}) {
  const limit = uploadLimit(guild);
  const groups = packPieces(answerPieces(entries, { lang, guild }), { lang, limit });
  for (const group of groups) {
    try {
      await send(messageOf(group));
    } catch (error) {
      const copies = group.filter(isCopy);
      if (!copies.length) { log(error); continue; }
      log(error);
      for (const piece of copies) { piece.file.data = null; piece.file.reason = 'failed'; }
      for (const again of packPieces(group, { lang, limit })) await send(messageOf(again)).catch(log);
    }
  }
}

module.exports = { MAX_FILE_BYTES, MAX_COPIED_FILES, uploadLimit, sniffImage, sizeText, showName, copyName, prepareFiles, plainAnswer, answersMap, buildAnswerMessages, postAnswers };
