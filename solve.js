// Fast drop-in for makefun-diff 1.0.0.
//
// run(input) returns exactly the answer makefun-diff 1.0.0's diffPatch returns for
// the case's input { old, new }: make.fun's own patch of the two texts, as one JSON
// string. The rule, as makefun-diff's own header states it:
//
//   Lines. A text is cut after every "\n" (the only separator; a "\r" is part of
//   its line), and a last line with no "\n" is a line too. Two lines are equal only
//   when they are the same code units, newline or its absence included.
//
//   The edit script. The common prefix of lines is kept, then the common suffix of
//   the lines left; between them, Myers's greedy search from the first lines, which
//   keeps on each diagonal the path reaching furthest into the old text and, when a
//   deletion and an insertion reach the same point, the deletion's (jsdiff takes the
//   insertion's), never moves past either text's end, prunes no edge diagonal, and
//   follows every run of lines equal in both as far as it goes; the first path to
//   reach both ends is the script.
//
//   The patch. A line "makefun-diff/1 old=N new=M hunks=H deleted=D inserted=I",
//   then each hunk's line "@ os ol ns nl" and one line per line it covers, "=" and
//   the line if kept, "-" if deleted, "+" if inserted; each run of changes lists
//   its deletions before its insertions and shows up to 3 kept lines before and
//   after it, and two runs at most 6 kept lines apart share a hunk. A line that
//   ends its text with no newline is written with one and followed by a line "%".
//   Identical texts are the first line alone.
//
// Speed: where makefun-diff walks jsdiff's path objects (one heap object per
// diagonal step, linked lists for the script), this module interns each distinct
// line to an integer once, then runs the same greedy search over Int32Arrays,
// keeping the whole V-trace (one Int32Array per edit distance d) and rebuilding
// the script by walking the trace back. Same choices, same tie-break, same
// script — no per-step allocation, integer line compares, and the snakes run
// over the interned ids.

/** The patch's first word. */
export const FORMAT = 'makefun-diff/1';

/** The kept lines a hunk shows before and after each change run. */
export const CONTEXT = 3;

/** The op of a kept, a deleted and an inserted line, as the patch writes them. */
const KEEP = '=';
const DELETE = '-';
const INSERT = '+';

/**
 * Split both texts into lines and intern them to integer ids in one pass.
 *
 * A text is cut after every "\n"; a last part that is empty means the text
 * ended in one (no bare line), a non-empty one is the bare last line. A line's
 * token is id * 2 + (has newline ? 1 : 0), where id is its part's id in a Map
 * shared by both texts: two lines share a token exactly when they are the same
 * code units, newline or its absence included, so a bare "abc" never equals
 * "abc\n". The parts arrays stay around for the patch output, which rebuilds
 * a shown line's text from its part only when the line is actually printed.
 */
function tokenizeAndIntern(oldText, newText) {
  const aParts = oldText.split('\n');
  const bParts = newText.split('\n');
  const aLast = aParts.length - 1;
  const bLast = bParts.length - 1;
  const n = aParts[aLast] === '' ? aLast : aParts.length;
  const m = bParts[bLast] === '' ? bLast : bParts.length;
  const ids = new Map();
  const A = new Int32Array(n);
  const B = new Int32Array(m);
  let next = 0;
  for (let i = 0; i < n; i++) {
    const s = aParts[i];
    let id = ids.get(s);
    if (id === undefined) {
      id = next++;
      ids.set(s, id);
    }
    A[i] = id * 2 + (i < aLast ? 1 : 0);
  }
  for (let i = 0; i < m; i++) {
    const s = bParts[i];
    let id = ids.get(s);
    if (id === undefined) {
      id = next++;
      ids.set(s, id);
    }
    B[i] = id * 2 + (i < bLast ? 1 : 0);
  }
  return { aParts, bParts, A, B, n, m };
}

/** A line's text as the patch writes it: its part, with "\n" unless it is the bare last line. */
function lineText(parts, i) {
  return i < parts.length - 1 ? parts[i] + '\n' : parts[i];
}

