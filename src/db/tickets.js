// Persistence helpers for ticket panels, categories, and ticket records.
const supabase = require('./supabase');

async function createPanel({ guildId, channelId, title, description, embedTemplate, style }) {
  const { data, error } = await supabase
    .from('ticket_panels')
    .insert({ guild_id: guildId, channel_id: channelId, title, description, embed_template: embedTemplate, style: style ?? 'button' })
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

async function setPanelMessageId(panelId, messageId) {
  const { error } = await supabase.from('ticket_panels').update({ message_id: messageId }).eq('id', panelId);
  if (error) throw error;
}

async function getPanel(guildId, panelId) {
  const { data, error } = await supabase.from('ticket_panels').select('*').eq('guild_id', guildId).eq('id', panelId).maybeSingle();
  if (error) throw error;
  return data;
}

async function listPanels(guildId) {
  const { data, error } = await supabase.from('ticket_panels').select('*').eq('guild_id', guildId).order('id', { ascending: true });
  if (error) throw error;
  return data;
}

async function deletePanel(guildId, panelId) {
  const { data, error } = await supabase.from('ticket_panels').delete().eq('guild_id', guildId).eq('id', panelId).select('id');
  if (error) throw error;
  return data.length > 0;
}

/** Moving a panel to a new channel clears message_id, the old message isn't followed, a fresh one gets posted there. */
async function movePanel(guildId, panelId, channelId) {
  const { data, error } = await supabase.from('ticket_panels').update({ channel_id: channelId, message_id: null }).eq('guild_id', guildId).eq('id', panelId).select('*').single();
  if (error) throw error;
  return data;
}

async function updatePanel(guildId, panelId, patch) {
  const { data, error } = await supabase.from('ticket_panels').update(patch).eq('guild_id', guildId).eq('id', panelId).select('*').single();
  if (error) throw error;
  return data;
}

function normalizeKey(key) {
  return key.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
}

async function createCategory({ guildId, panelId, key, label, emoji, buttonStyle, description, parentChannelId, supportRoleIds, pingRoleIds, welcomeEmbedTemplate, namingPattern, maxOpenPerUser, formId, requiredRoleIds }) {
  const { data, error } = await supabase
    .from('ticket_categories')
    .insert({
      guild_id: guildId,
      panel_id: panelId ?? null,
      key: normalizeKey(key),
      label,
      emoji: emoji ?? null,
      button_style: buttonStyle ?? 'primary',
      description: description ?? null,
      parent_channel_id: parentChannelId ?? null,
      support_role_ids: supportRoleIds ?? [],
      ping_role_ids: pingRoleIds ?? [],
      welcome_embed_template: welcomeEmbedTemplate ?? null,
      naming_pattern: namingPattern ?? 'ticket-{number}',
      max_open_per_user: maxOpenPerUser ?? 1,
      form_id: formId ?? null,
      required_role_ids: requiredRoleIds ?? [],
    })
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

async function getCategoryByKey(guildId, key) {
  const { data, error } = await supabase.from('ticket_categories').select('*').eq('guild_id', guildId).eq('key', normalizeKey(key)).maybeSingle();
  if (error) throw error;
  return data;
}

async function getCategoryById(id) {
  const { data, error } = await supabase.from('ticket_categories').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

async function listCategories(guildId, panelId) {
  let query = supabase.from('ticket_categories').select('*').eq('guild_id', guildId).order('id', { ascending: true });
  if (panelId) query = query.eq('panel_id', panelId);
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

async function updateCategory(guildId, key, patch) {
  const { data, error } = await supabase.from('ticket_categories').update(patch).eq('guild_id', guildId).eq('key', normalizeKey(key)).select('*').single();
  if (error) throw error;
  return data;
}

async function deleteCategory(guildId, key) {
  const { data, error } = await supabase.from('ticket_categories').delete().eq('guild_id', guildId).eq('key', normalizeKey(key)).select('id');
  if (error) throw error;
  return data.length > 0;
}

async function createTicket({ guildId, categoryId, openerId }) {
  const { data, error } = await supabase.rpc('create_ticket', { p_guild_id: guildId, p_category_id: categoryId, p_opener_id: openerId });
  if (error) throw error;
  return data;
}

async function setTicketChannel(ticketId, channelId) {
  const { data, error } = await supabase.from('tickets').update({ channel_id: channelId }).eq('id', ticketId).select('*').single();
  if (error) throw error;
  return data;
}

async function setTicketFormData(ticketId, { formId, answers }) {
  const { data, error } = await supabase.from('tickets').update({ form_id: formId ?? null, form_answers: answers ?? {} }).eq('id', ticketId).select('*').single();
  if (error) throw error;
  return data;
}

async function deleteTicketRow(ticketId) {
  const { error } = await supabase.from('tickets').delete().eq('id', ticketId);
  if (error) throw error;
}

async function getTicketById(id) {
  const { data, error } = await supabase.from('tickets').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

async function saveTranscriptHtml(ticketId, html) {
  const { error } = await supabase.from('tickets').update({ transcript_html: html }).eq('id', ticketId);
  if (error) throw error;
}

async function getTicketByChannel(channelId) {
  const { data, error } = await supabase.from('tickets').select('*').eq('channel_id', channelId).maybeSingle();
  if (error) throw error;
  return data;
}

async function getTicketByNumber(guildId, number) {
  const { data, error } = await supabase.from('tickets').select('*').eq('guild_id', guildId).eq('ticket_number', number).maybeSingle();
  if (error) throw error;
  return data;
}

async function countOpenTickets(guildId, categoryId, openerId) {
  const { count, error } = await supabase
    .from('tickets')
    .select('id', { count: 'exact', head: true })
    .eq('guild_id', guildId)
    .eq('category_id', categoryId)
    .eq('opener_id', openerId)
    .eq('status', 'open');

  if (error) throw error;
  return count ?? 0;
}

async function setClaim(ticketId, claimedBy) {
  const { data, error } = await supabase.from('tickets').update({ claimed_by: claimedBy }).eq('id', ticketId).select('*').single();
  if (error) throw error;
  return data;
}

async function closeTicket(ticketId, { closedBy, reason }) {
  const { data, error } = await supabase
    .from('tickets')
    .update({ status: 'closed', closed_by: closedBy, close_reason: reason ?? null, closed_at: new Date().toISOString() })
    .eq('id', ticketId)
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

async function reopenTicket(ticketId) {
  const { data, error } = await supabase.from('tickets').update({ status: 'open', closed_by: null, close_reason: null, closed_at: null }).eq('id', ticketId).select('*').single();
  if (error) throw error;
  return data;
}

/** Bumps last_activity_at on every message in a ticket channel (used by the inactivity autoclose job), optionally also counting a staff reply. */
async function touchActivity(ticketId, { staffMessage = false } = {}) {
  const patch = { last_activity_at: new Date().toISOString() };
  if (staffMessage) {
    const { data: current, error: readError } = await supabase.from('tickets').select('staff_message_count').eq('id', ticketId).maybeSingle();
    if (readError) throw readError;
    patch.staff_message_count = (current?.staff_message_count ?? 0) + 1;
  }
  const { error } = await supabase.from('tickets').update(patch).eq('id', ticketId);
  if (error) throw error;
}

async function listOpenTicketsByOpener(guildId, openerId) {
  const { data, error } = await supabase.from('tickets').select('*').eq('guild_id', guildId).eq('opener_id', openerId).eq('status', 'open');
  if (error) throw error;
  return data;
}

async function listOpenTicketsForGuild(guildId) {
  const { data, error } = await supabase.from('tickets').select('*').eq('guild_id', guildId).eq('status', 'open');
  if (error) throw error;
  return data;
}

module.exports = {
  normalizeKey,
  createPanel,
  setPanelMessageId,
  getPanel,
  listPanels,
  deletePanel,
  movePanel,
  updatePanel,
  createCategory,
  getCategoryByKey,
  getCategoryById,
  listCategories,
  updateCategory,
  deleteCategory,
  createTicket,
  setTicketChannel,
  setTicketFormData,
  deleteTicketRow,
  getTicketById,
  saveTranscriptHtml,
  getTicketByChannel,
  getTicketByNumber,
  countOpenTickets,
  setClaim,
  closeTicket,
  reopenTicket,
  touchActivity,
  listOpenTicketsByOpener,
  listOpenTicketsForGuild,
};
