// A ticket that cannot be opened used to say "check my permissions (Manage Channels)" whatever the cause.
const assert = require('node:assert/strict');
const { describeTicketOpenError } = require('../src/utils/ticketErrors');

const discordError = (code, message) => Object.assign(new Error(message), { code });

assert.equal(describeTicketOpenError(Object.assign(new Error('You already have 1 open ticket.'), { userFacing: true })), 'You already have 1 open ticket.', 'messages meant for the person pass through');
assert.match(describeTicketOpenError(discordError(50035, 'Invalid Form Body\nparent_id[CHANNEL_PARENT_MAX_CHANNELS]: Maximum number of channels in category reached (50)')), /category is full/);
assert.match(describeTicketOpenError(discordError(30013, 'Maximum number of server channels reached (500)')), /limit of channels/);
assert.match(describeTicketOpenError(discordError(10003, 'Unknown Channel')), /no longer exists/);
assert.match(describeTicketOpenError(discordError(50035, 'Invalid Form Body\nparent_id[CHANNEL_PARENT_INVALID]: Invalid parent channel')), /no longer exists/);
assert.match(describeTicketOpenError(discordError(50013, 'Missing Permissions')), /missing a permission/);
assert.match(describeTicketOpenError(discordError(50001, 'Missing Access')), /cannot access/);
assert.match(describeTicketOpenError(discordError(50035, 'Invalid Form Body\nname: Invalid name')), /Discord said "Invalid Form Body/);
const internal = describeTicketOpenError(Object.assign(new Error('invalid input syntax for type json'), { code: '22P02' }));
assert.match(internal, /error on my side/);
assert.equal(/json|22P02|syntax/i.test(internal), false, 'database details never reach the person');
assert.doesNotMatch(describeTicketOpenError(new Error('boom')), /Manage Channels/, 'a generic failure no longer blames permissions');
console.log('ticket errors ok');