/** Rebuild the script from the trace, walking d down from the end diagonal. */
function backtrack(trace, D, K, A, B) {
  const n = A.length;
  const m = B.length;
  // Segments in reverse order: [kind, count]; a step contributes its snake
  // (kept lines) then its one deletion or insertion.
  const segs = [];
  let x = trace[D][(K + D) / 2 + 1];
  let k = K;
  // i is the trace index of the current diagonal: (k + d) / 2 + 1. A deletion
  // steps to diagonal k - 1 at d - 1, index i - 1; an insertion to k + 1 at
  // d - 1, index i.
  let i = (K + D) / 2 + 1;
  for (let d = D; d >= 1; d--) {
    const prev = trace[d - 1];
    const rm = prev[i - 1];
    const ad = prev[i];
    const canRemove = rm !== -1 && rm < n;
    const canAdd = ad !== -1 && ad - (k + 1) < m;
    let prevX;
    let moveX;
    let kind;
    if (canRemove && (!canAdd || rm + 1 >= ad)) {
      prevX = rm;
      moveX = rm + 1;
      kind = DELETE;
    } else {
      prevX = ad;
      moveX = ad;
      kind = INSERT;
    }
    const keep = x - moveX;
    if (keep > 0) segs.push([KEEP, keep]);
    segs.push([kind, 1]);
    x = prevX;
    if (kind === DELETE) {
      k = k - 1;
      i = i - 1;
    } else {
      k = k + 1;
    }
  }
  // The d = 0 snake, from the start to where the first move began.
  if (x > 0) segs.push([KEEP, x]);
  const runs = [];
  for (let i = segs.length - 1; i >= 0; i--) {
    const seg = segs[i];
    const last = runs[runs.length - 1];
    if (last !== undefined && last.kind === seg[0]) last.count += seg[1];
    else runs.push({ kind: seg[0], count: seg[1] });
  }
  return runs;
}

/** A line as the patch writes it: its op, the line, a newline, and "%" on a line of its own when it had none. */
function written(op, line) {
  return line.endsWith('\n') ? op + line : op + line + '\n%\n';
}

/** make.fun's own patch of input.old into input.new, as one JSON string. */
export function run(input) {
  if (input === null || typeof input !== 'object' || typeof input.old !== 'string' || typeof input.new !== 'string') {
    throw new TypeError('makefun-diff: the input is { old, new }, two strings');
  }
  const { aParts, bParts, A, B, n, m } = tokenizeAndIntern(input.old, input.new);
  // The common prefix, then the common suffix of what is left.
  let prefix = 0;
  while (prefix < n && prefix < m && A[prefix] === B[prefix]) prefix++;
  let suffix = 0;
  while (suffix < n - prefix && suffix < m - prefix && A[n - 1 - suffix] === B[m - 1 - suffix]) suffix++;
  const midA = A.subarray(prefix, n - suffix);
  const midB = B.subarray(prefix, m - suffix);
  const runs = [];
  if (prefix > 0) runs.push({ kind: KEEP, count: prefix });
  runs.push(...editRuns(midA, midB));
  if (suffix > 0) runs.push({ kind: KEEP, count: suffix });

  // The change runs: each a stretch of deletions and insertions between two kept lines, at old line o and new line p.
  const changes = [];
  let o = 0;
  let p = 0;
  let deleted = 0;
  let inserted = 0;
  for (const r of runs) {
    if (r.kind === KEEP) {
      o += r.count;
      p += r.count;
      continue;
    }
    let c = changes[changes.length - 1];
    if (c === undefined || c.o + c.dels !== o || c.p + c.ins !== p) {
      c = { o, p, dels: 0, ins: 0 };
      changes.push(c);
    }
    if (r.kind === DELETE) {
      c.dels += r.count;
      o += r.count;
      deleted += r.count;
    } else {
      c.ins += r.count;
      p += r.count;
      inserted += r.count;
    }
  }

  // The hunks: change runs at most 2 * CONTEXT kept lines apart share one.
  const hunks = [];
  for (const c of changes) {
    const h = hunks[hunks.length - 1];
    const prev = h !== undefined ? h[h.length - 1] : undefined;
    if (prev !== undefined && c.o - (prev.o + prev.dels) <= 2 * CONTEXT) h.push(c);
    else hunks.push([c]);
  }
  const out = [FORMAT + ' old=' + n + ' new=' + m + ' hunks=' + hunks.length + ' deleted=' + deleted + ' inserted=' + inserted + '\n'];
  for (const h of hunks) {
    const first = h[0];
    const last = h[h.length - 1];
    const oldStart = Math.max(0, first.o - CONTEXT);
    const newStart = first.p - (first.o - oldStart);
    const after = Math.min(CONTEXT, n - (last.o + last.dels));
    const oldEnd = last.o + last.dels + after;
    const newEnd = last.p + last.ins + after;
    out.push('@ ' + (oldStart + 1) + ' ' + (oldEnd - oldStart) + ' ' + (newStart + 1) + ' ' + (newEnd - newStart) + '\n');
    let at = oldStart;
    for (const c of h) {
      for (; at < c.o; at++) out.push(written(KEEP, lineText(aParts, at)));
      for (let i = 0; i < c.dels; i++) out.push(written(DELETE, lineText(aParts, c.o + i)));
      for (let i = 0; i < c.ins; i++) out.push(written(INSERT, lineText(bParts, c.p + i)));
      at = c.o + c.dels;
    }
    for (; at < oldEnd; at++) out.push(written(KEEP, lineText(aParts, at)));
  }
  return out.join('');
}

