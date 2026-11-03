// The same interaction, with some string options answering other values: a command that hands the work to another one of its own (`!mute @member 3d spam` is
// the temporary mute) gives it the duration and the reason it worked out, and everything else (the member, the replies, what the reply changes) is the real thing.

/**
 * @template T
 * @param {T} interaction a slash interaction or the pseudo interaction of a prefix command
 * @param {Record<string, string | null>} values the string options that answer something else
 * @returns {T}
 */
function withOptionValues(interaction, values) {
  const bound = (target, key) => {
    const value = Reflect.get(target, key);
    return typeof value === 'function' ? value.bind(target) : value;
  };
  const options = new Proxy(interaction.options, {
    get(target, key) {
      if (key === 'getString') {
        return (name, required = false) => {
          if (Object.hasOwn(values, name)) {
            if (values[name] === null && required) throw new Error(`Missing option ${name}`); // i18n-ignore: internal error
            return values[name];
          }
          return Reflect.get(target, key).call(target, name, required);
        };
      }
      return bound(target, key);
    },
  });
  return new Proxy(interaction, {
    get: (target, key) => (key === 'options' ? options : bound(target, key)),
    set(target, key, value) { target[key] = value; return true; },
  });
}

module.exports = { withOptionValues };
