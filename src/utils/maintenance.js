// Parts of Petto that are paused for a while. Backups are kept as they are (the code, the saved backups and the schedules) but cannot be
// used: the command and its panel say they are under maintenance, and the scheduled backups are not taken. The dashboard shows the same
// notice. Setting BACKUPS_MAINTENANCE=off brings them back.
const backupsUnderMaintenance = () => String(process.env.BACKUPS_MAINTENANCE ?? '').toLowerCase() !== 'off';

module.exports = { backupsUnderMaintenance };
