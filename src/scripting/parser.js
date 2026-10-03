const { PettoCodeError } = require('./errors');
const { splitActions, tokenize, locate } = require('./lexer');

const MAX_SOURCE_LENGTH = 10_000;
const MAX_NESTING = 20;

/**
 * Turns the source into a tree.
 *   Text, Print(pipeline), Assign(names, declare, pipeline), If(branches, otherwise), Range, With, Break, Continue, Return.
 * A pipeline is a list of commands joined by `|`; a command is a list of operands, the first one a function name or a value.
 */
function parse(source) {
  if (typeof source !== 'string') throw new PettoCodeError('syntax', 'The code must be text');
  if (source.length > MAX_SOURCE_LENGTH) throw new PettoCodeError('limit', `The code is too long (${source.length} of ${MAX_SOURCE_LENGTH} characters)`);
  const parts = splitActions(source);
  let cursor = 0;

  const fail = (message, token) => { throw new PettoCodeError('syntax', message, token ?? {}); };

  function parseOperand(tokens, state, depth) {
    const token = tokens[state.i];
    if (!token) fail('The action ends too soon');
    let operand;
    switch (token.type) {
      case 'string': case 'number': case 'bool': case 'nil':
        state.i += 1; return { kind: 'literal', value: token.value, line: token.line, column: token.column };
      case 'ident': state.i += 1; return { kind: 'ident', name: token.value, line: token.line, column: token.column };
      case 'variable': operand = { kind: 'variable', name: token.value, fields: [], line: token.line, column: token.column }; state.i += 1; break;
      case 'dot': operand = { kind: 'dot', fields: [], line: token.line, column: token.column }; state.i += 1; break;
      case 'field': operand = { kind: 'dot', fields: [token.value], line: token.line, column: token.column }; state.i += 1; break;
      case 'lparen': {
        if (depth >= MAX_NESTING) fail('Too many parentheses inside each other', token);
        state.i += 1;
        const pipeline = parsePipeline(tokens, state, depth + 1);
        if (tokens[state.i]?.type !== 'rparen') fail('A ( is never closed', token);
        state.i += 1;
        operand = { kind: 'paren', pipeline, fields: [], line: token.line, column: token.column };
        break;
      }
      default: return fail(`Unexpected ${token.type === 'keyword' ? `"${token.value}"` : JSON.stringify(token.value)}`, token);
    }
    // A chain of fields after a variable, a dot or a ( ): $user.ID, (dict "a" 1).a
    while (tokens[state.i]?.type === 'field' && tokens[state.i].adjacent) { operand.fields.push(tokens[state.i].value); state.i += 1; }
    return operand;
  }

  function parsePipeline(tokens, state, depth) {
    const commands = [];
    for (;;) {
      const operands = [];
      while (state.i < tokens.length && !['pipe', 'rparen', 'comma', 'declare', 'assign'].includes(tokens[state.i].type)) {
        operands.push(parseOperand(tokens, state, depth));
      }
      if (!operands.length) fail('A command is empty', tokens[state.i] ?? tokens[state.i - 1]);
      if (operands[0].kind !== 'ident' && operands.length > 1) fail('Only a function can take arguments', operands[1]);
      commands.push(operands);
      if (tokens[state.i]?.type === 'pipe') { state.i += 1; continue; }
      break;
    }
    return commands;
  }

  /** The nodes up to one of the `stops` keywords (else, end), which is returned with the nodes. */
  function parseList(stops, depth) {
    if (depth > MAX_NESTING) throw new PettoCodeError('syntax', 'Too many blocks inside each other', locate(source, parts[cursor - 1]?.offset ?? 0));
    const nodes = [];
    while (cursor < parts.length) {
      const part = parts[cursor];
      cursor += 1;
      if (part.type === 'text') { nodes.push({ type: 'Text', value: part.value }); continue; }
      const tokens = tokenize(part.body, source, part.bodyOffset);
      const where = locate(source, part.offset);
      if (!tokens.length) throw new PettoCodeError('syntax', 'An action is empty', where);
      const first = tokens[0];
      const state = { i: 0 };
      const done = () => { if (state.i < tokens.length) fail(`Unexpected ${JSON.stringify(tokens[state.i].value)}`, tokens[state.i]); };
      if (first.type === 'keyword') {
        state.i = 1;
        if (first.value === 'end') { done(); if (!stops.includes('end')) fail('"end" without a block to close', first); return { nodes, stop: 'end' }; }
        if (first.value === 'else') {
          if (!stops.includes('else')) fail('"else" outside an if, range or with', first);
          if (tokens[1]?.type === 'keyword' && tokens[1].value === 'if') return { nodes, stop: 'else if', tokens, where };
          done();
          return { nodes, stop: 'else' };
        }
        if (first.value === 'break' || first.value === 'continue') { done(); nodes.push({ type: first.value === 'break' ? 'Break' : 'Continue', ...where }); continue; }
        if (first.value === 'return') { done(); nodes.push({ type: 'Return', ...where }); continue; }
        if (first.value === 'if') nodes.push(parseIf(tokens, state, where, depth));
        else if (first.value === 'with') nodes.push(parseWith(tokens, state, where, depth));
        else nodes.push(parseRange(tokens, state, where, depth));
        continue;
      }
      // $a := pipeline, $a, $b := pipeline, $a = pipeline
      const names = [];
      let probe = 0;
      while (tokens[probe]?.type === 'variable') {
        names.push(tokens[probe].value);
        probe += 1;
        if (tokens[probe]?.type === 'comma') probe += 1; else break;
      }
      if (names.length && (tokens[probe]?.type === 'declare' || tokens[probe]?.type === 'assign')) {
        if (names.length > 1) fail('Only one variable can be set at a time', tokens[0]);
        const declare = tokens[probe].type === 'declare';
        state.i = probe + 1;
        const pipeline = parsePipeline(tokens, state, 0);
        done();
        nodes.push({ type: 'Assign', name: names[0], declare, pipeline, ...where });
        continue;
      }
      const pipeline = parsePipeline(tokens, state, 0);
      done();
      nodes.push({ type: 'Print', pipeline, ...where });
    }
    return { nodes, stop: null };
  }

  function parseIf(tokens, state, where, depth) {
    const branches = [];
    let otherwise = null;
    let current = { tokens, state, where };
    for (;;) {
      const pipeline = parsePipeline(current.tokens, current.state, 0);
      if (current.state.i < current.tokens.length) fail(`Unexpected ${JSON.stringify(current.tokens[current.state.i].value)}`, current.tokens[current.state.i]);
      const body = parseList(['else', 'end'], depth + 1);
      branches.push({ condition: pipeline, body: body.nodes });
      if (body.stop === 'end') break;
      if (body.stop === 'else') {
        const rest = parseList(['end'], depth + 1);
        if (rest.stop !== 'end') fail('An "if" is never closed with "end"', where);
        otherwise = rest.nodes;
        break;
      }
      if (body.stop === 'else if') { current = { tokens: body.tokens, state: { i: 2 }, where: body.where }; continue; }
      fail('An "if" is never closed with "end"', where);
    }
    return { type: 'If', branches, otherwise, ...where };
  }

  function parseWith(tokens, state, where, depth) {
    const pipeline = parsePipeline(tokens, state, 0);
    if (state.i < tokens.length) fail(`Unexpected ${JSON.stringify(tokens[state.i].value)}`, tokens[state.i]);
    const body = parseList(['else', 'end'], depth + 1);
    let otherwise = null;
    if (body.stop === 'else') {
      const rest = parseList(['end'], depth + 1);
      if (rest.stop !== 'end') fail('A "with" is never closed with "end"', where);
      otherwise = rest.nodes;
    } else if (body.stop !== 'end') fail('A "with" is never closed with "end"', where);
    return { type: 'With', pipeline, body: body.nodes, otherwise, ...where };
  }

  function parseRange(tokens, state, where, depth) {
    // range $i, $v := list   |   range $v := list   |   range list
    const names = [];
    let probe = state.i;
    while (tokens[probe]?.type === 'variable') {
      names.push(tokens[probe].value);
      probe += 1;
      if (tokens[probe]?.type === 'comma') probe += 1; else break;
    }
    let declare = false;
    if (names.length && (tokens[probe]?.type === 'declare' || tokens[probe]?.type === 'assign')) { declare = tokens[probe].type === 'declare'; state.i = probe + 1; } else names.length = 0;
    if (names.length > 2) fail('A range sets at most two variables', tokens[0]);
    const pipeline = parsePipeline(tokens, state, 0);
    if (state.i < tokens.length) fail(`Unexpected ${JSON.stringify(tokens[state.i].value)}`, tokens[state.i]);
    const body = parseList(['else', 'end'], depth + 1);
    let otherwise = null;
    if (body.stop === 'else') {
      const rest = parseList(['end'], depth + 1);
      if (rest.stop !== 'end') fail('A "range" is never closed with "end"', where);
      otherwise = rest.nodes;
    } else if (body.stop !== 'end') fail('A "range" is never closed with "end"', where);
    const [keyName, valueName] = names.length === 2 ? names : [null, names[0] ?? null];
    return { type: 'Range', keyName, valueName, declare, pipeline, body: body.nodes, otherwise, ...where };
  }

  const result = parseList([], 0);
  return { type: 'Root', nodes: result.nodes };
}

module.exports = { parse, MAX_SOURCE_LENGTH };
