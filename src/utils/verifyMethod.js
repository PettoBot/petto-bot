// How a server verifies new members: the Cloudflare check (`turnstile`, the default), the letters in a picture on the web page
// (`letters`), both (`both`), or the letters inside Discord itself, with no link at all (`discord`). The `letters` method can also
// be done in Discord: its DM has a button next to the link.
const METHODS = ['turnstile', 'letters', 'both', 'discord'];

/** The method of a server's settings; anything unknown is the Cloudflare check. */
const methodOf = (settings) => (METHODS.includes(settings?.method) ? settings.method : 'turnstile');
const usesTurnstile = (method) => method === 'turnstile' || method === 'both';
const usesLetters = (method) => method === 'letters' || method === 'both' || method === 'discord';
/** Whether the member gets a button in the DM to do the letters without leaving Discord. */
const inDiscord = (method) => method === 'letters' || method === 'discord';
/** Whether the member gets a link to the verification page. */
const usesLink = (method) => method !== 'discord';

module.exports = { METHODS, methodOf, usesTurnstile, usesLetters, inDiscord, usesLink };
