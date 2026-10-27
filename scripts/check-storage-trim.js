// Checks the ways the database is kept small: the avatar copies rewritten at a lower quality and the entries of the public threat feeds that are
// not listed any more. Runs when PETTO_TEST_DATABASE_URL points to a test database, and is skipped otherwise.
const assert = require('node:assert/strict');

const url = process.env.PETTO_TEST_DATABASE_URL;
if (!url) {
  console.log('Skipped the storage trim check: set PETTO_TEST_DATABASE_URL to a test database to run it.');
  process.exit(0);
}
process.env.DISCORD_TOKEN ||= 'test';
process.env.DISCORD_CLIENT_ID ||= 'test';
process.env.DISCLOUD_DATABASE_URL = url;
const { createCanvas } = require('@napi-rs/canvas');
const { getPrimaryPool, closePools } = require('../src/db/postgres');
const images = require('../src/db/profileHistoryImages');
const links = require('../src/db/maliciousLinks');
const { packStep } = require('../src/jobs/avatarPackJob');
const { toWebp, WEBP_QUALITY } = require('../src/utils/avatarCopies');

(async () => {
  const pool = getPrimaryPool();
  assert.equal(WEBP_QUALITY, 72);

  // --- avatar copies ----------------------------------------------------------------------------------------------------------------------
  await pool.query("delete from profile_history_images where user_id like '92000000000000%'");
  const canvas = createCanvas(256, 256);
  const ctx = canvas.getContext('2d');
  for (let i = 0; i < 400; i += 1) { ctx.fillStyle = `hsl(${(i * 37) % 360} 70% 50%)`; ctx.beginPath(); ctx.arc((i * 53) % 256, (i * 97) % 256, 6 + (i % 20), 0, 7); ctx.fill(); }
  const heavy = canvas.toBuffer('image/webp', 95);
  const user = (n) => `92000000000000${String(n).padStart(2, '0')}`;
  for (const n of [1, 2]) await pool.query("insert into profile_history_images (user_id, hash, content_type, size, bytes, packed) values ($1, $2, 'image/webp', $3, $4, false)", [user(n), 'a'.repeat(32), heavy.length, heavy]);
  await pool.query("insert into profile_history_images (user_id, hash, content_type, size, bytes, packed) values ($1, $2, 'image/webp', 5, $3, false)", [user(3), 'b'.repeat(32), Buffer.from('nope!')]); // not a picture
  const rows = await images.unpacked(10);
  assert.equal(rows.filter((row) => row.user_id.startsWith('92000000000000')).length, 3);
  let result;
  do { result = await packStep({ db: { ...images, unpacked: async () => (await images.unpacked(50)).filter((row) => row.user_id.startsWith('92000000000000')) }, batch: 50 }); } while (result.looked);
  const after = await pool.query("select user_id, size, packed, length(bytes) as len from profile_history_images where user_id like '92000000000000%' order by user_id");
  assert.ok(after.rows.every((row) => row.packed), 'every copy was looked at once');
  assert.ok(after.rows[0].len < heavy.length * 0.85 && Number(after.rows[0].size) === Number(after.rows[0].len), 'a heavy copy is rewritten smaller, with its size');
  assert.equal(Number(after.rows[2].len), 5, 'what cannot be read is left as it is');
  await pool.query("delete from profile_history_images where user_id like '92000000000000%'");

  // --- threat feeds ----------------------------------------------------------------------------------------------------------------------
  const old = "now() - interval '30 days'";
  await pool.query("delete from malicious_links where normalized_url like 'trim-check.example/%'");
  const row = (name, source, extra = {}) => pool.query(
    `insert into malicious_links (normalized_url, hostname, source, reported_by, dev_alerted_at, last_checked_at) values ($1, 'trim-check.example', $2, $3, $4, ${extra.old ? old : 'now()'})`,
    [`trim-check.example/${name}`, source, extra.reportedBy ?? null, extra.alerted ?? null]);
  await row('stale', 'openphish', { old: true });
  await row('fresh', 'openphish');
  await row('reported', 'openphish', { old: true, reportedBy: '1' });
  await row('alerted', 'openphish', { old: true, alerted: new Date().toISOString() });
  await row('other-feed', 'urlhaus', { old: true });
  assert.equal(await links.pruneStaleFeedLinks('openphish', 14), 1, 'only the old one of that feed that nobody reported goes');
  const left = (await pool.query("select normalized_url from malicious_links where normalized_url like 'trim-check.example/%' order by 1")).rows.map((r) => r.normalized_url.split('/')[1]);
  assert.deepEqual(left, ['alerted', 'fresh', 'other-feed', 'reported']);
  await pool.query("delete from malicious_links where normalized_url like 'trim-check.example/%'");

  await closePools();
  console.log('check-storage-trim: ok');
})().catch((error) => { console.error(error); process.exit(1); });
