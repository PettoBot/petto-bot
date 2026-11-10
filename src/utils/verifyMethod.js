// How a server verifies new members: the Cloudflare check (`turnstile`, the default), the letters in a picture on the web page
// (`letters`), both (`both`), or the letters inside Discord itself, with no link at all (`discord`). The `letters` method can also
// be done in Discord: its DM has a button next to the link. `email` is the code that is sent to the email of the member and nothing else (no captcha):
// it proves that the member has an inbox, not that they are a person, so the page says so to the staff and the extra checks stay available.
const METHODS = ['turnstile', 'letters', 'both', 'discord', 'email'];

/** The method of a server's settings; anything unknown is the Cloudflare check. */
const methodOf = (settings) => (METHODS.includes(settings?.method) ? settings.method : 'turnstile');
const usesTurnstile = (method) => method === 'turnstile' || method === 'both';
const usesLetters = (method) => method === 'letters' || method === 'both' || method === 'discord';
/** Whether the member gets a button in the DM to do the letters without leaving Discord. */
const inDiscord = (method) => method === 'letters' || method === 'discord';
/** Whether the email code is the whole check. */
const usesEmail = (method) => method === 'email';
/** Whether the member gets a link to the verification page. */
const usesLink = (method) => method !== 'discord';

/**
 * Whether the DM with the way to verify goes to a member who joins. It can be turned off (`dm_on_join`), but only when the server has a panel in a
 * channel: with no DM and no panel nobody could verify, so then the DM is sent anyway.
 */
const sendsJoinDm = (settings) => settings?.dm_on_join !== false || !settings?.panel_channel_id;

module.exports = { METHODS, methodOf, usesTurnstile, usesLetters, usesEmail, inDiscord, usesLink, sendsJoinDm };
