const { createBoardCommand } = require('../../utils/boardCommand');

// The starboard's opposite: the same board, with the monkey. What the server finds worth a laugh (or a facepalm) goes here.
module.exports = createBoardCommand({ name: 'monkeyboard', label: 'Monkeyboard', aliases: ['mkb', 'monkey'], db: require('../../db/monkeyboard'), description: 'Configure the monkeyboard, the starboard with the monkey.', selfName: 'selfmonkey', variable: 'monkey' });
