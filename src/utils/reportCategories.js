// What a member can pick when reporting. The value is stored with the report and shown on its card.
const REPORT_CATEGORIES = [
  { value: 'spam', label: 'Spam or advertising', description: 'Unwanted ads, invites or message flooding.' },
  { value: 'harassment', label: 'Harassment or bullying', description: 'Targeting, insulting or pestering a member.' },
  { value: 'hate', label: 'Hate speech', description: 'Slurs or content attacking a group of people.' },
  { value: 'nsfw', label: 'NSFW or graphic content', description: 'Adult or disturbing content outside allowed channels.' },
  { value: 'scam', label: 'Scam or phishing', description: 'Fake giveaways, stolen accounts or malicious links.' },
  { value: 'threats', label: 'Threats or self-harm', description: 'Threats of violence or someone at risk.' },
  { value: 'impersonation', label: 'Impersonation', description: 'Pretending to be staff or another member.' },
  { value: 'other', label: 'Something else', description: 'Anything that does not fit the other options.' },
];

const DEFAULT_CATEGORY = 'other';

function categoryLabel(value) {
  return REPORT_CATEGORIES.find((category) => category.value === value)?.label ?? REPORT_CATEGORIES.find((category) => category.value === DEFAULT_CATEGORY).label;
}

function isReportCategory(value) {
  return REPORT_CATEGORIES.some((category) => category.value === value);
}

module.exports = { REPORT_CATEGORIES, DEFAULT_CATEGORY, categoryLabel, isReportCategory };
