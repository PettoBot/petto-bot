// `clear`: collects up to `amount` recent messages (a page of 100 at a time, which is all Discord gives) and deletes them in groups
// of 100. Messages older than 14 days cannot be bulk deleted, so scanning stops when it reaches them.
const MAX_AMOUNT = 1000;
const PAGE = 100;
const MAX_SCANNED = 1500; // when only one member's messages are wanted, how far back to look
const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000 - 60_000;

/** The messages to delete, newest first. `channel.messages.fetch` is asked for 100 at most each time. */
async function collectMessages(channel, { amount, userId = null, now = Date.now() }) {
  const wanted = Math.max(1, Math.min(MAX_AMOUNT, amount));
  const picked = [];
  let before;
  let scanned = 0;
  while (picked.length < wanted && scanned < MAX_SCANNED) {
    const page = await channel.messages.fetch({ limit: PAGE, ...(before ? { before } : {}) });
    if (!page.size) break;
    scanned += page.size;
    for (const message of page.values()) {
      if (now - message.createdTimestamp > TWO_WEEKS_MS) return picked; // the rest is older still
      if (userId && message.author?.id !== userId) continue;
      picked.push(message);
      if (picked.length >= wanted) return picked;
    }
    before = page.last().id;
    if (page.size < PAGE) break;
  }
  return picked;
}

/** Deletes them 100 at a time and says how many went. */
async function deleteMessages(channel, messages) {
  let deleted = 0;
  for (let start = 0; start < messages.length; start += PAGE) {
    const group = messages.slice(start, start + PAGE);
    const result = group.length === 1 ? await group[0].delete().then(() => [1]).catch(() => []) : await channel.bulkDelete(group, true);
    deleted += result.size ?? result.length ?? 0;
  }
  return deleted;
}

module.exports = { collectMessages, deleteMessages, MAX_AMOUNT };
