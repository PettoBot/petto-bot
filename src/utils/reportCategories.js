// What a member can pick when reporting. The value is stored with the report and shown on its card. The English labels are
// the choices of `/report send` (choice names stay in English); the cards and the form show them in the server's language.
const { t, currentLanguage } = require('../i18n');

const CATEGORY_VALUES = ['spam', 'harassment', 'hate', 'nsfw', 'scam', 'threats', 'impersonation', 'other'];

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
  }));
}

module.exports = { REPORT_CATEGORIES, DEFAULT_CATEGORY, categoryLabel, categoryOptions, isReportCategory };
