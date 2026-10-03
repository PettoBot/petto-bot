const { PettoCodeError } = require('./errors');
const { parse } = require('./parser');
const { functions } = require('./functions');
const { isTruthy, toText, readField, typeOf } = require('./values');

const DEFAULT_LIMITS = {
  maxSteps: 10_000, // nodes, operands and function calls
  maxMillis: 3_000, // all the time, counting the time spent waiting for the data
  maxCpuMillis: 250, // the time spent running the code itself, without the waiting
  maxStoreCalls: 25, // reads and writes of the stored data
  maxLoopRuns: 1_000, // the turns of every range together
  maxOutput: 20_000, // characters printed while running; the bot cuts a message to Discord's limit later
  maxValueSize: 20_000, // the longest text a function may make
  maxListSize: 2_000,
  effects: { message: 5, dm: 2, addRole: 5, removeRole: 5, reaction: 5, deleteTrigger: 1, respond: 1, update: 1 },
};

class Scope {
  constructor(parent = null, root = parent?.root) { this.parent = parent; this.root = root; this.values = new Map(); }
  find(name) { for (let scope = this; scope; scope = scope.parent) if (scope.values.has(name)) return scope; return null; }
}

/**
 * Runs the code (a tree, or the text) with the data it can see, and gives back the text it printed and the effects it asked
 * for. It never touches Discord: that is for the bot to do with the effects. It can read and write the data stored for the
 * server through `options.store`. Mistakes and limits throw a PettoCodeError.
 */
