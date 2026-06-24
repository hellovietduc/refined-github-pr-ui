# refined-github-pr-ui

A Chrome extension that cleans up GitHub **and Graphite** PR pages.

## Features

- **Filter bot comments** — Hides bot noise (GitHub Actions, Codecov, Dependabot, Graphite/Linear/Cursor/Claude review bots, etc.) so you can focus on human feedback. Works on both `github.com` PR pages and `app.graphite.com` PR review pages. Right-click any author to reclassify them as bot or human.
- **Auto-hide whitespace changes** — Automatically adds `?w=1` on GitHub PR "Changes" pages so whitespace diffs don't clutter your review. (GitHub only — Graphite has its own diff settings.)

## Install

1. Clone this repo
2. Open `chrome://extensions` in Chrome
3. Enable **Developer mode**
4. Click **Load unpacked** and select the repo folder

## How it works

A floating panel appears on PR pages with preset filters (Humans only / All / Bots only) and per-author checkboxes. Classification overrides are persisted via `chrome.storage.local`.

The extension is site-aware:

- **GitHub** — scans timeline/review comments and handles SPA navigation via `turbo:load` / `pjax:end`.
- **Graphite** — scans the discussion list (`role="list" aria-label="Discussion"`), reading each author from the avatar's `title`. Because Graphite is a client-rendered Next.js SPA with no turbo/pjax events, navigation is detected by patching `history.pushState`/`replaceState` and watching `popstate`, and a debounced `MutationObserver` re-scans as the discussion renders.

CSS-module class hashes on Graphite (e.g. `DiscussionItem_discussionItem__EBj0h`) are matched on their stable prefix (`[class*="DiscussionItem_discussionItem__"]`) so the extension survives Graphite rebuilds.
