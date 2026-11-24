// i18n-ignore-file: database layer, nothing here is shown to anyone.
// The rank card a person designed for themselves (table `user_rank_card`). Written in TypeScript: `npm run build:ts` compiles it over db/userRankCard.js.
interface Pool { query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }> }
const { getPrimaryPool } = require('./postgres') as { getPrimaryPool: () => Pool };

export interface RankCardRow { settings: Record<string, unknown>; gradientPaid: boolean }

/** What a person saved, or null when they never designed a card. */
export async function getRankCard(userId: string): Promise<RankCardRow | null> {
  const { rows } = await getPrimaryPool().query('select settings, gradient_paid from user_rank_card where user_id = $1', [userId]);
  return rows[0] ? { settings: (rows[0].settings as Record<string, unknown>) ?? {}, gradientPaid: Boolean(rows[0].gradient_paid) } : null;
}

/** Saves the settings of a person; `paidGradient` marks the two-color bar as paid (it stays paid). */
export async function saveRankCard(userId: string, settings: Record<string, unknown>, paidGradient: boolean): Promise<void> {
  await getPrimaryPool().query(
    `insert into user_rank_card (user_id, settings, gradient_paid) values ($1, $2::jsonb, $3)
     on conflict (user_id) do update set settings = excluded.settings, gradient_paid = user_rank_card.gradient_paid or excluded.gradient_paid, updated_at = now()`,
    [userId, JSON.stringify(settings), paidGradient]);
}

/** Puts the card back to the default one. A two-color bar that was paid stays paid. */
export async function resetRankCard(userId: string): Promise<void> {
  await getPrimaryPool().query("update user_rank_card set settings = '{}'::jsonb, updated_at = now() where user_id = $1", [userId]);
}
