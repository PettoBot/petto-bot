// One request limit for every process that uses the same Redis: each request first takes a place in the count of the current second,
// and waits for the next second when the places are gone. Without Redis the limit of each process (discord.js) is all there is.
const redis = require('./redis');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function attachSharedRestLimit(rest, perSecond) {
  if (!rest || typeof rest.request !== 'function' || rest.__sharedLimit) return;
  rest.__sharedLimit = true;
  const original = rest.request.bind(rest);
  rest.request = async (options) => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const used = await redis.countThisSecond('rest');
      if (used <= perSecond) break; // 0 is "no Redis": go ahead
      await sleep(1_005 - (Date.now() % 1_000));
    }
    return original(options);
  };
}

module.exports = { attachSharedRestLimit };
