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
| rtk on | `RTK_PROMPT` | 645 | 161 |
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

### 3a. RTK measured (rtk 0.47.0, this repo, 2026-09-04)

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
| Code task, ponytail lite | ~1,500 tok diff | ~1,200 tok | ~300 | ~1 task |
| Code task, ponytail full/ultra | ~1,500 tok diff | ~800 tok | ~700 | ~1 task |

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

## 6. Caveats

- Model compliance varies; ultra/wenyan can harm clarity — re-prompt on confusion.
- Ponytail upstream instruction size is outside this repo; re-measure after plugin updates.
- Token math uses chars ÷ 4; CJK/code-heavy text diverges — treat tables as planning bounds, not invoices.
