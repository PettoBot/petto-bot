"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.wasmAvailable = void 0;
exports.buildWasmMatcher = buildWasmMatcher;
// i18n-ignore-file: loads a binary, nothing here is shown to anyone.
// The Rust word finder (native/wordmatch, built to src/native/wordmatch.wasm) for the moderation rules that have thousands of words: it finds any of them in a text in
// one pass. Returns null when the file cannot be loaded, and the rules then use the JavaScript way (utils/modRules.ts `wordMatcher`), which finds the same.
// Written in TypeScript: `npm run build:ts` compiles it over src/utils/wordMatchWasm.js, which is what the bot loads.
const fs = require('node:fs');
const path = require('node:path');
let exportsOf;
function load() {
    if (exportsOf !== undefined)
        return exportsOf;
    try {
        const bytes = fs.readFileSync(path.join(__dirname, '..', 'native', 'wordmatch.wasm'));
        exportsOf = new WebAssembly.Instance(new WebAssembly.Module(bytes), {}).exports;
    }
    catch {
        exportsOf = null;
    }
    return exportsOf;
}
const wasmAvailable = () => load() !== null;
exports.wasmAvailable = wasmAvailable;
const encoder = new TextEncoder();
function withBytes(wasm, bytes, use) {
    const pointer = wasm.alloc(bytes.length);
    try {
        new Uint8Array(wasm.memory.buffer, pointer, bytes.length).set(bytes); // read the memory after alloc: it may have grown
        return use(pointer);
    }
    finally {
        wasm.dealloc(pointer, bytes.length);
    }
}
/** A function that says which of `words` (already normalized, none empty, none with a line break) a normalized text has: as a part of it, or only as whole words. */
function buildWasmMatcher(words, whole) {
    const wasm = load();
    if (!wasm)
        return null;
    const joined = encoder.encode(words.join('\n'));
    const handle = withBytes(wasm, joined, (pointer) => wasm.ac_new(pointer, joined.length));
    return (content) => {
        const bytes = encoder.encode(content);
        if (!bytes.length)
            return null;
        const index = withBytes(wasm, bytes, (pointer) => wasm.ac_find(handle, pointer, bytes.length, whole ? 1 : 0));
        return index >= 0 ? words[index] ?? null : null;
    };
}
