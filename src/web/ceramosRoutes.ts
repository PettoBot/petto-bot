// i18n-ignore-file: routes of the private API; the answers are codes, the website writes the words.
// The routes the page of badges of the website uses (`/api/dashboard/ceramos/...`): the catalog, the state of the person and the actions. The website has already checked
// who the person is (their Discord login), so, like the other dashboard routes, they trust `user_id` once the secret of the website checks out.
// Written in TypeScript: `npm run build:ts` compiles it over web/ceramosRoutes.js.
interface Request { query: Record<string, unknown>; body?: unknown; params?: Record<string, string> }
interface Response { status(code: number): Response; json(body: unknown): void; headersSent: boolean; set(name: string, value: string): Response; send(body: unknown): void }
const api = require('../utils/ceramosApi') as typeof import('../utils/ceramosApi');
const admin = require('../utils/badgeAdmin') as typeof import('../utils/badgeAdmin');
const customDb = require('../db/customBadges') as typeof import('../db/customBadges');
const shopAdmin = require('../utils/shopAdmin') as typeof import('../utils/shopAdmin');
const shopDb = require('../db/shop') as typeof import('../db/shop');
const planAdmin = require('../utils/planAdmin') as typeof import('../utils/planAdmin');
const cardDesigns = require('../utils/cardDesigns') as { getDesign: (id: string) => unknown; designFile: (id: string, thumb: boolean) => { type: string; bytes: Buffer } | null };
const config = require('../config') as { ownerId: string };
const logger = require('../utils/logger') as { error: (...args: unknown[]) => void };

