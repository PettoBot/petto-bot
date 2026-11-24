"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.premiumUrl = void 0;
exports.backupsAllowed = backupsAllowed;
// i18n-ignore-file: only answers a yes or no; the texts are in the catalog (backup.premium.*).
// Who may make backups: the servers with Premium. Looking at, exporting, restoring and deleting the backups a server already has stays open to everybody (nobody is locked out of their own data),
// and so does the safety backup that is made before a restore. A server without Premium that had scheduled backups keeps the schedule (it is only not run); it runs again with Premium.
// Written in TypeScript: `npm run build:ts` compiles it over backupAccess.js.
const premiumDb = require('../db/premium');
const siteConfig = require('../config');
/** True when the server has Premium now (a failure to know is a no: Premium is fail-closed). */
async function backupsAllowed(guildId) {
    try {
        return Boolean((await premiumDb.getGuildPremium(guildId)).active);
    }
    catch {
        return false;
    }
}
const premiumUrl = () => `${siteConfig.siteUrl ?? 'https://petto.sbs'}/premium`;
exports.premiumUrl = premiumUrl;
