---
name: GitHub sync branch workflow
description: When GitHub main diverges and managed pushes reject existing branches, publish a verified sync branch and open a PR.
---

The Replit-managed Git push helper can publish a new GitHub branch but may reject updating an existing `main` branch, while direct HTTPS pushes may lack credentials. This can persist even after reconciling a divergent remote main locally; publish the local result to a uniquely named sync branch and open a pull request instead of force-pushing.

**Why:** The local checkout can contain valid commits and an internal backup ref without those commits being present on the user’s GitHub default branch. A clean local status is not proof of remote publication.

**How to apply:** Before declaring work wrapped up, inspect the GitHub remote, compare hashes, and verify publication with a remote ref or PR URL. Compare the merged remote tree before replaying a milestone: a PR may legitimately contain only a small delta when the implementation is already upstream. Never claim `main` was updated unless the remote hash confirms it.

The Replit Git activity feed can retain red-X entries for failed sync attempts even after a later push or PR merge succeeds. Verify GitHub directly via `git ls-remote origin refs/heads/main` or the GitHub commit API before treating those entries as the current repository state.

**Why:** The activity feed records each attempted sync independently and can make an old failed attempt look like the current branch status.

**How to apply:** When the Git pane shows red-X commit entries, refresh the GitHub `main` ref and inspect the commit URL/API; do not retry or diagnose from the feed alone.

Direct HTTPS pushes can still fail with “Invalid username or token” even when the remote is readable and the Replit helper can create a PR. In that case, treat the sync branch and PR as the safe handoff; do not force-push or invent a merge confirmation.

**Why:** Read access to a public repository does not imply an authenticated write session, and the local GitHub connector may report `not_setup` independently of the configured remote.

**How to apply:** Verify `refs/heads/main` and the sync branch with `git ls-remote`; report the PR URL and unchanged `main` hash until an authenticated merge is completed.

The push helper can also refuse a newly named sync branch when its local upstream still points at `origin/main`; unset that branch's upstream before retrying a normal push.

**Why:** A branch created from remote `main` may inherit tracking metadata even though its intended publication target is a separate remote branch.

**How to apply:** Check `git status -sb` before publishing. If the sync branch tracks `origin/main`, use `git branch --unset-upstream`, then push the explicit sync-branch name without force.