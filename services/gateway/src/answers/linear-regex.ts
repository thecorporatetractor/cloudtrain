/**
 * A linear-time full-match regex engine for answer patterns.
 *
 * Answer patterns come from lab authors (and from templated or computed
 * values), and the schema promises the RE2 subset, which Go runs in linear
 * time. JavaScript's RegExp backtracks: `(a|a){1,60}`, `(a+)+` or a run of
 * `\s*` can block the gateway's event loop for seconds to forever on a short
 * answer. So the gateway does not run answer patterns on RegExp at all. It
 * parses the subset Go RE2 and JavaScript share, compiles it to a Thompson NFA
 * and simulates that over the answer: time is O(pattern states x answer
 * length) whatever the pattern, and the program size is capped.
 *
 * Only a boolean full match is needed (`^(?:pattern)$`), so there are no
 * captures and no match priorities: the result depends on the language of the
 * pattern alone. Semantics follow Go's regexp (the matcher `labctl verify`
 * uses): `.` is any character but \n, `\s` is [\t\n\f\r ], `\d` [0-9], `\w`
 * [0-9A-Za-z_]. Syntax where Go and JavaScript disagree, or that RE2 lacks, is
 * refused rather than guessed: lookarounds, backreferences, inline flags,
 * POSIX classes, possessive quantifiers, a leading `]` in a class, unknown
 * letter escapes.
 */

export class RegexSyntaxError extends Error {}

/** Largest NFA a pattern may compile to (counted repeats are expanded). */
export const MAX_STATES = 5000;
/** Go's limit for a repeat count. */
const MAX_REPEAT = 1000;
const MAX_DEPTH = 100;
/**
 * Most compile steps a pattern may take. Once the parser has folded empty repeats away, every
 * compile of a node pushes at least one state, at most through a chain of nested cat and repeat
 * nodes (one group level each), so this bound is never reached before MAX_STATES. It is the
 * backstop should some node compile to nothing again: work, not only states, is capped.
 */
const MAX_COMPILE_STEPS = MAX_STATES * 2 * (MAX_DEPTH + 2);

type Pred = (cp: number) => boolean;
type Node =
  | { t: 'char'; pred: Pred }
  | { t: 'cat'; items: Node[] }
  | { t: 'alt'; alts: Node[] }
  | { t: 'rep'; node: Node; min: number; max: number /* -1: unbounded */ }
  | { t: 'assert'; kind: 'bol' | 'eol' | 'wb' | 'nwb' }
  | { t: 'empty' };

type State = { k: 'char'; pred: Pred; out: number } | { k: 'split'; outs: number[] } | { k: 'assert'; kind: 'bol' | 'eol' | 'wb' | 'nwb'; out: number } | { k: 'match' };

const isDigit = (c: number) => c >= 48 && c <= 57;
const isWord = (c: number) => isDigit(c) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;
const isSpace = (c: number) => c === 32 || c === 9 || c === 10 || c === 12 || c === 13;

function single(s: string): number | undefined {
  const cps = Array.from(s);
  return cps.length === 1 ? cps[0]!.codePointAt(0) : undefined;
}
const foldCache = new Map<number, number[]>();
/** cp and its simple lower/upper case forms. */
function variants(cp: number): number[] {
  let v = foldCache.get(cp);
  if (!v) {
    const ch = String.fromCodePoint(cp);
    v = [...new Set([cp, single(ch.toLowerCase()) ?? cp, single(ch.toUpperCase()) ?? cp])];
    if (foldCache.size < 4096) foldCache.set(cp, v);
  }
  return v;
}

class Parser {
  private i = 0;
  private readonly cps: number[];
  constructor(
    pattern: string,
    private readonly ci: boolean,
  ) {
    this.cps = Array.from(pattern).map((c) => c.codePointAt(0)!);
  }

  private peek(o = 0): string | undefined {
    const c = this.cps[this.i + o];
    return c === undefined ? undefined : String.fromCodePoint(c);
  }
  private rest(): string {
    return this.cps
      .slice(this.i, this.i + 12)
      .map((c) => String.fromCodePoint(c))
      .join('');
  }

