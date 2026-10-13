const { createBoardCommand } = require('../../utils/boardCommand');

module.exports = createBoardCommand({ name: 'starboard', label: 'Starboard', aliases: ['stb'], db: require('../../db/starboard'), description: 'Configure the reaction-based starboard.' });
