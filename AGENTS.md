# Agent Instructions

This project uses **bd** (beads) for issue tracking. Run `bd onboard` to get started.

## Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --status in_progress  # Claim work
bd close <id>         # Complete work
bd sync               # Sync with git
```

## Landing the Plane (Session Completion)

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd sync
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds


<!-- bv-agent-instructions-v1 -->

---

## Beads Workflow Integration

This project uses [beads_viewer](https://github.com/Dicklesworthstone/beads_viewer) for issue tracking. Issues are stored in `.beads/` and tracked in git.

### Essential Commands

```bash
# View issues (launches TUI - avoid in automated sessions)
bv

# CLI commands for agents (use these instead)
bd ready              # Show issues ready to work (no blockers)
bd list --status=open # All open issues
bd show <id>          # Full issue details with dependencies
bd create --title="..." --type=task --priority=2
bd update <id> --status=in_progress
bd close <id> --reason="Completed"
bd close <id1> <id2>  # Close multiple issues at once
bd sync               # Commit and push changes
```

### Workflow Pattern

1. **Start**: Run `bd ready` to find actionable work
2. **Claim**: Use `bd update <id> --status=in_progress`
3. **Work**: Implement the task
4. **Complete**: Use `bd close <id>`
5. **Sync**: Always run `bd sync` at session end

### Key Concepts

- **Dependencies**: Issues can block other issues. `bd ready` shows only unblocked work.
- **Priority**: P0=critical, P1=high, P2=medium, P3=low, P4=backlog (use numbers, not words)
- **Types**: task, bug, feature, epic, question, docs
- **Blocking**: `bd dep add <issue> <depends-on>` to add dependencies

### Session Protocol

**Before ending any session, run this checklist:**

```bash
git status              # Check what changed
git add <files>         # Stage code changes
bd sync                 # Commit beads changes
git commit -m "..."     # Commit code
bd sync                 # Commit any new beads changes
git push                # Push to remote
```

### Best Practices

- Check `bd ready` at session start to find available work
- Update status as you work (in_progress → closed)
- Create new issues with `bd create` when you discover tasks
- Use descriptive titles and set appropriate priority/type
- Always `bd sync` before ending session

<!-- end-bv-agent-instructions -->

---

## ACE Labels for Automated Execution

When converting plans to epics, apply ACE labels to enable the Ralph automation loop.

### Required Structure

An ACE epic requires:
1. **Epic** with `ace:epic` label
2. **Test tasks** with `ace:test` label (one per feature, TDD - write failing tests first)
3. **Code tasks** with `ace:code` label (one per feature, depends on its test)
4. **Review task** with `ace:review` label (exactly one, gates completion)

### Labels

| Label | Applied To | Purpose |
|-------|-----------|---------|
| `ace:epic` | Epic | Marks epic as ACE-managed |
| `ace:test` | Task | Write failing tests first (TDD) |
| `ace:code` | Task | Implement code to pass tests |
| `ace:review` | Task | Final review gate |

### Workflow Order (TDD)

```
ace:test (open) → ace:code (blocked) → ace:review (blocked)
     ↓                   ↓                    ↓
  write tests    implement code         review & merge
     ↓                   ↓                    ↓
   (close)      (depends on test)      (depends on all code)
```

### Commands to Apply

```bash
# 1. Label the epic
bd update <epic-id> --add-label ace:epic

# 2. Create test tasks (children of epic)
bd create --title="Test: <feature>" --type=task --parent=<epic-id> --labels=ace:test

# 3. Create code tasks (children of epic, depend on tests)
bd create --title="Implement: <feature>" --type=task --parent=<epic-id> --labels=ace:code
bd dep add <code-task-id> <test-task-id>

# 4. Create review gate (child of epic)
bd create --title="Review: <epic-name>" --type=task --parent=<epic-id> --labels=ace:review
```

### Converting Plans to Epics

**IMPORTANT: Ask the user before creating epic structure:**

> "Should this be a single epic with phases as tasks, or one epic per phase?"

**Single epic** (simpler, fewer beads):
- One `ace:epic` containing all phases
- Good for cohesive features that ship together

**Epic per phase** (more granular):
- Each phase becomes its own `ace:epic`
- Good for large migrations where phases can ship independently
- Allows parallel work on different phases

### Phase Detection Logic

Ralph detects phases in this priority:

1. **L1-Micro**: Code task `in_progress` + last run failed → iterate on failing tests
2. **L2-Task (test)**: Any test task open → write failing tests
3. **L2-Task (code)**: Code task open + its test closed → implement code
4. **L3-Epic**: All code closed + review open → review gate
5. **Complete**: Review closed + all tasks closed
6. **Stuck**: No actionable work (missing labels or structure)

### Validation

```bash
bd show <epic-id>           # Verify ace:epic label
bd list --parent=<epic-id>  # List children, verify labels
bd blocked                  # See dependency structure
```

---

## Chain Price List Sources

| Chain | Price List URL | Format | Status |
|-------|---------------|--------|--------|
| Konzum | https://www.konzum.hr/cjenici | CSV | ✅ Done |
| Lidl | https://tvrtka.lidl.hr/cijene | CSV (ZIP) | ✅ Done |
| Plodine | https://www.plodine.hr/info-o-cijenama | CSV | Pending |
| Interspar | https://www.spar.hr/usluge/cjenici | CSV | Pending |
| Eurospin | https://www.eurospin.hr/cjenik/ | CSV | Pending |
| Kaufland | https://www.kaufland.hr/akcije-novosti/popis-mpc.html | CSV | Pending |
| KTC | https://www.ktc.hr/cjenici | CSV | ✅ Done |
| Metro | https://metrocjenik.com.hr/ | CSV | Pending |
| Studenac | https://www.studenac.hr/popis-maloprodajnih-cijena | XML | Pending |
| Trgocentar | https://trgocentar.com/Trgovine-cjenik/ | XML | Pending |
| DM | https://www.dm.hr/novo/promocije/nove-oznake-cijena-i-vazeci-cjenik-u-dm-u-2906632 | XLSX | Pending |