  parse(): Node {
    const n = this.alt(0);
    if (this.i < this.cps.length) throw new RegexSyntaxError(`unmatched ) at ${this.i}`);
    return n;
  }

  private alt(depth: number): Node {
    if (depth > MAX_DEPTH) throw new RegexSyntaxError('groups nested too deeply');
    const alts = [this.concat(depth)];
    while (this.peek() === '|') {
      this.i++;
      alts.push(this.concat(depth));
    }
    return alts.length === 1 ? alts[0]! : { t: 'alt', alts };
  }

  private concat(depth: number): Node {
    const items: Node[] = [];
    for (let c = this.peek(); c !== undefined && c !== '|' && c !== ')'; c = this.peek()) {
      const item = this.repeat(depth);
      if (item.t !== 'empty') items.push(item); // `(?:)` adds nothing to a sequence
    }
    return items.length === 0 ? { t: 'empty' } : items.length === 1 ? items[0]! : { t: 'cat', items };
  }

  /** A quantifier at the cursor: [min, max, length] or undefined. */
  private quantifier(): [number, number, number] | undefined {
    const c = this.peek();
    if (c === '*') return [0, -1, 1];
    if (c === '+') return [1, -1, 1];
    if (c === '?') return [0, 1, 1];
    if (c === '{') {
      const m = /^\{(\d+)(,(\d*))?\}/.exec(this.rest());
      if (!m) return undefined; // a literal {, as in both engines
      const min = Number(m[1]);
      const max = m[2] === undefined ? min : m[3] === '' ? -1 : Number(m[3]);
      if (min > MAX_REPEAT || max > MAX_REPEAT) throw new RegexSyntaxError(`repeat count above ${MAX_REPEAT}`);
      if (max !== -1 && max < min) throw new RegexSyntaxError('repeat range out of order');
      return [min, max, m[0].length];
    }
    return undefined;
  }

  private repeat(depth: number): Node {
    let node = this.atom(depth);
    const q = this.quantifier();
    if (!q) return node;
    if (node.t === 'assert') throw new RegexSyntaxError('nothing to repeat');
    this.i += q[2];
    if (this.peek() === '?') this.i++; // lazy: irrelevant to a full match
    if (this.quantifier()) throw new RegexSyntaxError('nested repetition operator (possessive and doubled quantifiers are not RE2)');
    // A repeat of something that matches only the empty string, or zero copies of anything, is
    // empty: it compiles to no states, so the state cap would never stop `((?:){1000}){1000}...`
    // from looping min x max times per nesting level at compile time.
    if (node.t === 'empty' || q[1] === 0) return { t: 'empty' };
    return { t: 'rep', node, min: q[0], max: q[1] };
  }

