// i18n-ignore-file: only answers a yes or no; the texts are in the catalog (backup.premium.*).
// Who may make backups: the servers with Premium. Looking at, exporting, restoring and deleting the backups a server already has stays open to everybody (nobody is locked out of their own data),
// and so does the safety backup that is made before a restore. A server without Premium that had scheduled backups keeps the schedule (it is only not run); it runs again with Premium.
// Written in TypeScript: `npm run build:ts` compiles it over backupAccess.js.
const premiumDb = require('../db/premium') as { getGuildPremium(guildId: string): Promise<{ active: boolean }> };
const siteConfig = require('../config') as { siteUrl?: string };

/** True when the server has Premium now (a failure to know is a no: Premium is fail-closed). */
export async function backupsAllowed(guildId: string): Promise<boolean> {
  try { return Boolean((await premiumDb.getGuildPremium(guildId)).active); } catch { return false; }
}

export const premiumUrl = (): string => `${siteConfig.siteUrl ?? 'https://petto.sbs'}/premium`;
