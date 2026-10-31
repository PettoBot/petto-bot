const families = ['fruits', 'animals', 'flowers', 'nature'];
module.exports = families.flatMap((name) => require(`./${name}`));