/**
 * The runs of the edit script of A into B: [{ kind, count }], in order.
 *
 * trace[d] is an Int32Array of length d + 3. Index i, 1..d+1, holds the
 * furthest x (old lines consumed) the search reaches on diagonal k = -d +
 * 2(i-1) after d edits and its snake, or -1 when that diagonal is dead at d;
 * indices 0 and d+2 are padding that stays -1, so the two predecessors of a
 * diagonal are always plain loads: V[d-1][k-1] is prev[i-1], V[d-1][k+1] is
 * prev[i]. The forward pass is makefun-diff's search in x-terms: at (d, k) a
 * deletion from k - 1 reaches x = V[d-1][k-1] + 1 when V[d-1][k-1] is alive
 * and below the old length (an old line left to delete), an insertion from
 * k + 1 reaches x = V[d-1][k+1] when its y is below the new length (a new
 * line left to insert); the deletion wins when it reaches at least as far
 * into the old text (rm + 1 >= ad), the insertion otherwise; then the snake
 * follows equal lines as far as it goes. The first (d, k), k ascending, to
 * reach both ends is the script, and the backtrack re-derives each step's
 * choice from the same trace values, so it rebuilds the same script the
 * forward pass chose.
 */
function editRuns(A, B) {
  const n = A.length;
  const m = B.length;
  const trace = [];
  let v0 = new Int32Array(3);
  v0.fill(-1);
  let x = 0;
  let y = 0;
  while (x < n && y < m && A[x] === B[y]) {
    x++;
    y++;
  }
  v0[1] = x;
  trace.push(v0);
  if (x >= n && y >= m) return [];
  for (let d = 1; d <= n + m; d++) {
    const v = new Int32Array(d + 3);
    v.fill(-1);
    const prev = trace[d - 1];
    let k = -d;
    for (let i = 1; i <= d + 1; i++, k += 2) {
      // V[d-1][k-1] sits at prev[i-1], V[d-1][k+1] at prev[i]; the padding
      // reads -1 at the edges, so no bounds checks are needed here.
      const rm = prev[i - 1];
      const ad = prev[i];
      const canRemove = rm !== -1 && rm < n;
      const canAdd = ad !== -1 && ad - (k + 1) < m;
      if (!canRemove && !canAdd) continue;
      // make.fun's tie-break: the deletion when both reach the same point.
      if (canRemove && (!canAdd || rm + 1 >= ad)) x = rm + 1;
      else x = ad;
      y = x - k;
      while (x < n && y < m && A[x] === B[y]) {
        x++;
        y++;
      }
      v[i] = x;
      if (x >= n && y >= m) {
        trace.push(v);
        return backtrack(trace, d, k, A, B);
      }
    }
    trace.push(v);
  }
  throw new Error('makefun-diff: the search ended without reaching both ends');
}
