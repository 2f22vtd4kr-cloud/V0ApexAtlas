---
name: Import startup rule
description: What to read and update at the start of every session, especially after a GitHub import.
---

## ABSOLUTE RULE — no exceptions, every session

At the start of every session (and always after a GitHub import), read both:
1. `replit.md` — architecture, env vars, ingestion endpoints, data integrity rules, user preferences, agent rules
2. `Context.md` — current environment status, what's pending, iteration log

**Why:** These two files together give the full picture of where the project stands. `replit.md` is stable reference; `Context.md` is the live running state. Without both, you will miss pending secrets, empty-DB conditions, or broken workflows.

## Update rule — mandatory before finishing any turn

Before finishing any turn that makes a meaningful change:

1. Update `Context.md`:
   - Update the "Current State" section (env vars set/missing, workflow status, DB record counts)
   - Append a row to the Iteration Log with today's date and a one-line summary

2. Update `replit.md` when any of these change:
   - Environment variables or secrets added/removed → update the env vars table
   - DB record counts change after ingestion → update "Current Data State"
   - New features or phases implemented → append to "Phases Implemented"
   - Schema changes → update "Database Schema"

3. Both files must be committed to the repo as part of the task. They are the permanent record.

## How to apply

- On import task assignment: read both files before touching anything else.
- After ingestion run: update DB record counts in both files.
- After adding a new secret: update the Environment section in `Context.md`.
- After schema changes: update `replit.md` Database Schema table.
- After persona/feature changes: update `replit.md` Phases Implemented.
- After synthetic-data fixes or guard additions: log in Context.md Iteration Log.

## Fresh database check

On a fresh GitHub import, a successful dependency install does not imply that the
Replit PostgreSQL schema exists. Apply the repository's existing Drizzle schema
before judging dashboard/API behavior; otherwise the services can start while
database-backed routes return 500.

**Why:** The imported project can retain code and lockfiles while receiving a new
empty development database. Preview checks against an uninitialized database
produce misleading application errors.

**How to apply:** Run the existing `@workspace/db` schema push, restart the
artifact-managed API service, then verify health, dashboard, job-polling, and
browser-preview responses.
