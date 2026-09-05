# Tersio Token Benchmark

Savings from `caveman`, `rtk`, `ponytail`, and `combo` presets: measured overhead plus modeled per-response savings.

## Method

- **Overhead (measured).** Exact prompt text each mode injects (`systemPrompt` additions, `rule.md`). Counted from this repo with `node`; tokens ≈ chars ÷ 4 (English prose estimate).
- **Savings (RTK measured, rest modeled).** RTK rows come from the table in §3a (real runs, method above). No mechanical caps exist — modes steer the model, so savings depend on compliance. Ranges below state their baselines; verify with the protocol in §5.
- **Ponytail upstream text** ships in the external `@dietrichgebert/ponytail` plugin, so only the bundled fallback is measured (floor value).

## 1. Session overhead (measured)

| Mode | Injected text | Chars | ≈ Tokens |
|---|---|---:|---:|
| caveman lite | instruction block | 200 | 50 |
| caveman full | instruction + `rule.md` | 653 | 163 |
| caveman ultra | instruction block | 314 | 79 |
| caveman wenyan | instruction block | 263 | 66 |
| rtk on | `RTK_PROMPT` | 627 | 157 |
| ponytail (fallback, floor) | fallback instruction | 298 | 75 |
| mode reinforcement | combo state line | ~284 | ~71 |

## 2. Combo preset overhead (measured sums)

| Preset | caveman | rtk | ponytail¹ | reinforcement | Total ≈ tokens |
|---|---|---|---|---|---:|
| medium | lite 50 | 161 | 75+ | 71 | ~360 |
| balanced | full 163 | 161 | 75+ | 71 | ~470 |
| max | ultra 79 | 161 | 75+ | 71 | ~390 |

¹ Ponytail real cost = upstream plugin instructions (external, varies by version); 75 is the bundled-fallback floor.

## 3. Per-response savings (modeled)

| Scenario | Baseline | With mode | Save / response | Pays off overhead after |
|---|---|---:|---:|---|
| Prose reply, caveman lite | ~400 tok | ~340 tok (−15%) | ~60 | ~1 reply |
| Prose reply, caveman full | ~400 tok | ~250 tok (−35%) | ~150 | ~2 replies |
| Prose reply, caveman ultra | ~400 tok | ~200 tok (−50%) | ~200 | ~1 reply |
| Shell-heavy turn, rtk on | see measured table below | | | first noisy command |
| Code task, ponytail lite | ~1,500 tok diff | ~1,200 tok | ~300 | ~1 task |
| Code task, ponytail full/ultra | ~1,500 tok diff | ~800 tok | ~700 | ~1 task |

### 3a. RTK measured (rtk 0.47.0, this repo, 2026-09-04; re-run post-refactor, same results)

Raw command vs `rtk` equivalent, bytes counted, tokens ≈ bytes ÷ 4.

| Command | Raw ≈ tokens | Via RTK ≈ tokens | Saved |
|---|---:|---:|---:|
| `npm test` (all pass) | 1,206 | 28 | 97% |
| repo-wide `grep` (60 hits) | 612 | 145 | 76% |
| `git status` | 34 | 21 | 37% |
| `find test -name '*.test.ts'` | 106 | 85 | 20% |
| `git diff HEAD~1` (small) | 2,513 | 2,484 | 1% |
| file read (`tersio.ts`, 53 KB) | 13,398 | 13,398 | 0% |
| `ls` tiny dir | 18 | 20 | −10% |

Reading: RTK pays on noisy repetitive output (passing suites, grep hits, logs). Near-zero on diffs, file reads, and trivial listings — it passes those through.

Scope note: savings are measured via `rtk gain` accounting on hook-wrapped tool results (`rtk init -g`). Direct piped invocations (`rtk npm test | wc -c`) pass through nearly unfiltered (−1% saved) — the filter applies to the wrapped tool-result path, not piped stdout.

## 4. Preset guidance

| Session shape | Pick | Why |
|---|---|---|
| Q&A, reviews, chat | `/combo medium` | cheapest overhead (~360), lite prose savings |
| Mixed code + shell (default) | `/combo balanced` | full prose + RTK; overhead (~470) repaid by first noisy command |
| Big refactors, long logs | `/combo max` | ultra prose + full ponytail; max per-response cut |
| Exact output matters (diffs for patching, confirmations) | rtk off | RTK hides raw text by design |
| Security / irreversible actions | modes auto-drop | Auto-Clarity boundary, not a saving |

## 5. Verify with real sessions

1. Run the same task list twice (modes off, then target preset) in fresh OMP sessions.
2. Record per-session input/output tokens from the provider usage panel.
3. Net saving = (off − on) − preset overhead from §2.
4. Suggested tasks: explain a module (prose), `git diff` triage + full test run (shell), small feature (code).

## 6. Runtime + memory delta (main vs PR #6)

Measured 2026-09-05, same machine (darwin 25.6.0, arm64), Node v26.8.1. `main` at `ba5be34` vs PR branch at Audit69, both freshly built with `tsc`. Wall time = median of 5 runs; peak RSS = median of 3 runs via `/usr/bin/time -l`.

| Case | main | PR #6 | Δ |
|---|---:|---:|---:|
| `install --dry-run --scope both --yes` (median wall) | 0.910 s | 0.687 s | **−24.5%** |
| `--doctor` (median wall) | 0.460 s | 0.405 s | **−12.0%** |
| install dry-run peak RSS (median) | 142.7 MiB | 142.0 MiB | −0.5% (within noise) |
| `--doctor` peak RSS (median) | 141.9 MiB | 141.6 MiB | −0.2% (within noise) |
| Source TS LOC | 2,818 | 2,717 | −101 (−3.6%) |

Reading: wall-time wins come from the refactor's concurrency changes — concurrent companion reads in `copySources` (Audit66), doctor probes batched with FS probes (Audit65), single shared caveman rule fetch (Audit69). Memory is flat: Node's ~142 MiB baseline dominates; the refactor trades no RAM for the speed.

## 7. Caveats

- Model compliance varies; ultra/wenyan can harm clarity — re-prompt on confusion.
- Ponytail upstream instruction size is outside this repo; re-measure after plugin updates.
- Token math uses chars ÷ 4; CJK/code-heavy text diverges — treat tables as planning bounds, not invoices.
