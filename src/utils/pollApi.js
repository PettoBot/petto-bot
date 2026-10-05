// What the dashboard asks the bot for when it posts or updates a poll: the poll's message, drawn by the bot's own engine
// (the default card, or a saved Components V2 design with the {poll.*} variables) so the web does not keep a second copy.
const { buildPollMessage } = require('./pollCard');

const MAX_OPTIONS = 10;

/** Cleans what the web sent. Returns `{ poll, results }`, or null when it is not a poll the bot could draw. */
function readPollRequest(body) {
  const raw = body?.poll;
  if (!raw || typeof raw !== 'object') return null;
  const options = Array.isArray(raw.options) ? raw.options.map((option) => String(option).slice(0, 80)).filter(Boolean) : [];
  const question = String(raw.question ?? '').trim().slice(0, 200);
  if (!question || options.length < 2 || options.length > MAX_OPTIONS) return null;
  const counts = options.map((_, i) => {
    const value = Number(Array.isArray(body.counts) ? body.counts[i] : 0);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  });
  const voters = Number.isFinite(Number(body.voters)) && Number(body.voters) > 0 ? Math.floor(Number(body.voters)) : 0;
  const image = typeof raw.image === 'string' && /^https?:\/\//i.test(raw.image) ? raw.image.slice(0, 1000) : null;
  const template = typeof raw.embed_template === 'string' && raw.embed_template.trim() ? raw.embed_template.trim().slice(0, 60) : null;
  const id = Number(raw.id);
  return {
    poll: {
      id: Number.isSafeInteger(id) && id >= 0 ? id : 0,
      question,
      options,
      image,
      multi: raw.multi === true,
      closed: raw.closed === true,
      ends_at: typeof raw.ends_at === 'string' ? raw.ends_at : null,
      creator_id: /^\d{15,25}$/.test(String(raw.creator_id ?? '')) ? String(raw.creator_id) : null,
      embed_template: template,
    },
    results: { counts, voters },
  };
}

/** The JSON of the message (`{ flags, components }`) that the web sends to Discord as it is. */
async function renderPollRequest(guild, body) {
  const request = readPollRequest(body);
  if (!request) return null;
  const message = await buildPollMessage({ guild, ...request });
  return { flags: message.flags, components: message.components.map((component) => (typeof component.toJSON === 'function' ? component.toJSON() : component)) };
}

module.exports = { readPollRequest, renderPollRequest };
