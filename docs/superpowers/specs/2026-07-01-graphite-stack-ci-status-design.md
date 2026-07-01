# Graphite stack CI status — distinct, categorized pills

**Date:** 2026-07-01
**Status:** Approved (ready for implementation planning)
**Repo:** refined-github-pr-ui (Chrome extension, MV3)

## Problem

On Graphite PR review pages (`app.graphite.com`), every stack row shows a single
generic pill — `Required checks failed` — regardless of *why* the required checks
are red. In practice a PR is very often "failing required checks" only because the
`require-uninvolved-approval` gate is unmet (it needs an approving review), **not**
because any test failed. The generic pill makes an approval-pending PR look
indistinguishable from one with genuinely broken E2E or unit tests.

Goal: replace the generic pill with **specific, categorized** pills so the real
blocker is obvious at a glance, and an approval gate never masquerades as a test
failure.

## Scope

- **In scope:** Graphite PR pages only. Enrich the CI/status pill(s) on each stack
  row (`StackViz` rows). Read per-PR check status from the GitHub API.
- **Out of scope:** GitHub's own PR pages (the existing `content.js` comment
  filter / whitespace features are untouched). No changes to comment filtering.
- **Non-goal (deferred, YAGNI):** a UI editor for the category mapping; multi-forge
  support beyond GitHub-hosted Graphite repos.

## Behavior

For each stack row, fetch the PR's required checks and review decision, categorize
the failing/pending **required** checks, and render **one pill per failing
category** (multiple pills, not a summarized `+N`). Non-required failures are
ignored (matching Graphite's own logic, which shows a PR with only non-required
failures as green "Ready to merge").

### Categories and pills

Each failing/pending required check is mapped to a category. One pill is rendered
per distinct category present, in this display order:

| Category | Pill label | Color | Trigger |
|---|---|---|---|
| E2E | `E2E tests` | red | required check name/context matches `/e2e|playwright/i` and failed |
| Unit | `Unit tests` | red | matches `/vitest|rb_test|rspec|jest|unit|js_rails_test/i` and failed |
| Build | `Build` | red | matches `/build|assets compilation|compile/i` and failed |
| Type check | `Type check` | red | matches `/type.?check|tsc|typescript/i` and failed |
| Lint | `Lint` | red | matches `/lint|rubocop|eslint|prettier/i` and failed |
| Other check | raw check name (truncated) | red | any other required check failed |
| Approval | `Needs approval` | amber | `reviewDecision !== APPROVED` **or** an approval-gate check (`/approval/i`, e.g. `require-uninvolved-approval`) is failing |
| Running | `Checks running` | yellow | required checks still `IN_PROGRESS`/`QUEUED`/`PENDING`, none failed |

Rules:
- Red failure pills are shown for each failing test/build category present.
- The amber **Needs approval** pill is shown whenever approval is the (or a)
  blocker — this is the key fix: it is visually distinct (amber) from red test
  failures, so pure approval-pending PRs read as "Needs approval", not "failed".
- **Running** is only shown if nothing has failed yet (otherwise the failure is
  the actionable signal).
- If all required checks pass and the PR is approved, leave Graphite's own
  `Ready to merge` pill untouched.
- Each pill's `title` (tooltip) lists the specific underlying check name(s) for
  that category.

### Categorization mapping

Kept as an editable constant in code for v1 (an options-page editor is deferred).
Patterns are matched against both `CheckRun.name` and `StatusContext.context`, in
priority order; the first match wins. Patterns are intentionally generic so the
feature works across repos, not just `padlet/mozart`.

## Data source

**GitHub GraphQL API v4** (`https://api.github.com/graphql`), authenticated with a
user-supplied **classic personal access token, `repo` scope** (the target repos are
private; classic tokens are coarse-grained, so `repo` is the minimum that grants the
Checks API + PR read).

One GraphQL request enriches an entire stack: alias one `pullRequest(number:)` per
row (PR numbers parsed from the row `href`s: `/github/pr/{owner}/{repo}/{number}/…`).
Per PR the query pulls:

- `reviewDecision`
- `commits(last:1) { nodes { commit { statusCheckRollup {
    state
    contexts(first:100) { nodes {
      __typename
      ... on CheckRun   { name conclusion status isRequired(pullRequestNumber: N) detailsUrl }
      ... on StatusContext { context state isRequired(pullRequestNumber: N) targetUrl }
    } } } } } }`

`isRequired(pullRequestNumber:)` is what lets us replicate Graphite's
"only required failures count" behavior without needing branch-protection/ruleset
admin access (the classic REST branch-protection endpoint 404s for non-admins here;
`isRequired` is available on the rollup contexts and needs only read access).

