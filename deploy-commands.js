const { deployCommands } = require('./src/handlers/deployCommands');
const logger = require('./src/utils/logger');

deployCommands({ force: true, strict: true }).catch((err) => {
  logger.error('Failed to deploy commands:', err);
  process.exit(1);
});
