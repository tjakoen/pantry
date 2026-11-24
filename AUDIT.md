---
audited: never
result: runbook only
---

# AUDIT: the alignment runbook

The committed procedure that checks this repository still obeys the rules `CLAUDE.md` claims. It is the
**alignment** half of an audit: mechanical checks with a command and a pass bar, all run from the
repository root.

The **quality** half is
[`AUDIT-STANDARD.md`](https://portfolio.tjakoen.com/standards/audit-standard). A pass that runs only
this file is the most common way an audit lies. Nothing here restates `CLAUDE.md` or the canonical
standards; when a check and a canon disagree, the canon wins and the check gets fixed.

Run every check, then either fix what it finds or flag it as deferred with a reason. Set `audited:` to
the date of the pass and leave the report beside the work.

## 1. The green gate

```sh
bun run check
bun test
bun run lint 2>&1 | grep -E "^[^ ]+:[0-9]+:[0-9]+: error"
```

Pass: `bun run check` exits 0 with no type errors, `bun test` reports `0 fail`, and the lint grep
prints nothing. Warnings stay advisory, as they are in `ci.yml`; an `error` is the correctness category
and is not.

## 2. The distribution boundary still holds

```sh
bun test tools/package-smoke.test.ts
```

Pass: `0 fail`. This packs the package and exercises the extracted CLI and control client outside the
checkout.

## 3. Docs reference only code and routes that exist

```sh
bun cli.ts check
```

Pass: a line ending `0 problems` and exit 0. The drift check resolves the repository's own docs against
the code they name.

## 4. The front-door links resolve

```sh
for f in README.md CLAUDE.md PLAN.md INSTALL.md docs/WORKFLOW.md; do
  grep -oE '\]\(([^)#]+)' "$f" | sed 's/](//' | while read -r p; do
    case "$p" in http*|mailto:*) continue;; esac
    [ -e "$p" ] || [ -e "$(dirname "$f")/$p" ] || echo "$f -> missing: $p"
  done
done
```

Pass: no `missing:` line. External URLs are not fetched.

## 5. Layer code is reached as a package, never as a sibling path

```sh
git grep -nE "from ['\"]\.\./[^'\"]*(batch|grain|mill|proof)" -- '*.ts'
```

Pass: no output.

## 6. No layer source is copied into this tree

```sh
for d in batch grain mill proof; do [ -d "$d" ] && echo "local layer dir: $d"; done
```

Pass: no output. The framework docs and assets render from the installed packages.

## 7. The layer pins are registry ranges, and the portfolio pin is a sha

```sh
grep -cE '"@tjakoen/(batch|grain|mill|proof|crumb)": "\^' package.json
grep -E '"tjakoen.github.io": "github:tjakoen/tjakoen.github.io#[0-9a-f]{7}"' package.json
```

Pass: `5`, then exactly one `tjakoen.github.io` line carrying a seven-character sha.

## 8. No `.npmrc` is committed

```sh
find . -name .npmrc -not -path "./node_modules/*"
```

Pass: no output.

## 9. `AGENTS.md` is the shared link, not a second copy

```sh
[ -L AGENTS.md ] && [ "$(readlink AGENTS.md)" = "CLAUDE.md" ] && echo ok
```

Pass: `ok`.

## 10. No secret material is tracked

```sh
git grep -nE "ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|npm_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----" -- . ':!bun.lock'
```

Pass: no output. A hit is a blocker, not a finding.

## 11. The history carries no AI attribution

```sh
git log -E --grep="^Co-Authored-By:" --oneline | wc -l
```

Pass: `0`. The pattern is anchored so this section does not match itself.

## Findings template

```
✅ 1. gate                green
⚠️ 3. docs drift          docs/WORKFLOW.md:41, names a removed command, update the doc
🚫 2. package smoke       cannot run on this machine, deferred, accepted: CI covers it
```

Done means every line is ✅, or every ⚠️ is fixed, or every 🚫 names why it is deferred and who
accepted it. Then replace `audited: never` with the date.
