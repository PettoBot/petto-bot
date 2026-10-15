// The files members attach to appeal answers: what is accepted is decided by the bytes, never by the name, and pictures are re-drawn.
const assert = require('node:assert/strict');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { prepareFile, sniff, cleanName, MAX_BYTES } = require('../src/utils/appealFile');

const png = () => { const c = createCanvas(40, 30); const x = c.getContext('2d'); x.fillStyle = '#3366ff'; x.fillRect(0, 0, 40, 30); return c.toBuffer('image/png'); };
const jpeg = () => { const c = createCanvas(40, 30); const x = c.getContext('2d'); x.fillStyle = '#ff6633'; x.fillRect(0, 0, 40, 30); return c.toBuffer('image/jpeg'); };
const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF');
const text = Buffer.from('I was banned because of a misunderstanding.\nThanks for reading.');
const zip = Buffer.concat([Buffer.from('PK\u0003\u0004'), Buffer.alloc(200, 1)]);
const exe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(300, 0)]);

(async () => {
  assert.equal(sniff(png()), 'image'); assert.equal(sniff(jpeg()), 'image'); assert.equal(sniff(pdf), 'pdf'); assert.equal(sniff(text), 'text');
  assert.equal(sniff(zip), null, 'a zip is nothing we keep'); assert.equal(sniff(exe), null, 'a program is not kept');

  // Pictures are re-drawn as PNG and keep their size.
  const picture = await prepareFile(jpeg(), { accept: 'images', name: 'proof.JPG' });
  assert.equal(picture.mime, 'image/png'); assert.equal(picture.name, 'proof.png');
  const drawn = await loadImage(picture.bytes); assert.equal(drawn.width, 40);

  // What each question accepts.
  await assert.rejects(prepareFile(pdf, { accept: 'images' }), /unsupported/);
  assert.equal((await prepareFile(pdf, { accept: 'pdf', name: 'report' })).name, 'report.pdf');
  assert.equal((await prepareFile(pdf, { accept: 'images_pdf' })).mime, 'application/pdf');
  await assert.rejects(prepareFile(text, { accept: 'images_pdf' }), /unsupported/);
  assert.ok((await prepareFile(text, { accept: 'documents', name: 'story' })).mime.startsWith('text/plain'));
  await assert.rejects(prepareFile(png(), { accept: 'pdf' }), /unsupported/);
  // A program or an archive with a picture name is refused whatever the question accepts.
  for (const accept of ['images', 'pdf', 'images_pdf', 'documents']) {
    await assert.rejects(prepareFile(exe, { accept, name: 'cute.png' }), /unsupported/);
    await assert.rejects(prepareFile(zip, { accept, name: 'cute.pdf' }), /unsupported/);
  }
  // A broken picture and a big file.
  await assert.rejects(prepareFile(Buffer.concat([png().subarray(0, 24), Buffer.alloc(50, 7)]), { accept: 'images' }), /unreadable/);
  await assert.rejects(prepareFile(Buffer.concat([pdf, Buffer.alloc(MAX_BYTES)]), { accept: 'pdf' }), /too_big/);
  await assert.rejects(prepareFile(Buffer.alloc(0), { accept: 'images' }), /unreadable/);

  // Names are made safe.
  assert.equal(cleanName('../../etc/passwd'), 'passwd');
  assert.equal(cleanName('C:\\Users\\me\\captura de pantalla.png'), 'captura de pantalla.png');
  assert.equal(cleanName('<script>alert(1)</script>.pdf'), 'script.pdf');
  assert.equal(cleanName('   '), 'file'); assert.equal(cleanName('.hidden'), 'hidden');
  assert.ok(cleanName('a'.repeat(300)).length <= 80);
  console.log('Checked the files of the appeal answers: kinds, names, pictures and sizes.');
})().catch((err) => { console.error(err); process.exit(1); });