  private atom(depth: number): Node {
    const c = this.peek()!;
    switch (c) {
      case '(': {
        const r = this.rest();
        if (/^\(\?<?[=!]/.test(r)) throw new RegexSyntaxError('lookarounds are not RE2');
        let skip = 1;
        if (r.startsWith('(?:')) skip = 3;
        else {
          const named = /^\(\?P?<[A-Za-z_][A-Za-z0-9_]*>/.exec(r);
          if (named) skip = named[0].length;
          else if (r.startsWith('(?')) throw new RegexSyntaxError('inline flags and other (? groups are not supported');
        }
        this.i += skip;
        const inner = this.alt(depth + 1);
        if (this.peek() !== ')') throw new RegexSyntaxError('missing )');
        this.i++;
        return inner;
      }
      case '[':
        return this.cls();
      case '.':
        this.i++;
        return { t: 'char', pred: (cp) => cp !== 10 };
      case '^':
        this.i++;
        return { t: 'assert', kind: 'bol' };
      case '$':
        this.i++;
        return { t: 'assert', kind: 'eol' };
      case '\\':
        return this.escape();
      case '*':
      case '+':
      case '?':
        throw new RegexSyntaxError('nothing to repeat');
      case '{':
        if (this.quantifier()) throw new RegexSyntaxError('nothing to repeat');
        break;
    }
    this.i++;
    return { t: 'char', pred: this.literal(this.cps[this.i - 1]!) };
  }

  private literal(cp: number): Pred {
    if (!this.ci) return (x) => x === cp;
    const vs = variants(cp);
    return (x) => variants(x).some((v) => vs.includes(v));
  }

  /** A shorthand class (\d \w \s and negations) or undefined. */
  private static shorthand(e: string): Pred | undefined {
    switch (e) {
      case 'd':
        return isDigit;
      case 'D':
        return (c) => !isDigit(c);
      case 'w':
        return isWord;
      case 'W':
        return (c) => !isWord(c);
      case 's':
        return isSpace;
      case 'S':
        return (c) => !isSpace(c);
    }
    return undefined;
  }

  /** A single-character escape after the backslash (cursor on the letter): its code point. */
  private escapedChar(inClass: boolean): number {
    const e = this.peek();
    if (e === undefined) throw new RegexSyntaxError('trailing backslash');
    this.i++;
    const simple: Record<string, number> = { t: 9, n: 10, v: 11, f: 12, r: 13 };
    if (e in simple) return simple[e]!;
    // Go RE2 has no \\u, and reads \\x{...} where JavaScript reads \\x as a letter: only \\xHH is shared.
    if (e === 'u') throw new RegexSyntaxError('\\u is not RE2; write the character itself or \\xHH');
    if (e === 'x') {
      const hex = this.rest().slice(0, 2);
      if (!/^[0-9A-Fa-f]{2}$/.test(hex)) throw new RegexSyntaxError('\\x needs 2 hex digits (\\x{...} is not shared with JavaScript)');
      this.i += 2;
      return parseInt(hex, 16);
    }
    if (/[1-9]/.test(e) || e === 'k') throw new RegexSyntaxError('backreferences are not RE2');
    if (/[A-Za-z0-9]/.test(e)) throw new RegexSyntaxError(`unsupported escape \\${e}${inClass ? ' in a class' : ''}`);
    return e.codePointAt(0)!;
  }

  private escape(): Node {
    this.i++; // backslash
    const e = this.peek();
    if (e === 'b' || e === 'B') {
      this.i++;
      return { t: 'assert', kind: e === 'b' ? 'wb' : 'nwb' };
    }
    const sh = e === undefined ? undefined : Parser.shorthand(e);
    if (sh) {
      this.i++;
      return { t: 'char', pred: sh };
    }
    return { t: 'char', pred: this.literal(this.escapedChar(false)) };
  }

  private cls(): Node {
    this.i++; // [
    let negate = false;
    if (this.peek() === '^') {
      negate = true;
      this.i++;
    }
    if (this.peek() === ']') throw new RegexSyntaxError('a class may not start with ] (Go and JavaScript read it differently); write \\]');
    if (this.peek() === '[' && this.peek(1) === ':') throw new RegexSyntaxError('POSIX classes are not supported');
    const ranges: [number, number][] = [];
    const preds: Pred[] = [];
    for (;;) {
      const c = this.peek();
      if (c === undefined) throw new RegexSyntaxError('missing ]');
      if (c === ']') {
        this.i++;
        break;
      }
      if (c === '[' && this.peek(1) === ':') throw new RegexSyntaxError('POSIX classes are not supported');
      let lo: number;
      if (c === '\\') {
        this.i++;
        const e = this.peek();
        const sh = e === undefined ? undefined : Parser.shorthand(e);
        if (sh) {
          this.i++;
          preds.push(sh);
          if (this.peek() === '-' && this.peek(1) !== ']') throw new RegexSyntaxError('a range may not start at a class shorthand');
          continue;
        }
        if (e === 'b') throw new RegexSyntaxError('\\b in a class is not supported');
        lo = this.escapedChar(true);
      } else {
        lo = this.cps[this.i]!;
        this.i++;
      }
      let hi = lo;
      if (this.peek() === '-' && this.peek(1) !== undefined && this.peek(1) !== ']') {
        this.i++;
        if (this.peek() === '\\') {
          this.i++;
          const e = this.peek();
          if (e !== undefined && Parser.shorthand(e)) throw new RegexSyntaxError('a range may not end at a class shorthand');
          hi = this.escapedChar(true);
        } else {
          hi = this.cps[this.i]!;
          this.i++;
        }
        if (hi < lo) throw new RegexSyntaxError('class range out of order');
      }
      ranges.push([lo, hi]);
    }
    const inSet = (x: number) => ranges.some(([a, b]) => x >= a && x <= b) || preds.some((p) => p(x));
    const member = this.ci ? (x: number) => variants(x).some(inSet) : inSet;
    return { t: 'char', pred: negate ? (x) => !member(x) : member };
  }
}

/** A compiled pattern: `test` is a full match (`^(?:pattern)$`). */
export class LinearRegex {
  private readonly states: State[] = [];
  private readonly start: number;
  private steps = 0;

  constructor(pattern: string, opts: { caseInsensitive?: boolean } = {}) {
    const ast = new Parser(pattern, opts.caseInsensitive ?? false).parse();
    const match = this.push({ k: 'match' });
    this.start = this.compile(ast, match);
  }

  private push(s: State): number {
    if (this.states.length >= MAX_STATES) throw new RegexSyntaxError(`pattern too large (over ${MAX_STATES} states once repeats are expanded)`);
    this.states.push(s);
    return this.states.length - 1;
  }

  /** Compiles `n` so that it continues at `next`; returns its entry state. */
  private compile(n: Node, next: number): number {
    if (++this.steps > MAX_COMPILE_STEPS) throw new RegexSyntaxError(`pattern too large (over ${MAX_COMPILE_STEPS} compile steps once repeats are expanded)`);
    switch (n.t) {
      case 'empty':
        return next;
      case 'char':
        return this.push({ k: 'char', pred: n.pred, out: next });
      case 'assert':
        return this.push({ k: 'assert', kind: n.kind, out: next });
      case 'cat':
        return n.items.reduceRight((acc, item) => this.compile(item, acc), next);
      case 'alt': {
        const outs = n.alts.map((a) => this.compile(a, next));
        return this.push({ k: 'split', outs });
      }
      case 'rep': {
        let cur = next;
        if (n.max === -1) {
          const loop = this.push({ k: 'split', outs: [] });
          const body = this.compile(n.node, loop);
          (this.states[loop] as { outs: number[] }).outs = [body, next];
          cur = loop;
        } else {
          // (x(x(x)?)?)? for the optional copies, then the mandatory ones in front.
          for (let k = 0; k < n.max - n.min; k++) {
            const split = this.push({ k: 'split', outs: [] });
            (this.states[split] as { outs: number[] }).outs = [this.compile(n.node, cur), next];
            cur = split;
          }
        }
        for (let k = 0; k < n.min; k++) cur = this.compile(n.node, cur);
        return cur;
      }
    }
  }

  test(input: string): boolean {
    const cps = Array.from(input).map((c) => c.codePointAt(0)!);
    const seen = new Int32Array(this.states.length).fill(-1);
    let gen = 0;
    const closure = (from: number[], pos: number): number[] => {
      gen++;
      const out: number[] = [];
      const stack = [...from];
      while (stack.length) {
        const s = stack.pop()!;
        if (seen[s] === gen) continue;
        seen[s] = gen;
        const st = this.states[s]!;
        if (st.k === 'split') {
          for (let j = st.outs.length - 1; j >= 0; j--) stack.push(st.outs[j]!);
        } else if (st.k === 'assert') {
          const before = pos > 0 && isWord(cps[pos - 1]!);
          const after = pos < cps.length && isWord(cps[pos]!);
          const ok = st.kind === 'bol' ? pos === 0 : st.kind === 'eol' ? pos === cps.length : st.kind === 'wb' ? before !== after : before === after;
          if (ok) stack.push(st.out);
        } else out.push(s);
      }
      return out;
    };
    let list = closure([this.start], 0);
    for (let pos = 0; pos < cps.length && list.length; pos++) {
      const cp = cps[pos]!;
      const next: number[] = [];
      for (const s of list) {
        const st = this.states[s]!;
        if (st.k === 'char' && st.pred(cp)) next.push(st.out);
      }
      list = closure(next, pos + 1);
    }
    return list.some((s) => this.states[s]!.k === 'match');
  }
}
