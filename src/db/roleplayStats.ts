import type { SupabaseClient } from '@supabase/supabase-js';

const supabase = require('./supabase') as SupabaseClient;
const { ensureGuild } = require('./guilds') as {
  ensureGuild: (guildId: string) => Promise<unknown>;
};

export type RoleplayResponseKind = 'accepted' | 'rejected';

interface RoleplayCounterRow {
  count?: number | string | null;
}

interface RoleplayResponseRow {
  claimed?: boolean;
  counter_value?: number | string | null;
}

export interface RoleplayResponseInput {
  requestId: string;
  guildId: string;
  messageId: string;
  channelId: string;
  actorId: string;
  targetId: string;
  action: string;
  response: RoleplayResponseKind;
}

export interface RoleplayResponseResult {
  claimed: boolean;
  counterValue: number;
}

export async function getRoleplayCounter(guildId: string, userId: string, action: string): Promise<number> {
  const { data, error } = await supabase
    .from('roleplay_counters')
    .select('count')
    .eq('guild_id', guildId)
    .eq('user_id', userId)
    .eq('action', action)
    .maybeSingle();
  if (error) throw error;
  return Number((data as RoleplayCounterRow | null)?.count ?? 0) || 0;
}

async function callRecordResponse(input: RoleplayResponseInput) {
  return supabase.rpc('record_roleplay_response', {
    p_request_id: input.requestId,
    p_guild_id: input.guildId,
    p_message_id: input.messageId,
    p_channel_id: input.channelId,
    p_actor_id: input.actorId,
    p_target_id: input.targetId,
    p_action: input.action,
    p_response: input.response,
  });
}

export async function recordRoleplayResponse(input: RoleplayResponseInput): Promise<RoleplayResponseResult> {
  let { data, error } = await callRecordResponse(input);

  // A newly joined guild may not have its row yet. Keep the same recovery path
  // used by activity tracking so the first response can still be recorded.
  if (error?.code === '23503') {
    await ensureGuild(input.guildId);
    ({ data, error } = await callRecordResponse(input));
  }

  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as RoleplayResponseRow | null | undefined;
  return {
    claimed: Boolean(row?.claimed),
    counterValue: Number(row?.counter_value ?? 0) || 0,
  };
}
