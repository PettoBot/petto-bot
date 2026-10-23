const { createBoardCommand } = require('../../utils/boardCommand');

// The same board, with the clown: what the server finds worth a laugh at someone's expense goes here.
module.exports = createBoardCommand({ name: 'clownboard', label: 'Clownboard', aliases: ['cwb', 'clown'], db: require('../../db/clownboard'), description: 'Configure the clownboard, the starboard with the clown.', selfName: 'selfclown', variable: 'clown' });
