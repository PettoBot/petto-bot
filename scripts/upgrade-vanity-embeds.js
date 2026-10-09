// Turns the saved embeds that came over from the old Vanity bot as classic embeds into Components V2 cards, working only on
// Petto's own database (the old Vanity database is not needed, so this works after it is gone).
//
//   node scripts/upgrade-vanity-embeds.js [--dry-run]
//
// It only touches embeds that came from the import (they carry the mark `_vanity_id`) and are still classic, so an embed made or
// already changed to V2 in Petto is left alone. The messages the old bot made by itself (`vanity_notify`, `guildtag_notify`,
// `notify_*`) become Petto's own designs; the rest keep their words, colors, pictures, fields and buttons. It can be run again.
const { getPrimaryPool, closePools } = require('../src/db/postgres');
const { toV2 } = require('../src/utils/identity/v2Designs');

const dryRun = process.argv.includes('--dry-run');

(async () => {
  const client = await getPrimaryPool().connect();
  try {
    await client.query('begin');
    const { rows } = await client.query("select id, guild_id, name, data from embed_templates where data ? '_vanity_id' and not (data ? 'v2') order by guild_id, name");
    let upgraded = 0;
    for (const row of rows) {
      // A name that clashed with an embed of Petto was saved as `vanity-<name>`: the old bot's own name is what tells its defaults apart.
      const original = row.name.replace(/^vanity-/, '').replace(/-\d+$/, '');
      const { _vanity_id: mark, ...classic } = row.data;
      const design = toV2(original, classic);
      await client.query('update embed_templates set data = $2, updated_at = now() where id = $1', [row.id, JSON.stringify({ v2: design, _vanity_id: mark })]);
      upgraded += 1;
    }
    console.log(`classic embeds from the old bot: ${rows.length}, turned into V2: ${upgraded}`);
    if (dryRun) { await client.query('rollback'); console.log('Dry run: nothing was written.'); } else { await client.query('commit'); console.log('Done.'); }
  } catch (error) {
    await client.query('rollback').catch(() => {});
    console.error(`It failed and nothing was written: ${error.message}`);
    process.exitCode = 1;
  } finally {
    client.release();
    await closePools();
  }
})();
