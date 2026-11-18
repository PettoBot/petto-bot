//! Finds any of many words in a text in one pass (Aho-Corasick), so a moderation rule with thousands of words does not make every message slow.
//! The text and the words are already normalized by the bot (lowercase, no accents). The bot loads this as WebAssembly (`src/utils/wordMatchWasm.ts`)
//! and keeps a JavaScript way of doing the same, which is what it uses when this cannot load; `scripts/check-wordmatch.js` checks that both agree.
use std::cell::RefCell;
use std::collections::VecDeque;

struct Automaton {
    /// For each state: its edges, sorted by byte.
    edges: Vec<Vec<(u8, u32)>>,
    fail: Vec<u32>,
    /// For each state: the patterns that end here, as (index, length in bytes).
    out: Vec<Vec<(u32, u32)>>,
}

impl Automaton {
    fn build(patterns: &[&[u8]]) -> Automaton {
        let mut a = Automaton { edges: vec![Vec::new()], fail: vec![0], out: vec![Vec::new()] };
        for (index, pattern) in patterns.iter().enumerate() {
            if pattern.is_empty() { continue; }
            let mut state = 0u32;
            for &byte in pattern.iter() {
                state = match a.step(state, byte) {
                    Some(next) => next,
                    None => {
                        let next = a.edges.len() as u32;
                        a.edges.push(Vec::new());
                        a.fail.push(0);
                        a.out.push(Vec::new());
                        let list = &mut a.edges[state as usize];
                        let at = list.binary_search_by_key(&byte, |e| e.0).unwrap_err();
                        list.insert(at, (byte, next));
                        next
                    }
                };
            }
            a.out[state as usize].push((index as u32, pattern.len() as u32));
        }
        // Fail links, breadth first: the longest proper suffix of a state that is also a state.
        let mut queue = VecDeque::new();
        let root_edges: Vec<(u8, u32)> = a.edges[0].clone();
        for (_, child) in root_edges { a.fail[child as usize] = 0; queue.push_back(child); }
        while let Some(state) = queue.pop_front() {
            let edges: Vec<(u8, u32)> = a.edges[state as usize].clone();
            for (byte, child) in edges {
                let mut f = a.fail[state as usize];
                let target = loop {
                    if let Some(next) = a.step(f, byte) { break next; }
                    if f == 0 { break 0; }
                    f = a.fail[f as usize];
                };
                a.fail[child as usize] = if target == child { 0 } else { target };
                let inherited: Vec<(u32, u32)> = a.out[a.fail[child as usize] as usize].clone();
                a.out[child as usize].extend(inherited);
                queue.push_back(child);
            }
        }
        a
    }

    fn step(&self, state: u32, byte: u8) -> Option<u32> {
        let list = &self.edges[state as usize];
        list.binary_search_by_key(&byte, |e| e.0).ok().map(|i| list[i].1)
    }

    fn next(&self, mut state: u32, byte: u8) -> u32 {
        loop {
            if let Some(next) = self.step(state, byte) { return next; }
            if state == 0 { return 0; }
            state = self.fail[state as usize];
        }
    }

    /// The first match that ends earliest (the longest one when several end together). With `whole`, only a match that is not touching letters or digits.
    fn find(&self, text: &[u8], whole: bool) -> i32 {
        let mut state = 0u32;
        for (end, &byte) in text.iter().enumerate() {
            state = self.next(state, byte);
            let mut best: Option<(u32, u32)> = None;
            for &(index, len) in &self.out[state as usize] {
                let start = end + 1 - len as usize;
                if whole && !(boundary_before(text, start) && boundary_after(text, end + 1)) { continue; }
                if best.map_or(true, |(_, l)| len > l) { best = Some((index, len)); }
            }
            if let Some((index, _)) = best { return index as i32; }
        }
        -1
    }
}

fn is_word_char(c: char) -> bool { c.is_alphanumeric() }

fn boundary_before(text: &[u8], at: usize) -> bool {
    if at == 0 { return true; }
    let mut i = at;
    while i > 0 && (text[i - 1] & 0xC0) == 0x80 { i -= 1; }
    if i == 0 { return true; }
    match std::str::from_utf8(&text[i - 1..at]).ok().and_then(|s| s.chars().next()) { Some(c) => !is_word_char(c), None => true }
}

fn boundary_after(text: &[u8], at: usize) -> bool {
    if at >= text.len() { return true; }
    let end = (at + 4).min(text.len());
    let mut slice = &text[at..end];
    while !slice.is_empty() && std::str::from_utf8(slice).is_err() { slice = &slice[..slice.len() - 1]; }
    match std::str::from_utf8(slice).ok().and_then(|s| s.chars().next()) { Some(c) => !is_word_char(c), None => true }
}

thread_local! { static AUTOMATA: RefCell<Vec<Option<Automaton>>> = RefCell::new(Vec::new()); }

#[no_mangle]
pub extern "C" fn alloc(size: usize) -> *mut u8 {
    let mut buffer = Vec::<u8>::with_capacity(size.max(1));
    let pointer = buffer.as_mut_ptr();
    std::mem::forget(buffer);
    pointer
}

#[no_mangle]
pub unsafe extern "C" fn dealloc(pointer: *mut u8, size: usize) {
    drop(Vec::from_raw_parts(pointer, 0, size.max(1)));
}

/// Builds the automaton of the words in `[pointer, pointer + length)`, one word per line. Returns its handle.
#[no_mangle]
pub unsafe extern "C" fn ac_new(pointer: *const u8, length: usize) -> u32 {
    let bytes = std::slice::from_raw_parts(pointer, length);
    let patterns: Vec<&[u8]> = bytes.split(|&b| b == b'\n').collect();
    let automaton = Automaton::build(&patterns);
    AUTOMATA.with(|all| {
        let mut all = all.borrow_mut();
        all.push(Some(automaton));
        (all.len() - 1) as u32
    })
}

/// The index of the first word found in the text (the line it was on), or -1.
#[no_mangle]
pub unsafe extern "C" fn ac_find(handle: u32, pointer: *const u8, length: usize, whole: u32) -> i32 {
    let text = std::slice::from_raw_parts(pointer, length);
    AUTOMATA.with(|all| match all.borrow().get(handle as usize) { Some(Some(a)) => a.find(text, whole != 0), _ => -1 })
}

#[no_mangle]
pub extern "C" fn ac_free(handle: u32) {
    AUTOMATA.with(|all| { if let Some(slot) = all.borrow_mut().get_mut(handle as usize) { *slot = None; } });
}
