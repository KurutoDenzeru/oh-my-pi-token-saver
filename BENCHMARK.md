# Tersio Token Benchmark

Measured before/after token costs for `caveman`, `rtk`, `ponytail`, and `combo` presets, plus runtime/memory deltas from the current refactor.

## Method

- **Tokenizer.** All counts use `o200k_base` (js-tiktoken) — real BPE tokens, not chars÷4 estimates. Measured 2026-09-05, Node v26.8.1.
- **Overhead (measured).** Exact prompt text each mode injects, extracted from the extension sources in this repo (`INSTRUCTIONS`, `RTK_PROMPT`, bundled `rule.md`, combo fallback, reinforcement line).
- **Reply and code savings (measured samples).** 3 reply questions × 4 registers and 2 code tasks, each written twice: plain and ruleset-compressed. Samples are authored to each ruleset and disclosed as such — your model's compliance varies (see Caveats).
- **RTK (measured).** Real command runs in this repo, raw output vs `rtk` output, same command.
- **Runtime/memory (measured).** Same machine, both builds freshly compiled; wall time = median of 5 runs, RSS = median of 3 via `/usr/bin/time -l`.

## 1. Session overhead (measured, once per session)

| Injected text | Chars | Tokens (real) | chars÷4 estimate was |
|---|---:|---:|---:|
| caveman lite | 200 | 46 | 50 |
| caveman full (instruction + `rule.md`) | 653 | 172 | 163 |
| caveman ultra | 314 | 68 | 79 |
| caveman wenyan | 263 | 58 | 66 |
| rtk on (`RTK_PROMPT`) | 627 | 165 | 157 |
| ponytail (bundled fallback, floor) | 355 | 76 | 75 |
| mode reinforcement line | 284 | 67 | 71 |

Ponytail's real cost is the upstream plugin instructions (external, varies by version); 76 is the bundled-fallback floor.

**Combo preset totals (measured sums):** medium = 46+165+76+67 ≈ **354 tok** · balanced = 172+165+76+67 ≈ **480 tok** · max = 68+165+76+67 ≈ **376 tok**.

## 2. Before/after: Caveman replies

Same question answered plain vs ruleset-compressed. 3 samples, tokens per reply.

| Register | s1 (explain shell line) | s2 (flaky CI tests) | s3 (explain TypeError) | Mean | Overhead | Pays off after |
|---|---:|---:|---:|---:|---:|---|
| plain | 121 | 162 | 154 | 146 | — | — |
| `/caveman lite` | 44 | 85 | 73 | 67 | 46 | 1 reply |
| `/caveman full` | 37 | 88 | 58 | 61 | 172 | 3 replies |
| `/caveman ultra` | 27 | 42 | 33 | 34 | 68 | 1 reply |

Mean saving vs plain: **lite −53.8% (0.46×) · full −58.1% (0.42×) · ultra −76.7% (0.23×)**. Median (p50) vs plain 154: lite 73 (−52.6%) · full 58 (−62.3%) · ultra 33 (−78.6%).

Pays-off math, `⌈overhead ÷ mean saving⌉`: lite `⌈46 ÷ 78.3⌉ = 1 reply` · full `⌈172 ÷ 84.7⌉ = 3 replies` · ultra `⌈68 ÷ 111.7⌉ = 1 reply`.

## 3. Before/after: Ponytail code tasks

Same task implemented bloated vs minimal-ladder. Tokens per diff.

| Task | Bloated | Ponytail | Saving | Overhead | Pays off after |
|---|---:|---:|---:|---:|---|
| add retry logic to fetch helper | 481 | 143 | −70.3% | 76 | first task |
| add configurable request timeout | 261 | 108 | −58.6% | (same) | first task |

Ratio: mean bloated 371 tok vs mean minimal 125.5 tok = **0.34×**. Overhead 76 tok vs mean saving 245.5 tok per task → repaid inside the first task (`76 ÷ 245.5 = 0.31`).

## 4. Before/after: RTK shell output

Real runs in this repo; tokens per command output.

| Command | Raw | Via RTK | Saving |
|---|---:|---:|---:|
| `git status` | 32 | 21 | −34% |
| `grep -rn dryRun tersio.ts` | 537 | 469 | −13% |
| `find test -name '*.test.ts'` | 120 | 82 | −32% |
| `ls extensions` | 22 | 22 | 0% |
| `git diff HEAD~1` | 458 | 456 | −0.4% |
| `npm test` (65 pass) | 1,274 | 1,255 | −1.5% |

Reading: RTK pays on listings and grep hits; keeps diffs and test output exact by design (you patch from diffs, you diagnose from failures). One exception: in hook-wrapped sessions (`rtk init -g`), test-suite output is summarized and `rtk gain` recorded **−97.5% on `npm test`** across 4 runs — the direct-CLI passthrough above is the conservative number.

## 5. Combined session economics

Example mixed turn (one reply + one grep + one code task), balanced preset:

| | Before | After |
|---|---:|---:|
| reply + grep + code diff | 944 tok | 638 tok |
| per-turn saving | | **−32%** |
| one-time session overhead | | 480 tok |

First mixed turn nets ≈ −2%, every turn after nets ≈ −32%.

Break-even math: `⌈480 ÷ 306⌉ = 2 turns` to repay overhead; steady-state ratio `638 ÷ 944 = 0.68×` per mixed turn.

## 6. Runtime + memory delta (main vs current branch)

Same machine (darwin 25.6.0, arm64), Node v26.8.1, both builds fresh via `tsc`.

| Case | main | branch | Δ |
|---|---:|---:|---:|
| `install --dry-run --scope both --yes` (median wall) | 0.910 s | 0.687 s | **−24.5%** |
| `--doctor` (median wall) | 0.460 s | 0.405 s | **−12.0%** |
| install dry-run peak RSS (median) | 142.7 MiB | 142.0 MiB | −0.5% (within noise) |
| `--doctor` peak RSS (median) | 141.9 MiB | 141.6 MiB | −0.2% (within noise) |
| Source TS LOC | 2,818 | 2,717 | −101 (−3.6%) |

Wall-time wins come from the refactor's concurrency changes — concurrent companion reads in `copySources` (Audit66), doctor probes batched with FS probes (Audit65), single shared caveman rule fetch (Audit69). Memory is flat: Node's ~142 MiB baseline dominates.

## 7. Verify on your workload

1. Run the same task list twice (modes off, then target preset) in fresh OMP sessions.
2. Record per-session input/output tokens from the provider usage panel.
3. Net saving = (off − on) − preset overhead from §1.

## 8. Caveats

- Reply/code samples are authored to each ruleset, not live model sessions — treat percentages as what the ruleset asks for, not a compliance guarantee. Ultra/wenyan can harm clarity; re-prompt on confusion.
- RTK keeps diffs and failing-test output exact by design; savings concentrate on listings, grep, and (hook-wrapped) passing suites.
- Ponytail upstream instruction size is external; re-measure after plugin updates. Wenyan not sampled (CJK tokenization is a separate study).
