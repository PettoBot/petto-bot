// i18n-ignore-file: routes of the private API; the answers are codes, the website writes the words.
// The routes the page of badges of the website uses (`/api/dashboard/ceramos/...`): the catalog, the state of the person and the actions. The website has already checked
// who the person is (their Discord login), so, like the other dashboard routes, they trust `user_id` once the secret of the website checks out.
// Written in TypeScript: `npm run build:ts` compiles it over web/ceramosRoutes.js.
interface Request { query: Record<string, unknown>; body?: unknown; params?: Record<string, string> }
interface Response { status(code: number): Response; json(body: unknown): void; headersSent: boolean; set(name: string, value: string): Response; send(body: unknown): void }
const api = require('../utils/ceramosApi') as typeof import('../utils/ceramosApi');
const admin = require('../utils/badgeAdmin') as typeof import('../utils/badgeAdmin');
const customDb = require('../db/customBadges') as typeof import('../db/customBadges');
const config = require('../config') as { ownerId: string };
const logger = require('../utils/logger') as { error: (...args: unknown[]) => void };

const ID = /^\d{15,25}$/;
const BADGE = /^[a-z0-9-]{1,40}$/;
const WRITES_PER_MINUTE = 40;
const writes = new Map<string, number[]>();

function limited(userId: string): boolean {
  const now = Date.now();
  const recent = (writes.get(userId) ?? []).filter((at) => now - at < 60_000);
  if (recent.length >= WRITES_PER_MINUTE) { writes.set(userId, recent); return true; }
  recent.push(now); writes.set(userId, recent);
  if (writes.size > 5000) for (const [key, list] of writes) if (!list.some((at) => now - at < 60_000)) writes.delete(key);
  return false;
}

interface Deps { isAuthorized: (req: Request) => boolean; limiter: unknown; raw: unknown }

export function registerCeramosRoutes(app: { get: (...a: unknown[]) => void; post: (...a: unknown[]) => void }, { isAuthorized, limiter, raw }: Deps): void {
  const guard = (write: boolean, handler: (userId: string, body: Record<string, unknown>, req: Request) => Promise<unknown>) => async (req: Request, res: Response) => {
    if (!isAuthorized(req)) { res.status(401).json({ ok: false, error: 'unauthorized' }); return; }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const userId = String(req.query.user_id ?? body.user_id ?? '');
    if (!ID.test(userId)) { res.status(400).json({ ok: false, error: 'bad_request' }); return; }
    if (write && limited(userId)) { res.status(429).json({ ok: false, error: 'rate_limited' }); return; }
    try { res.json({ ok: true, ...(await handler(userId, body, req) as object) }); } catch (error) {
      logger.error('The page of badges failed:', (error as Error).message);
      if (!res.headersSent) res.status(500).json({ ok: false, error: 'failed' });
    }
  };
  const badgeOf = (body: Record<string, unknown>): string | null => (typeof body.badge === 'string' && BADGE.test(body.badge) ? body.badge : null);
  const bad = { ok: false as const, reason: 'bad_request' };

  app.get('/api/dashboard/ceramos/catalog', limiter, guard(false, async () => api.catalog()));
  app.get('/api/dashboard/ceramos/state', limiter, guard(false, async (userId) => api.state(userId)));
  app.post('/api/dashboard/ceramos/daily', limiter, guard(true, async (userId) => ({ result: await api.claim(userId) })));
  app.post('/api/dashboard/ceramos/buy', limiter, guard(true, async (userId, body) => { const id = badgeOf(body); return { result: id ? await api.buy(userId, id) : bad }; }));
  app.post('/api/dashboard/ceramos/upgrade', limiter, guard(true, async (userId, body) => { const id = badgeOf(body); return { result: id ? await api.upgrade(userId, id) : bad }; }));
  app.post('/api/dashboard/ceramos/identity', limiter, guard(true, async (userId, body) => {
    const id = badgeOf(body);
    return { result: id && typeof body.enabled === 'boolean' ? await api.setIdentity(userId, id, body.enabled) : bad };
  }));
  app.post('/api/dashboard/ceramos/showcase', limiter, guard(true, async (userId, body) => {
    const list = Array.isArray(body.badges) ? body.badges.filter((id): id is string => typeof id === 'string' && BADGE.test(id)).slice(0, 6) : null;
    return { result: list ? { ok: true, ...(await api.saveShowcase(userId, list)) } : bad };
  }));

  // The editor of badges: only the owner (the website says who is logged in, and the bot checks it is the owner).
  const owner = (write: boolean, handler: (userId: string, body: Record<string, unknown>, req: Request) => Promise<unknown>) => guard(write, async (userId, body, req) => {
    if (String(userId) !== String(config.ownerId)) return { ok: false, error: 'forbidden' };
    return handler(userId, body, req);
  });
  app.get('/api/dashboard/ceramos/admin/badges', limiter, owner(false, async () => admin.list()));
  app.post('/api/dashboard/ceramos/admin/badge', limiter, owner(true, async (userId, body) => admin.save(userId, body)));
  app.post('/api/dashboard/ceramos/admin/badge-active', limiter, owner(true, async (_userId, body) => {
    const id = badgeOf({ badge: body.id });
    return id && typeof body.active === 'boolean' ? admin.setActive(id, body.active) : bad;
  }));
  // The picture comes as the bytes themselves (not in JSON, which is limited to 100 KB): `?user_id=...&id=...`.
  app.post('/api/dashboard/ceramos/admin/badge-image', limiter, raw, owner(true, async (_userId, _body, req) => {
    const id = badgeOf({ badge: req.query.id });
    const bytes = (req as unknown as { body?: unknown }).body;
    return id && Buffer.isBuffer(bytes) ? admin.setImage(id, bytes) : bad;
  }));
  // The picture of a badge of the editor, for the website to show (any person sees it: it is on the badges everybody shows).
  app.get('/api/dashboard/ceramos/badge-art/:id', limiter, async (req: Request, res: Response) => {
    if (!isAuthorized(req)) { res.status(401).json({ ok: false, error: 'unauthorized' }); return; }
    const id = badgeOf({ badge: req.params?.id });
    const stored = id ? await customDb.getCustomImage(id).catch(() => null) : null;
    if (!stored) { res.status(404).json({ ok: false, error: 'not_found' }); return; }
    res.set('Content-Type', stored.type).set('Cache-Control', 'public, max-age=300').send(stored.bytes);
  });
}
