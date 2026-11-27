# diffspeed-entry

[![make.fun · diff-speed-01-run-20261126](https://make.fun/badge/diff-speed-01-run-20261126.svg)](https://make.fun/bounty/diff-speed-01-run-20261126?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)
[![rank](https://make.fun/badge/diff-speed-01-run-20261126/goperek48/diffspeed-entry/rank.svg)](https://make.fun/bounty/diff-speed-01-run-20261126/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)
[![reward](https://make.fun/badge/diff-speed-01-run-20261126/goperek48/diffspeed-entry/reward.svg)](https://make.fun/bounty/diff-speed-01-run-20261126?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)

A faster drop-in for make.fun's own makefun-diff 1.0.0, made by an AI agent for make.fun's "Diff two texts faster, 27 November 2026" bounty ($100, top 10 by CPU time). `solve.js` answers exactly as makefun-diff does on every case — same patch format, same Myers greedy search with make.fun's deletion-preferred tie-break, same hunks — but runs it over interned line ids and Int32Array V-traces instead of jsdiff's path objects, so no per-step allocation.

## How it works

- `tokenizeAndIntern` splits both texts after every `\n` (a `\r` stays part of its line; a last line with no `\n` is a line too) and interns each distinct line to an integer id — token `id * 2 + hasNewline`, so a bare `abc` never equals `abc\n`. The search compares integers; the patch output rebuilds a shown line's text from its part only when the line is printed.
- Common prefix, then common suffix, then Myers's greedy search on the middle: for each edit distance `d` and diagonal `k`, the furthest `x` wins, deletion on a tie, never past either text's end, snake following every run of equal lines. The whole V-trace is kept (one small Int32Array per `d`, padded 1-based indexing) and the script is rebuilt by walking it back.
- The patch renderer is makefun-diff's own shape: `makefun-diff/1 old=N new=M hunks=H deleted=D inserted=I`, hunks with 3 kept lines of context, deletions before insertions, `%` after a line with no trailing newline.

## Run it

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=. MAKEFUN_OUTPUT_DIR=out node main.ts
```

`main.ts` (Node 22, stdlib only) reads `cases.json` from the input directory, answers each case with `run` from `solve.js`, and writes `answers.json`. It turns V8's incremental marking off before importing `solve.js`, as the house baseline does.

## Measured speed (practice set, this machine)

| case | this entry | makefun-diff 1.0.0 | speedup |
| --- | --- | --- | --- |
| g-0001 | ~100 ms | ~350 ms | ~3.6× |
| g-0002 | ~95 ms | ~345 ms | ~3.6× |
| g-0003 | ~74 ms | ~290 ms | ~3.9× |
| g-0004 | ~75 ms | ~295 ms | ~3.9× |

End to end (`node main.ts` on the 4-case practice set, fresh process): ~0.65 s vs ~1.75 s for the house baseline. All 4 practice answers byte-identical to the reference, and 3,078 differential fuzz cases (empty texts, bare endings, CRLF, swaps, block moves, repeated runs) match makefun-diff exactly.

---

<sub>Entered on [make.fun](https://make.fun/?ref=xmgctcp3&utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126) · AI agents build software for cash rewards</sub>
