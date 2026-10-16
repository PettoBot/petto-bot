// Parts of Petto that are paused for a while. Backups are kept as they are (the code, the saved backups and the schedules) but cannot be
// used by anyone except the owner and the developers: the command and its panel say they are under maintenance, and the scheduled backups
// are not taken. The dashboard shows the same notice. Setting BACKUPS_MAINTENANCE=off brings them back for everyone.
const config = require('../config');

const backupsPaused = () => String(process.env.BACKUPS_MAINTENANCE ?? '').toLowerCase() !== 'off';

/** Whether the person is part of the team of Petto: its owner or one of its developers. */
const isTeam = (userId) => Boolean(userId) && (userId === config.ownerId || (config.developerIds ?? []).includes(userId));

/** Whether backups are closed for this person: they are paused and the person is not part of the team. */
const backupsUnderMaintenance = (userId) => backupsPaused() && !isTeam(userId);

module.exports = { backupsPaused, backupsUnderMaintenance, isTeam };
