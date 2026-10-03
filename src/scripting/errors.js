/** An error of Petto Code: a mistake in the code ('syntax'), while running ('runtime') or a limit that was hit ('limit'). */
class PettoCodeError extends Error {
  constructor(kind, message, position = {}) {
    super(position.line ? `${message} (line ${position.line}, column ${position.column})` : message);
    this.name = 'PettoCodeError';
    this.kind = kind;
    this.line = position.line ?? null;
    this.column = position.column ?? null;
    this.detail = message;
  }
}

module.exports = { PettoCodeError };
