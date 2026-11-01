// What a member can pick when reporting. The value is stored with the report and shown on its card. The English labels are
// the choices of `/report send` (choice names stay in English); the cards and the form show them in the server's language.
const { t, currentLanguage } = require('../i18n');
const { EMOJI } = require('./emojis');

const CATEGORY_VALUES = ['spam', 'harassment', 'hate', 'nsfw', 'scam', 'threats', 'impersonation', 'other'];

// The icon of each category in the menu of the report form.
const CATEGORY_EMOJI = {
  spam: EMOJI.SPAM, harassment: EMOJI.SPEECH, hate: EMOJI.SPEECH, nsfw: EMOJI.NSFW, scam: EMOJI.SCAM,
  threats: EMOJI.REPORT_IMPORTANT, impersonation: EMOJI.MASK, other: EMOJI.QUESTION,
};

const REPORT_CATEGORIES = CATEGORY_VALUES.map((value) => ({
  value,
  label: t('en', `reports.category.${value}.label.menu`),
  description: t('en', `reports.category.${value}.description.menu`),
}));

const DEFAULT_CATEGORY = 'other';

function isReportCategory(value) {
  return CATEGORY_VALUES.includes(value);
}

function categoryLabel(value, lang = currentLanguage()) {
  return t(lang, `reports.category.${isReportCategory(value) ? value : DEFAULT_CATEGORY}.label.menu`);
}

/** The categories as options of a select menu, in `lang`. */
function categoryOptions(lang = currentLanguage()) {
  return CATEGORY_VALUES.map((value) => ({
    value,
    label: t(lang, `reports.category.${value}.label.menu`),
    description: t(lang, `reports.category.${value}.description.menu`),
    emoji: CATEGORY_EMOJI[value],
  }));
}

// The form that reports a direct message to the Petto team (utils/dmReports.js) offers the same choices plus one of its own: a direct message
// that a server had Petto deliver and that should not have come. It is not a choice of `/report send` (that one reports a member to a server).
const DM_ABUSE = 'dm_abuse';
const DM_CATEGORY_VALUES = [DM_ABUSE, ...CATEGORY_VALUES];

function isDmReportCategory(value) {
  return DM_CATEGORY_VALUES.includes(value);
}

/** The categories of the form that reports a direct message, as options of a select menu, in `lang`. */
function dmCategoryOptions(lang = currentLanguage()) {
  return DM_CATEGORY_VALUES.map((value) => (value === DM_ABUSE
    ? { value, label: t(lang, 'dm.category.dm_abuse.label.menu'), description: t(lang, 'dm.category.dm_abuse.description.menu'), emoji: EMOJI.ALERT }
    : categoryOptions(lang).find((option) => option.value === value)));
}

module.exports = { DM_ABUSE, DM_CATEGORY_VALUES, isDmReportCategory, dmCategoryOptions, CATEGORY_EMOJI, REPORT_CATEGORIES, DEFAULT_CATEGORY, categoryLabel, categoryOptions, isReportCategory };
