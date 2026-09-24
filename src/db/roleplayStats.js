"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRoleplayCounter = getRoleplayCounter;
exports.recordRoleplayResponse = recordRoleplayResponse;
const supabase = require('./supabase');
const { ensureGuild } = require('./guilds');
async function getRoleplayCounter(guildId, userId, action) {
    const { data, error } = await supabase
        .from('roleplay_counters')
        .select('count')
        .eq('guild_id', guildId)
        .eq('user_id', userId)
        .eq('action', action)
        .maybeSingle();
    if (error)
        throw error;
    return Number(data?.count ?? 0) || 0;
}
async function callRecordResponse(input) {
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
async function recordRoleplayResponse(input) {
    let { data, error } = await callRecordResponse(input);
    // A newly joined guild may not have its row yet. Keep the same recovery path
    // used by activity tracking so the first response can still be recorded.
    if (error?.code === '23503') {
        await ensureGuild(input.guildId);
        ({ data, error } = await callRecordResponse(input));
    }
    if (error)
        throw error;
    const row = (Array.isArray(data) ? data[0] : data);
    return {
        claimed: Boolean(row?.claimed),
        counterValue: Number(row?.counter_value ?? 0) || 0,
    };
}
