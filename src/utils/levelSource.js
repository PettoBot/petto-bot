/**
 * Returns the leveling settings for one XP source without mutating the stored row.
 * Message leveling keeps using the original level_config columns; voice leveling
 * gets its own curve, cap, notification and role settings.
 */
function getVoiceConfig(config) {
  return {
    ...config,
    enabled: config?.voice_enabled ?? config?.enabled ?? false,
    curve_a: config?.voice_curve_a ?? config?.curve_a ?? 1,
    curve_b: config?.voice_curve_b ?? config?.curve_b ?? 50,
    curve_c: config?.voice_curve_c ?? config?.curve_c ?? 100,
    difficulty: config?.voice_difficulty ?? config?.difficulty ?? 2.5,
    rounding: config?.voice_rounding ?? config?.rounding ?? 50,
    max_level: config?.voice_max_level ?? config?.max_level ?? 1000,
    notify_mode: config?.voice_notify_mode ?? 'off',
    notify_channel_id: config?.voice_notify_channel_id ?? null,
    notify_message: config?.voice_notify_message ?? '{EMOJI} {user} reached voice level **{level}**!',
    notify_embed: config?.voice_notify_embed ?? false,
    notify_embed_template: config?.voice_notify_embed_template ?? null,
    notify_every: config?.voice_notify_every ?? 1,
    role_mode: config?.voice_role_mode ?? config?.role_mode ?? 'highest',
    ignored_channel_ids: config?.voice_ignored_channel_ids ?? config?.ignored_channel_ids ?? [],
  };
}

module.exports = { getVoiceConfig };