const ID = /^\d{15,25}$/;
const BADGE = /^[a-z0-9-]{1,40}$/;
const KIND = /^(banner|font)$/;
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
  app.get('/api/dashboard/ceramos/ledger', limiter, guard(false, async (userId) => api.ledger(userId)));
  app.post('/api/dashboard/ceramos/daily', limiter, guard(true, async (userId) => ({ result: await api.claim(userId) })));
  app.post('/api/dashboard/ceramos/buy', limiter, guard(true, async (userId, body) => { const id = badgeOf(body); return { result: id ? await api.buy(userId, id) : bad }; }));
  app.post('/api/dashboard/ceramos/upgrade', limiter, guard(true, async (userId, body) => { const id = badgeOf(body); return { result: id ? await api.upgrade(userId, id) : bad }; }));
  app.post('/api/dashboard/ceramos/identity', limiter, guard(true, async (userId, body) => {
    const id = badgeOf(body);
    return { result: id && typeof body.enabled === 'boolean' ? await api.setIdentity(userId, id, body.enabled) : bad };
  }));
  const itemOf = (body: Record<string, unknown>): { kind: 'banner' | 'font'; id: string } | null => (
    typeof body.kind === 'string' && KIND.test(body.kind) && typeof body.id === 'string' && BADGE.test(body.id) ? { kind: body.kind as 'banner' | 'font', id: body.id } : null);
  app.post('/api/dashboard/ceramos/buy-item', limiter, guard(true, async (userId, body) => { const item = itemOf(body); return { result: item ? await api.buyItem(userId, item.kind, item.id) : bad }; }));
  app.post('/api/dashboard/ceramos/buy-pack', limiter, guard(true, async (userId, body) => { const id = badgeOf({ badge: body.id }); return { result: id ? await api.buyPack(userId, id) : bad }; }));
  // Puts a banner or a name font on; `id: null` takes it off.
  app.post('/api/dashboard/ceramos/wear', limiter, guard(true, async (userId, body) => {
    if (typeof body.kind !== 'string' || !KIND.test(body.kind)) return { result: bad };
    if (body.id === null) return { result: await api.wear(userId, body.kind as 'banner' | 'font', null) };
    const item = itemOf(body);
    return { result: item ? await api.wear(userId, item.kind, item.id) : bad };
  }));
  // The rank card of a person (the page "Rank card"): what they saved, saving it (the two-color bar costs ceramos once), and putting it back to the default one.
  app.get('/api/dashboard/ceramos/rank-card', limiter, guard(false, async (userId) => api.rankCardState(userId)));
  app.post('/api/dashboard/ceramos/rank-card-save', limiter, guard(true, async (userId, body) => ({ result: await api.rankCardSave(userId, body.settings) })));
  app.post('/api/dashboard/ceramos/rank-card-reset', limiter, guard(true, async (userId) => { await api.rankCardReset(userId); return { result: { ok: true } }; }));
  app.get('/api/dashboard/ceramos/design-file/:id/:size', limiter, async (req: Request, res: Response) => {
    if (!isAuthorized(req)) { res.status(401).json({ ok: false, error: 'unauthorized' }); return; }
    const id = req.params?.id ?? '';
    const file = BADGE.test(id) && cardDesigns.getDesign(id) && (req.params?.size === 'thumb' || req.params?.size === 'full') ? cardDesigns.designFile(id, req.params.size === 'thumb') : null;
    if (!file) { res.status(404).json({ ok: false, error: 'not_found' }); return; }
    res.set('Content-Type', file.type).set('Cache-Control', 'public, max-age=3600').send(file.bytes);
  });
  // A pack of ceramos that was paid: the website sends the order of the payment service; the same order gives the ceramos only once.
  app.post('/api/dashboard/ceramos/credit-refund', limiter, guard(true, async (_userId, body) => ({ result: await api.refundPack(String(body.order ?? '')) })));
  app.post('/api/dashboard/ceramos/credit-pack', limiter, guard(true, async (userId, body) => ({ result: await api.creditPack(userId, String(body.pack ?? ''), String(body.order ?? '')) })));
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
  // Own pictures: what the person can do, the policy, sending a picture (it waits for review), and what the owner does in the queue.
  app.get('/api/dashboard/ceramos/upload-state', limiter, guard(false, async (userId) => api.uploads.state(userId)));
  app.post('/api/dashboard/ceramos/upload-policy', limiter, guard(true, async (userId) => api.uploads.acceptPolicy(userId)));
  app.post('/api/dashboard/ceramos/upload-submit', limiter, raw, guard(true, async (userId, _body, req) => api.uploads.submit(userId, (req as unknown as { body?: unknown }).body)));
  app.get('/api/dashboard/ceramos/admin/uploads', limiter, owner(false, async () => api.uploads.queue()));
  app.post('/api/dashboard/ceramos/admin/upload-review', limiter, owner(true, async (userId, body) => api.uploads.review(userId, body)));
  app.get('/api/dashboard/ceramos/admin/upload-file', limiter, async (req: Request, res: Response) => {
    if (!isAuthorized(req) || String(req.query.user_id ?? '') !== String(config.ownerId)) { res.status(401).json({ ok: false, error: 'unauthorized' }); return; }
    const bytes = await api.uploads.pendingFile(String(req.query.person ?? '')).catch(() => null);
    if (!bytes) { res.status(404).json({ ok: false, error: 'not_found' }); return; }
    res.set('Content-Type', 'image/webp').set('Cache-Control', 'private, no-store').send(bytes);
  });
  // The streaks of a person in the servers where they have been active.
  app.get('/api/dashboard/ceramos/streaks', limiter, guard(false, async (userId) => api.streaksMine(userId)));
  app.get('/api/dashboard/ceramos/summary', limiter, guard(false, async (userId) => api.summaryOf(userId)));
  // The missions: the list with the progress, and claiming one (`id`) or every finished one.
  app.get('/api/dashboard/ceramos/missions', limiter, guard(false, async (userId) => api.missionsList(userId)));
  app.post('/api/dashboard/ceramos/missions-claim', limiter, guard(true, async (userId, body) => api.missionsClaim(userId, body.id)));
  // The keys of the read-only API (a person makes, sees and removes their own) and what a key reads. The reads need no person: the key says who.
  app.get('/api/dashboard/ceramos/api-keys', limiter, guard(false, async (userId) => api.apiKeys.list(userId)));
  app.post('/api/dashboard/ceramos/api-key-create', limiter, guard(true, async (userId, body) => api.apiKeys.create(userId, body)));
  app.post('/api/dashboard/ceramos/api-key-remove', limiter, guard(true, async (userId, body) => api.apiKeys.remove(userId, body)));
  const publicRead = (what: 'me' | 'movements') => async (req: Request, res: Response) => {
    if (!isAuthorized(req)) { res.status(401).json({ ok: false, error: 'unauthorized' }); return; }
    try { res.json(await api.apiKeys.read((req.body as Record<string, unknown> | undefined)?.key, what)); } catch (error) { logger.error('The read-only API failed:', (error as Error).message); if (!res.headersSent) res.status(500).json({ ok: false, error: 'failed' }); }
  };
  app.post('/api/dashboard/ceramos/public/me', limiter, publicRead('me'));
  app.post('/api/dashboard/ceramos/public/movements', limiter, publicRead('movements'));
  app.get('/api/dashboard/ceramos/public/info', limiter, (req: Request, res: Response) => { if (!isAuthorized(req)) { res.status(401).json({ ok: false, error: 'unauthorized' }); return; } res.json(api.apiKeys.publicInfo()); });
  // Giving ceramos from the dashboard: the owner and the people the owner lists (the bot checks who is asking), with limits the owner sets.
  app.get('/api/dashboard/ceramos/admin/grant', limiter, guard(false, async (userId) => api.grantState(userId, String(config.ownerId))));
  app.post('/api/dashboard/ceramos/admin/grant', limiter, guard(true, async (userId, body) => api.grantCeramos(userId, String(config.ownerId), body)));
  app.post('/api/dashboard/ceramos/admin/grant-settings', limiter, owner(true, async (_userId, body) => api.grantSaveSettings(body)));
  // The plans of the people: who has one, give one, end one.
  app.get('/api/dashboard/ceramos/admin/plans', limiter, owner(false, async () => planAdmin.list()));
  app.post('/api/dashboard/ceramos/admin/plan-grant', limiter, owner(true, async (userId, body) => planAdmin.grant(userId, body)));
  app.post('/api/dashboard/ceramos/admin/plan-end', limiter, owner(true, async (_userId, body) => planAdmin.end(body)));
  // The rest of the editor: packs, banners and name fonts, and the changes to the badges of the code.
  app.get('/api/dashboard/ceramos/admin/shop', limiter, owner(false, async () => shopAdmin.list()));
  app.post('/api/dashboard/ceramos/admin/pack', limiter, owner(true, async (_userId, body) => shopAdmin.savePack(body)));
  app.post('/api/dashboard/ceramos/admin/pack-active', limiter, owner(true, async (_userId, body) => {
    const id = badgeOf({ badge: body.id });
    return id && typeof body.active === 'boolean' ? shopAdmin.setPackActive(id, body.active) : bad;
  }));
  app.post('/api/dashboard/ceramos/admin/item', limiter, owner(true, async (userId, body) => shopAdmin.saveItem(userId, body)));
  app.post('/api/dashboard/ceramos/admin/item-active', limiter, owner(true, async (_userId, body) => {
    const item = itemOf(body);
    return item && typeof body.active === 'boolean' ? shopAdmin.setItemActive(item.kind, item.id, body.active) : bad;
  }));
  app.post('/api/dashboard/ceramos/admin/item-file', limiter, raw, owner(true, async (_userId, _body, req) => {
    const id = badgeOf({ badge: req.query.id });
    const kind = typeof req.query.kind === 'string' && KIND.test(req.query.kind) ? req.query.kind : null;
    const bytes = (req as unknown as { body?: unknown }).body;
    return id && kind && Buffer.isBuffer(bytes) ? shopAdmin.setItemFile(kind, id, bytes) : bad;
  }));
  app.post('/api/dashboard/ceramos/admin/override', limiter, owner(true, async (_userId, body) => shopAdmin.saveOverride(body)));
  app.post('/api/dashboard/ceramos/admin/override-reset', limiter, owner(true, async (_userId, body) => {
    const id = badgeOf({ badge: body.id });
    return id ? shopAdmin.resetOverride(id) : bad;
  }));
  app.post('/api/dashboard/ceramos/admin/override-image', limiter, raw, owner(true, async (_userId, _body, req) => {
    const id = badgeOf({ badge: req.query.id });
    const bytes = (req as unknown as { body?: unknown }).body;
    return id && Buffer.isBuffer(bytes) ? shopAdmin.setOverrideImage(id, bytes) : bad;
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
    const stored = id ? (await customDb.getCustomImage(id).catch(() => null)) ?? (await shopDb.getOverrideImage(id).catch(() => null)) : null;
    if (!stored) { res.status(404).json({ ok: false, error: 'not_found' }); return; }
    res.set('Content-Type', stored.type).set('Cache-Control', 'public, max-age=300').send(stored.bytes);
  });
  // The file of a banner (its picture) or of a name font, for the website to show (a font is sent so the page can draw a sample with it).
  app.get('/api/dashboard/ceramos/item-file/:kind/:id', limiter, async (req: Request, res: Response) => {
    if (!isAuthorized(req)) { res.status(401).json({ ok: false, error: 'unauthorized' }); return; }
    const id = badgeOf({ badge: req.params?.id });
    const kind = typeof req.params?.kind === 'string' && KIND.test(req.params.kind) ? req.params.kind as 'banner' | 'font' : null;
    const stored = id && kind ? await shopDb.getItemFile(kind, id).catch(() => null) : null;
    if (!stored) { res.status(404).json({ ok: false, error: 'not_found' }); return; }
    res.set('Content-Type', stored.type).set('Cache-Control', 'public, max-age=300').send(stored.bytes);
  });
}
