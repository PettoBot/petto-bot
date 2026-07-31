// In-memory draft store for the /poll builder panel — one draft per user while they're
// building it, never persisted (nothing here matters once the poll is actually posted).
const DRAFT_TTL_MS = 15 * 60_000;

const drafts = new Map();

function getDraft(userId) {
  return drafts.get(userId)?.data;
}

function setDraft(userId, data) {
  clearTimeout(drafts.get(userId)?.timer);
  const timer = setTimeout(() => drafts.delete(userId), DRAFT_TTL_MS);
  drafts.set(userId, { data, timer });
  return data;
}

function ensureDraft(userId) {
  return getDraft(userId) ?? setDraft(userId, { question: null, options: [], image: null, multi: false, duration: null });
}

function deleteDraft(userId) {
  clearTimeout(drafts.get(userId)?.timer);
  drafts.delete(userId);
}

module.exports = { getDraft, setDraft, ensureDraft, deleteDraft };
