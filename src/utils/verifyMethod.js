// How a server verifies new members: the Cloudflare check (`turnstile`, the default), the letters in a picture (`letters`), or both.
const METHODS = ['turnstile', 'letters', 'both'];

/** The method of a server's settings; anything unknown is the Cloudflare check. */
const methodOf = (settings) => (METHODS.includes(settings?.method) ? settings.method : 'turnstile');
const usesTurnstile = (method) => method !== 'letters';
const usesLetters = (method) => method === 'letters' || method === 'both';

module.exports = { METHODS, methodOf, usesTurnstile, usesLetters };
