// The order of the counters of a server, as the dashboard sets it by dragging, turned into channel positions in Discord. Discord orders
// channels inside their category (and categories among themselves), so the counters of each category swap the places they already
// hold: dragging never moves a counter out of its category or past channels that are not counters.

/** The position of a channel inside its category. */
const positionOf = (channel) => Number(channel.rawPosition ?? channel.position ?? 0);

/**
 * `channelIds`: the counters in the new order. `channels`: a Map (or anything with get) of the server's channels. Returns the moves to
 * ask Discord for, `[{ channel, position }]`, only for channels whose position changes.
 */
function planPositions(channelIds, channels) {
  const groups = new Map(); // parent id (or the top level for categories) -> channels in the new order
  for (const id of channelIds) {
    const channel = channels.get(id);
    if (!channel) continue;
    const key = channel.type === 4 ? 'top' : String(channel.parentId ?? 'none');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(channel);
  }
  const moves = [];
  for (const members of groups.values()) {
    const slots = members.map(positionOf).sort((a, b) => a - b);
    // Two channels with the same position (Discord allows it) get places one after another.
    for (let i = 1; i < slots.length; i += 1) if (slots[i] <= slots[i - 1]) slots[i] = slots[i - 1] + 1;
    members.forEach((channel, index) => {
      if (positionOf(channel) !== slots[index]) moves.push({ channel: channel.id, position: slots[index] });
    });
  }
  return moves;
}

module.exports = { planPositions, positionOf };
