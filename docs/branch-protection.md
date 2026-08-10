# Branch Protection Settings (required)

This document records the GitHub branch protection settings required for
`main` in `rmarkonabor/leadrouting`. These are **repository settings**,
not something a GitHub Actions workflow file can enforce on its own — a
workflow can make checks exist and pass, but only branch protection makes
those checks (and a review, and "no direct pushes") actually mandatory.
They must be configured by a repository admin in **Settings → Branches →
Branch protection rules** (or the equivalent GitHub API/`gh` call), not
inferred from anything in this repo.

This session did not change these settings — configuring them changes who
can push directly to `main` and is exactly the kind of repository-wide,
hard-to-reverse-by-accident change that should be a deliberate action by
a human with admin access, not something applied silently as a side effect
of a CI change. This document is the specification; applying it is a
manual step for the repository owner.

## Required rule for `main`

| Setting                                                                 | Required value                                                                                                                       | Why                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Require a pull request before merging                                   | On                                                                                                                                   | No change reaches `main` without review context — matches CLAUDE.md's "one milestone/task at a time, reviewed" discipline already followed in this repo's history (every milestone has landed via PR).                                                                                                                                                     |
| Require status checks to pass before merging                            | On, with these checks required: `checks`, `migration-validation`, `integration-tests` (the three jobs in `.github/workflows/ci.yml`) | A PR cannot merge with a red CI run — this is what makes the CI pipeline (`docs/branch-protection.md`'s sibling, `.github/workflows/ci.yml`) an actual gate instead of an advisory signal.                                                                                                                                                                 |
| Require branches to be up to date before merging                        | On (recommended)                                                                                                                     | Prevents merging a PR whose checks ran against a now-stale base — avoids the "passed CI on an old main, breaks the real main" gap.                                                                                                                                                                                                                         |
| Restrict who can push to matching branches / Do not allow direct pushes | On — direct pushes to `main` disabled for everyone, including admins, where the GitHub plan allows it                                | "Disabled where possible" per the kickoff: on GitHub Free for a public repo this is fully enforceable (including for admins) at no cost; on some plan tiers admins can be exempted, which is a GitHub licensing limit, not a choice made here — if the current plan can't fully lock out admins, that's an accepted, documented gap, not silently ignored. |
| Require approvals                                                       | **1** approving review, required once this repository has more than one collaborator                                                 | With a single-maintainer repository (the current state), requiring a review would make every PR unmergeable by anyone — this requirement activates the moment a second collaborator is added, not before. Set `Required approving review count = 1` at that point.                                                                                         |
| Allow force pushes                                                      | Off                                                                                                                                  | A force-push to a protected branch can silently discard reviewed history — never appropriate for `main`.                                                                                                                                                                                                                                                   |
| Allow deletions                                                         | Off                                                                                                                                  | Prevents `main` itself from ever being deleted by mistake.                                                                                                                                                                                                                                                                                                 |

## Where this is configured

GitHub UI: repository → **Settings** → **Branches** → **Branch protection
rules** → **Add rule** (or **Edit** if one already exists) → branch name
pattern `main` → set the toggles above.

Equivalent via the GitHub API (for reference, not something this session
ran): `PUT /repos/{owner}/{repo}/branches/main/protection` with a body
setting `required_pull_request_reviews`, `required_status_checks`
(`strict: true`, `contexts: ["checks", "migration-validation",
"integration-tests"]`), `enforce_admins: true`, `restrictions: null`, and
`allow_force_pushes: false`.

## Secrets

No job in `.github/workflows/ci.yml` currently reads a real secret — every
env var it sets is a hardcoded, non-sensitive placeholder that only
satisfies this app's Zod env validation for a build/test run that never
contacts a real Supabase project or Sentry. If a future workflow step
needs a real credential (e.g. a production `SENTRY_AUTH_TOKEN` for a
release-tagging job, or real Supabase keys for a step that must talk to a
non-local project), it must be added as a **GitHub repository secret**
(Settings → Secrets and variables → Actions → New repository secret) and
referenced as `${{ secrets.<NAME> }}` in the workflow — never written as a
literal value in any `.yml` file. This mirrors `docs/setup.md` §6's
existing guidance for the equivalent Vercel environment variables.

## What this repository does not need branch protection to prevent (already impossible another way)

- **Automatic migration deployment to the linked/production Supabase
  project.** No job in `.github/workflows/ci.yml` runs `supabase db push`,
  `supabase link`, or any command against a non-local database — this
  isn't a permission that needs restricting, because the capability
  doesn't exist in the workflow at all. Applying a migration to the linked
  project remains a manual, explicit action per CLAUDE.md rules 10-12 (see
  `docs/setup.md` and `docs/database-schema.md` §22).
- **Vercel production deployment from a feature branch.** This is
  controlled by the Vercel project's own Git integration settings (its
  configured **Production Branch**, currently `main` — verified directly
  against the project's real deployment history: every deployment with
  `target: "production"` in this project originates from a push to `main`,
  and every deployment from any other branch is a Preview deployment).
  GitHub branch protection on `main` doesn't need to (and can't) enforce
  this — it's Vercel-side configuration, not something a GitHub Actions
  workflow controls.
