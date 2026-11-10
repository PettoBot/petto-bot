// A member who leaves the server and joins again has to verify again, even one who verified before: nobody keeps their verification from an
// earlier stay (an account that was taken over would come back through the door), and the sticky roles do not give the verified role back.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check'; // never connected to
const assert = require('node:assert/strict');
const path = require('node:path');

const stub = (relative, exports) => { const resolved = require.resolve(path.join(__dirname, '..', relative)); require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports }; };

let verifyConfig = { enabled: true, method: 'letters', unverified_role_id: 'role-un', verified_role_id: 'role-ok' };
const dms = [];
stub('src/db/guilds.js', { ensureGuild: async () => ({}) });
stub('src/db/verificationConfig.js', { getConfig: async () => verifyConfig });
// Verifying before must not matter on a new join: if the join event asked, this would show.
stub('src/db/verificationRedemptions.js', { hasEverVerified: async () => { throw new Error('the join must not look at earlier verifications'); }, isRedeemed: async () => false, claimRedemption: async () => true, releaseRedemption: async () => {} });
stub('src/utils/verifyRole.js', { ensureUnverifiedRole: async (guild, settings) => ({ id: settings.unverified_role_id }) });
stub('src/utils/verifyLink.js', { verifyLinkFor: () => ({ url: 'https://verify.example.com/v/abc' }) });
stub('src/utils/verifyMessage.js', { sendVerifyDM: async (member) => { dms.push(member.id); } });

const joinEvent = require('../src/events/guildMemberAddVerification');

const makeMember = (id) => {
  const added = [];
  return { id, user: { bot: false }, added, guild: { id: 'g1', name: 'Petto HQ', members: { me: {} } }, client: {}, roles: { add: async (role) => { added.push(role.id ?? role); } } };
};

(async () => {
  // --- the join event: every new member is gated, the ones who verified once too
  const newcomer = makeMember('111111111111111111');
  await joinEvent.execute(newcomer);
  assert.deepEqual(newcomer.added, ['role-un'], 'a new member gets the unverified role');
  assert.deepEqual(dms, ['111111111111111111'], 'and the way to verify');

  const returning = makeMember('222222222222222222'); // verified in an earlier stay (the stub would throw if it were asked)
  await joinEvent.execute(returning);
  assert.deepEqual(returning.added, ['role-un'], 'a member who verified before is gated again');
  assert.ok(!returning.added.includes('role-ok'), 'and does not get the verified role');
  assert.deepEqual(dms.at(-1), '222222222222222222', 'they get the way to verify again');

  verifyConfig = { ...verifyConfig, enabled: false };
  const free = makeMember('333333333333333333');
  await joinEvent.execute(free);
  assert.deepEqual(free.added, [], 'a server without verification gates nobody');
  verifyConfig = { ...verifyConfig, enabled: true };

  // --- the DM can be turned off, but only when the server has a panel in a channel (with neither nobody could verify)
  verifyConfig = { ...verifyConfig, dm_on_join: false, panel_channel_id: '555555555555555555' };
  dms.length = 0;
  const quiet = makeMember('444444444444444444');
  await joinEvent.execute(quiet);
  assert.deepEqual([quiet.added, dms], [['role-un'], []], 'with the DM off and a panel, the member is gated and gets no DM');
  verifyConfig = { ...verifyConfig, panel_channel_id: null };
  const noPanel = makeMember('555555555555555555');
  await joinEvent.execute(noPanel);
  assert.deepEqual([noPanel.added, dms], [['role-un'], ['555555555555555555']], 'with the DM off and no panel it is sent anyway');
  verifyConfig = { ...verifyConfig, dm_on_join: true };

  // --- the email code as the method: with no way to send the email nobody is gated (nobody could verify)
  const appConfig = require('../src/config');
  verifyConfig = { ...verifyConfig, method: 'email' };
  dms.length = 0;
  Object.assign(appConfig, { resendApiKey: null, resendFrom: null });
  const stuck = makeMember('666666666666666666');
  await joinEvent.execute(stuck);
  assert.deepEqual([stuck.added, dms], [[], []], 'the email code without Resend: nobody is gated');
  Object.assign(appConfig, { resendApiKey: 're_check', resendFrom: 'Petto <verify@example.com>' });
  const gated = makeMember('777777777777777777');
  await joinEvent.execute(gated);
  assert.deepEqual([gated.added, dms], [['role-un'], ['777777777777777777']], 'with a way to send it the member is gated and gets the DM');
  Object.assign(appConfig, { resendApiKey: null, resendFrom: null });
  verifyConfig = { ...verifyConfig, method: 'letters' };

  // --- the sticky roles do not give the verified role back
  const restored = [];
  stub('src/db/stickyRoles.js', { getConfig: async () => ({ enabled: true }), takeSnapshot: async () => ({ left_at: new Date().toISOString(), role_ids: ['role-ok', 'role-member', 'role-un'] }) });
  stub('src/db/identity.js', { managedRoleIds: async () => [] });
  stub('src/utils/deadRoles.js', { addRoles: async (member, ids) => { restored.push(ids); return {}; } });
  const sticky = require('../src/events/guildMemberAddStickyRoles');
  const stickyMember = () => ({
    id: '222222222222222222',
    guild: { id: 'g1', members: { me: { roles: { highest: { position: 50 } } } }, roles: { cache: new Map([['role-ok', { position: 2 }], ['role-member', { position: 3 }], ['role-un', { position: 4 }]]) } },
  });
  await sticky.execute(stickyMember());
  assert.deepEqual(restored.at(-1), ['role-member', 'role-un'], 'with verification on, the verified role is not given back');
  verifyConfig = { ...verifyConfig, enabled: false };
  await sticky.execute(stickyMember());
  assert.deepEqual(restored.at(-1), ['role-ok', 'role-member', 'role-un'], 'with verification off the sticky roles are as before');
  verifyConfig = { ...verifyConfig, enabled: true, verified_role_id: null };
  await sticky.execute(stickyMember());
  assert.deepEqual(restored.at(-1), ['role-ok', 'role-member', 'role-un'], 'a server with no verified role loses nothing');

  console.log('check-verify-rejoin: ok');
  process.exit(0);
})().catch((error) => { console.error(error); process.exit(1); });