async function run(codeOrTree, data = {}, options = {}) {
  const tree = typeof codeOrTree === 'string' ? parse(codeOrTree) : codeOrTree;
  const limits = { ...DEFAULT_LIMITS, ...options.limits, effects: { ...DEFAULT_LIMITS.effects, ...options.limits?.effects } };
  const now = options.now ?? (() => Date.now());
  const startedAt = now();
  let steps = 0;
  let waitedMillis = 0; // time spent waiting for something outside the code, that does not count as running it
  let storeCalls = 0;
  let loopRuns = 0;
  let output = '';
  const effectList = [];
  const effectCount = {};

  const env = {
    data,
    rng: options.random ?? Math.random,
    now,
    store: options.store ? {
      async call(operation, ...args) {
        storeCalls += 1;
        if (storeCalls > limits.maxStoreCalls) throw Object.assign(new Error(`Too many reads and writes of stored data: at most ${limits.maxStoreCalls} per run`), { limit: true });
        const before = now();
        try { return await options.store[operation](...args); } finally { waitedMillis += now() - before; }
      },
    } : null,
    effects: {
      add(kind, payload) {
        effectCount[kind] = (effectCount[kind] ?? 0) + 1;
        if (effectCount[kind] > (limits.effects[kind] ?? 0)) throw Object.assign(new Error(`Too many actions of this kind: at most ${limits.effects[kind] ?? 0} per run`), { limit: true });
        effectList.push({ type: kind, ...payload });
      },
    },
  };

  const fail = (kind, message, node) => { throw new PettoCodeError(kind, message, node ?? {}); };
  const tick = (node) => {
    steps += 1;
    if (steps > limits.maxSteps) fail('limit', `The code did too many steps (more than ${limits.maxSteps}). Is there a loop that is too long?`, node);
    if (steps % 32 === 0) {
      const elapsed = now() - startedAt;
      if (elapsed > limits.maxMillis) fail('limit', `The code took longer than ${limits.maxMillis} ms`, node);
      if (elapsed - waitedMillis > limits.maxCpuMillis) fail('limit', `The code took longer than ${limits.maxCpuMillis} ms to run`, node);
    }
  };
  const emit = (text, node) => {
    output += text;
    if (output.length > limits.maxOutput) fail('limit', `The code printed more than ${limits.maxOutput} characters`, node);
  };
  const guardValue = (value, node) => {
    if (typeof value === 'string' && value.length > limits.maxValueSize) fail('limit', 'A text got too long', node);
    if (Array.isArray(value) && value.length > limits.maxListSize) fail('limit', 'A list got too long', node);
    return value === undefined ? null : value;
  };

  function lookup(scope, name, node) {
    const holder = scope.find(name);
    if (!holder) fail('runtime', `The variable ${name} is not defined. Create it first with ${name} := ...`, node);
    return holder.values.get(name);
  }

  const readFields = (value, fields, node) => {
    let current = value;
    for (const field of fields) {
      try { current = readField(current, field); } catch (error) { fail('runtime', error.message, node); }
    }
    return current;
  };

  async function evalOperand(operand, scope, dot) {
    tick(operand);
    switch (operand.kind) {
      case 'literal': return operand.value;
      case 'variable': return readFields(operand.name === '$' ? scope.root : lookup(scope, operand.name, operand), operand.fields, operand);
      case 'dot': return readFields(dot, operand.fields, operand);
      case 'paren': return readFields(await evalPipeline(operand.pipeline, scope, dot), operand.fields, operand);
      case 'ident': return fail('runtime', `"${operand.name}" is a function and needs to be called, for example ${operand.name} ...`, operand);
      default: return fail('runtime', 'Unknown operand', operand);
    }
  }

  async function callFunction(operand, args, node) {
    const entry = functions.get(operand.name);
    if (!entry) fail('runtime', `There is no function called "${operand.name}"`, operand);
    if (args.length < entry.min || (entry.max !== null && args.length > entry.max)) {
      const expected = entry.max === entry.min ? `${entry.min}` : entry.max === null ? `at least ${entry.min}` : `${entry.min} to ${entry.max}`;
      fail('runtime', `${operand.name} takes ${expected} argument${entry.min === 1 && entry.max === 1 ? '' : 's'}, got ${args.length}`, operand);
    }
    tick(operand);
    try {
      return guardValue(await entry.run(env, ...args), operand);
    } catch (error) {
      if (error instanceof PettoCodeError) throw error;
      return fail(error.limit ? 'limit' : 'runtime', `${operand.name}: ${error.message}`, operand);
    }
  }

  async function evalPipeline(pipeline, scope, dot) {
    let result;
    for (let index = 0; index < pipeline.length; index += 1) {
      const operands = pipeline[index];
      if (operands[0].kind === 'ident') {
        const args = [];
        for (const operand of operands.slice(1)) args.push(await evalOperand(operand, scope, dot));
        if (index > 0) args.push(result);
        result = await callFunction(operands[0], args, operands[0]);
      } else {
        if (index > 0) fail('runtime', 'Only a function can receive a value with |', operands[0]);
        result = await evalOperand(operands[0], scope, dot);
      }
    }
    return result;
  }

  // Control flow comes back as a signal from the block: 'break', 'continue' or 'return'.
  async function execList(nodes, scope, dot, inLoop) {
    for (const node of nodes) {
      const signal = await execNode(node, scope, dot, inLoop);
      if (signal) return signal;
    }
    return null;
  }

  async function execNode(node, scope, dot, inLoop) {
    tick(node);
    switch (node.type) {
      case 'Text': emit(node.value, node); return null;
      case 'Print': emit(toText(await evalPipeline(node.pipeline, scope, dot)), node); return null;
      case 'Assign': {
        const value = await evalPipeline(node.pipeline, scope, dot);
        if (node.declare) scope.values.set(node.name, value);
        else {
          const holder = scope.find(node.name);
          if (!holder) fail('runtime', `The variable ${node.name} is not defined. Create it first with ${node.name} := ...`, node);
          holder.values.set(node.name, value);
        }
        return null;
      }
      case 'If': {
        for (const branch of node.branches) {
          if (isTruthy(await evalPipeline(branch.condition, scope, dot))) return await execList(branch.body, new Scope(scope), dot, inLoop);
        }
        return node.otherwise ? execList(node.otherwise, new Scope(scope), dot, inLoop) : null;
      }
      case 'With': {
        const value = await evalPipeline(node.pipeline, scope, dot);
        if (isTruthy(value)) return await execList(node.body, new Scope(scope), value, inLoop);
        return node.otherwise ? execList(node.otherwise, new Scope(scope), dot, inLoop) : null;
      }
      case 'Range': return await execRange(node, scope, dot);
      case 'Break': if (!inLoop) fail('runtime', '"break" only works inside a range', node); return 'break';
      case 'Continue': if (!inLoop) fail('runtime', '"continue" only works inside a range', node); return 'continue';
      case 'Return': return 'return';
      default: return fail('runtime', `Unknown node ${node.type}`, node);
    }
  }

  async function execRange(node, scope, dot) {
    const source = await evalPipeline(node.pipeline, scope, dot);
    let entries;
    if (Array.isArray(source)) entries = source.map((value, index) => [index, value]);
    else if (source && typeof source === 'object') entries = Object.keys(source).sort().map((key) => [key, source[key]]);
    else if (source === null || source === undefined) entries = [];
    else return fail('runtime', `range needs a list or a map, got ${typeOf(source)}`, node);
    if (!entries.length) return node.otherwise ? execList(node.otherwise, new Scope(scope), dot, false) : null;
    for (const [key, value] of entries) {
      loopRuns += 1;
      if (loopRuns > limits.maxLoopRuns) fail('limit', `The loops ran more than ${limits.maxLoopRuns} turns`, node);
      const inner = new Scope(scope);
      if (node.keyName) inner.values.set(node.keyName, key);
      if (node.valueName) inner.values.set(node.valueName, value);
      const signal = await execList(node.body, inner, value, true);
      if (signal === 'break') break;
      if (signal === 'return') return 'return';
    }
    return null;
  }

  const root = new Scope(null, data); // `$` is the data, whatever block the code is in
  await execList(tree.nodes, root, data, false);
  return { output, effects: effectList, steps, millis: now() - startedAt };
}

module.exports = { run, DEFAULT_LIMITS };
