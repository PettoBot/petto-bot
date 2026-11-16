// i18n-ignore-file: function names stay as they are in every language; the mistakes are phrases.
// The functions of Petto Code that connect commands: one command can use the code of another (callCC), look at the commands of the server (getCC, listCC) and
// run a piece of its own code (execTemplate, for the `{{ define }}` blocks). A command is called by its name or by its number (the number it has in the
// list of the server). Nothing here changes Discord: what the called command asks for goes to the same list of actions as the one of the command that called it.
type Env = {
  data: Record<string, unknown> & { Cmd?: string; ExecData?: unknown };
  cc: { read(kind: 'get' | 'list', ref?: unknown): Promise<unknown>; code(ref: unknown): Promise<{ number: number | null; name: string; code: string } | null> } | null;
  include(code: string, data: Record<string, unknown>, name: string): Promise<unknown>;
  execTemplate(name: string, arg: unknown): Promise<unknown>;
};
type Run = (env: Env, ...args: any[]) => unknown; // eslint-disable-line @typescript-eslint/no-explicit-any
export interface ConnectHelpers {
  def(name: string, min: number, max: number | null, run: Run): void;
  fail(key: string, vars?: Record<string, unknown>): never;
  text(value: unknown): string;
}

export function register(h: ConnectHelpers): void {
  const { def, fail, text } = h;
  const needCommands = (env: Env): NonNullable<Env['cc']> => env.cc ?? fail('noCommands');
  /** The name or the number of a command, as written (`"shop"`, `"!shop"`, `75`, `"75"`). */
  const refOf = (value: unknown): string => {
    const raw = typeof value === 'number' ? String(Math.trunc(value)) : text(value).trim();
    const clean = raw.replace(/^[^A-Za-z0-9_-]+/, '').toLowerCase();
    if (!/^[a-z0-9_-]{1,32}$/.test(clean)) fail('commandName');
    return clean;
  };

  // Runs the code of another command inside this one and gives back what it printed, or what it returned with `return value`. The command gets the arguments
  // as `.Args` (and `.RawArgs`), its own `.Cmd`, and `.CalledBy`; it is the same member, channel and server. Up to 5 calls a run, 3 levels deep, never itself.
  def('callCC', 1, null, async (env, ref, ...args) => {
    const found = await needCommands(env).code(refOf(ref));
    if (!found || !found.code) return fail('callMissing', { name: text(ref).slice(0, 40) });
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
