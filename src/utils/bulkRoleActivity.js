// i18n-ignore-file: internal helper, nothing is shown to anybody here
// Whether a bulk role job (`/role all`, `/role humans`...) is running. Such a job changes the roles of thousands of members one by one and Discord paces that route
// (about ten changes every ten seconds), so waiting on its limit and slow answers is what the job is made of, not a problem to tell the team about every minute:
// utils/perf.js and utils/restTelemetry.js leave those two warnings out while a job runs (they are still counted for `!perf`).
let running = 0;
const ROLE_ROUTE = /\/members\/:id\/roles\/:id$/;

const enter = () => { running += 1; };
const leave = () => { running = Math.max(0, running - 1); };
/** True for the route that gives or takes a role (`PUT /guilds/:id/members/:id/roles/:id`) while a job runs. */
const quietRoute = (route) => running > 0 && ROLE_ROUTE.test(String(route ?? ''));

module.exports = { enter, leave, quietRoute, running: () => running > 0 };