The `require-uninvolved-approval` blocker surfaces as a **`StatusContext`** with
`context = "require-uninvolved-approval"` and a failing `state` — matched by the
`/approval/i` pattern — and is corroborated by `reviewDecision`.

## Architecture

The extension is currently a single content script (`content.js`) with no
background worker. This feature adds a small, self-contained module set; the
existing comment-filter code is not modified.

**Chosen pattern: background service worker.** The token lives only in the service
worker. The content script parses PR identifiers from the DOM and requests enriched
status via `chrome.runtime.sendMessage`; the worker performs the authenticated
GitHub call and returns categorized results. This is the canonical MV3 pattern for
authenticated cross-origin calls and keeps the token out of the page's isolated
world entirely.

### New files

- **`background.js`** — service worker. Owns the GitHub GraphQL client, the token
  (read from `chrome.storage.local`), the category mapping, and an in-memory +
  `chrome.storage.local` result cache keyed by PR `headSHA`. Handles
  `runtime.onMessage({ type: 'GET_STACK_CI', prs: [{owner,repo,number}] })` →
  `{ [number]: { pills: [{category,label,color,checks:[…]}] } }`.
- **`graphite-stack-ci.js`** — content script (added to the existing Graphite
  `content_scripts` match). Finds stack rows, extracts `{owner,repo,number}` from
  each `href`, messages the worker, and renders pills. Debounced; integrates with a
  `MutationObserver` so it re-applies when Graphite re-renders.
- **`options.html` / `options.js`** — token entry. A password field storing the PAT
  in `chrome.storage.local`, an enable/disable toggle for the feature, and a
  "Test token" button that calls `GET https://api.github.com/user` and reports
  success/failure.

### Manifest changes (`manifest.json`)

- Add `background": { "service_worker": "background.js" }`.
- Add `"options_page": "options.html"`.
- Add `"https://api.github.com/*"` to `host_permissions`.
- Add `graphite-stack-ci.js` to the existing `app.graphite.com` content_scripts
  entry (alongside `content.js`).
- Bump `version`.

## Rendering, caching, lifecycle

- **Row → PR mapping:** each row is an `<a href="/github/pr/{owner}/{repo}/{number}/…">`;
  parse those segments. The current row has `aria-current="true"`. The trunk row
  (`master (trunk)`) has no PR link and is skipped.
- **Caching:** results keyed by PR `headSHA`, held in worker memory and mirrored to
  `chrome.storage.local` with a short TTL (~2 minutes). The content script's
  observer re-renders and SPA navigation therefore do **not** re-hit the API unless
  a PR's head SHA changed or the TTL expired. (Head SHA per row isn't in the DOM, so
  the worker resolves it as part of the GraphQL response and caches on it; the
  content script keys its request on `{owner,repo,number}` and the worker
  short-circuits on cached SHA/TTL.)
- **Idempotent DOM update:** locate each row's pill node
  (`[class*="Pill_pill__"]`), replace it with our rendered pill container, and tag
  the row `data-rgpr-ci="<number>:<sha-or-token-of-state>"`. If Graphite re-renders
  and wipes our pills, the `MutationObserver` re-applies from cache. Custom colors
  come from an injected `<style>` block (reusing the existing style-injection
  approach in `content.js`), with classes like `rgpr-pill--red|amber|yellow`.
- **Graceful degradation (never break the page):** if no token is set, the feature
  is disabled, or the API returns `401`/error/rate-limit, leave Graphite's original
  pills untouched. Errors are surfaced only in the options page (e.g. last-error
  status), never as page-breaking behavior. Respect `X-RateLimit-Remaining`; back
  off and fall back to the original pills when exhausted.

## Token handling (security note)

`chrome.storage.local` is unencrypted but sandboxed per-extension. A classic `repo`
token stored there is acceptable for a personal developer extension, but `repo` is
broad — this is documented in the options page. The token is only ever read by the
background worker and sent to `api.github.com`; it is never placed in the content
script or exposed to the Graphite page.

## Success criteria

- On a Graphite stack where a PR is blocked only by `require-uninvolved-approval`,
  the row shows a single **amber `Needs approval`** pill — not a red "failed" pill.
- On a PR with a genuinely failing required E2E check, the row shows a **red
  `E2E tests`** pill (plus a `Needs approval` amber pill if also unapproved).
- A PR with only non-required failures still shows green (unchanged).
- Re-rendering / navigating the stack does not produce redundant GitHub API calls
  within the cache TTL.
- With no token configured, the Graphite UI is visually unchanged from stock.
