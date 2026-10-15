const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const { COLORS } = require('../../utils/colors');
const { t, languageOf, currentLanguage } = require('../../i18n');

class Calculator {
  constructor(expression, lang = currentLanguage()) {
    this.expression = expression;
    this.lang = lang;
    this.tokens = expression.match(/(?:\d+(?:\.\d*)?|\.\d+)|[()+\-*/%^]/g) ?? [];
    this.position = 0;
    if (!this.tokens.length || this.tokens.join('') !== expression.replace(/\s+/g, '')) this.fail('unsupported');
  }

  // The errors are shown to the member, after "I could not calculate that:".
  fail(reason) { throw new Error(t(this.lang, `utility.calc.error.${reason}`)); }

  current() { return this.tokens[this.position]; }
  take(token) { if (this.current() === token) { this.position += 1; return true; } return false; }

  parse() {
    const result = this.additive();
    if (this.position !== this.tokens.length) this.fail('unexpected');
    if (!Number.isFinite(result) || Math.abs(result) > 1e100) this.fail('tooLarge');
    return result;
  }

  additive() {
    let value = this.multiplicative();
    while (this.current() === '+' || this.current() === '-') {
      const operator = this.tokens[this.position++];
      const next = this.multiplicative();
      value = operator === '+' ? value + next : value - next;
    }
    return value;
  }

  multiplicative() {
    let value = this.power();
    while (['*', '/', '%'].includes(this.current())) {
      const operator = this.tokens[this.position++];
      const next = this.power();
      if ((operator === '/' || operator === '%') && next === 0) this.fail('divisionByZero');
      value = operator === '*' ? value * next : operator === '/' ? value / next : value % next;
    }
    return value;
  }

  power() {
    const value = this.unary();
    if (!this.take('^')) return value;
    return value ** this.power();
  }

  unary() {
    if (this.take('+')) return this.unary();
    if (this.take('-')) return -this.unary();
    if (this.take('(')) {
      const value = this.additive();
      if (!this.take(')')) this.fail('closingParenthesis');
      return value;
    }
    const value = Number(this.tokens[this.position++]);
    if (!Number.isFinite(value)) this.fail('numberExpected');
    return value;
  }
}

function formatResult(value) {
  return Number.isInteger(value) ? String(value) : Number(value.toFixed(10)).toString();
}

module.exports = {
  aliases: ['c', 'calculate'],
  data: new SlashCommandBuilder()
    .setName('calc')
    .setDescription('Calculate a simple arithmetic expression.')
    .addStringOption((option) => option.setName('expression').setDescription('Example: (12 + 4) * 3 / 2').setRequired(true)),

  async execute(interaction) {
    const lang = await languageOf(interaction);
    const expression = interaction.options.getString('expression', true).trim();
    if (expression.length > 120) {
      await interaction.reply({ content: t(lang, 'utility.calc.tooLong') });
      return;
    }

    try {
      const result = new Calculator(expression, lang).parse();
      const embed = new EmbedBuilder().setColor(COLORS.DEFAULT).setTitle(t(lang, 'utility.calc.title')).setDescription(`\`${expression}\`\n\n**${formatResult(result)}**`);
      await interaction.reply({ embeds: [embed] });
    } catch (error) {
      await interaction.reply({ content: t(lang, 'utility.calc.failed', { reason: error.message }) });
    }
  },
};
