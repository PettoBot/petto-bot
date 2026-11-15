"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.register = register;
function register(h) {
    const { def, fail, text } = h;
    const needCommands = (env) => env.cc ?? fail('noCommands');
    /** The name or the number of a command, as written (`"shop"`, `"!shop"`, `75`, `"75"`). */
    const refOf = (value) => {
        const raw = typeof value === 'number' ? String(Math.trunc(value)) : text(value).trim();
        const clean = raw.replace(/^[^A-Za-z0-9_-]+/, '').toLowerCase();
        if (!/^[a-z0-9_-]{1,32}$/.test(clean))
            fail('commandName');
        return clean;
    };
    // Runs the code of another command inside this one and gives back what it printed, or what it returned with `return value`. The command gets the arguments
    // as `.Args` (and `.RawArgs`), its own `.Cmd`, and `.CalledBy`; it is the same member, channel and server. Up to 5 calls a run, 3 levels deep, never itself.
    def('callCC', 1, null, async (env, ref, ...args) => {
        const found = await needCommands(env).code(refOf(ref));
        if (!found || !found.code)
            return fail('callMissing', { name: text(ref).slice(0, 40) });
        const data = { ...env.data, Args: args, RawArgs: args.map((arg) => text(arg)).join(' '), Cmd: found.name, CalledBy: env.data.Cmd ?? null };
        return env.include(found.code, data, found.name);
    });
    // A command of the server as a map (Number, Name, HasCode, Trigger, TriggerText), or nil. It counts as one of the 10 reads.
    def('getCC', 1, 1, async (env, ref) => needCommands(env).read('get', refOf(ref)));
    // The commands of the server as a list of maps, by number (up to 100). It counts as one of the 10 reads.
    def('listCC', 0, 0, async (env) => needCommands(env).read('list'));
    // Runs a `{{ define "name" }}` of this code, with a value as `.`, and gives back what it printed or what it returned.
    def('execTemplate', 1, 2, async (env, name, arg) => env.execTemplate(text(name), arg === undefined ? null : arg));
}
