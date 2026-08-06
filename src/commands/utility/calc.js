const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const { COLORS } = require('../../utils/colors');

class Calculator {
  constructor(expression) {
    this.expression = expression;
    this.tokens = expression.match(/(?:\d+(?:\.\d*)?|\.\d+)|[()+\-*/%^]/g) ?? [];
    this.position = 0;
    if (!this.tokens.length || this.tokens.join('') !== expression.replace(/\s+/g, '')) throw new Error('Only numbers, parentheses, and arithmetic operators are supported.');
  }

  current() { return this.tokens[this.position]; }
  take(token) { if (this.current() === token) { this.position += 1; return true; } return false; }

  parse() {
    const result = this.additive();
    if (this.position !== this.tokens.length) throw new Error('The expression has an unexpected operator or value.');
    if (!Number.isFinite(result) || Math.abs(result) > 1e100) throw new Error('That result is too large or not a finite number.');
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
      if ((operator === '/' || operator === '%') && next === 0) throw new Error('Division by zero is not allowed.');
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
      if (!this.take(')')) throw new Error('A closing parenthesis is missing.');
      return value;
    }
    const value = Number(this.tokens[this.position++]);
    if (!Number.isFinite(value)) throw new Error('A number was expected.');
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
    const expression = interaction.options.getString('expression', true).trim();
    if (expression.length > 120) {
      await interaction.reply({ content: 'Keep the expression under 120 characters.' });
      return;
    }

    try {
      const result = new Calculator(expression).parse();
      const embed = new EmbedBuilder().setColor(COLORS.DEFAULT).setTitle('Calculator').setDescription(`\`${expression}\`\n\n**${formatResult(result)}**`);
      await interaction.reply({ embeds: [embed] });
    } catch (error) {
      await interaction.reply({ content: `I could not calculate that: ${error.message}` });
    }
  },
};
