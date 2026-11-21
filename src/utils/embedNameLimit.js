/**
 * The longest name an embed can have. The buttons of the panel carry it in their custom id (`eb_description::<user id>::<name>`) and Discord
 * allows 100 characters there: 16 for the longest word, 2+2 for the separators and up to 20 for the user id leave 60; 50 keeps a margin.
 */
const MAX_NAME_LENGTH = 50;

module.exports = { MAX_NAME_LENGTH };
