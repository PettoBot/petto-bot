// i18n-ignore-file: answers are codes; the website writes the words.
// The detector of pictures: before an own picture goes to the team, the moderation service of OpenAI (model omni-moderation-latest, which reads pictures, free to call) looks at it.
// What it finds is kept apart: a picture with a minor in a sexual way is never kept (the person is blocked and the team can undo it), a picture it flags as sexual, graphically violent or hateful
// is not accepted, and a picture it finds nothing in goes to the team marked as checked. The detector helps, it does not replace the team: every picture is still looked at by a person.
// It is off without `OPENAI_API_KEY` or with `PETTO_IMAGE_SCREEN=false`, and when the service does not answer the picture goes to the team as not checked (it never blocks a person by a failure).
// Written in TypeScript: `npm run build:ts` compiles it over imageScreen.js.
export type Verdict = { checked: false } | { checked: true; minor: boolean; reasons: ('sexual' | 'violence' | 'hate')[] };

const ENDPOINT = 'https://api.openai.com/v1/moderations';
const TIMEOUT_MS = 10_000;

/** What the service says about one category, from its answer: `categories` are the yes or no, `category_scores` how sure. A score alone is not enough to block someone: only the yes counts. */
export function readAnswer(answer: unknown): Verdict {
  const result = (answer as { results?: { categories?: Record<string, boolean> }[] } | null)?.results?.[0];
  const categories = result?.categories;
  if (!categories || typeof categories !== 'object') return { checked: false };
  const reasons: ('sexual' | 'violence' | 'hate')[] = [];
  if (categories.sexual) reasons.push('sexual');
  if (categories['violence/graphic']) reasons.push('violence');
  if (categories.hate || categories['hate/threatening']) reasons.push('hate');
  return { checked: true, minor: Boolean(categories['sexual/minors']), reasons };
}

/** Looks at a picture (webp bytes). Never throws: a failure is `{ checked: false }`. */
export async function screen(bytes: Buffer, fetcher: typeof fetch = fetch): Promise<Verdict> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key || process.env.PETTO_IMAGE_SCREEN === 'false') return { checked: false };
  try {
    const response = await fetcher(ENDPOINT, {
      method: 'POST', signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'omni-moderation-latest', input: [{ type: 'image_url', image_url: { url: `data:image/webp;base64,${bytes.toString('base64')}` } }] }),
    });
    if (!response.ok) return { checked: false };
    return readAnswer(await response.json().catch(() => null));
  } catch { return { checked: false }; }
}
