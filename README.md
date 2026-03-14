# refined-github-pr-ui

A Chrome extension that cleans up GitHub PR pages.

## Features

- **Filter bot comments** — Hides bot noise (GitHub Actions, Codecov, Dependabot, etc.) so you can focus on human feedback. Right-click any author to reclassify them as bot or human.
- **Auto-hide whitespace changes** — Automatically adds `?w=1` on PR "Changes" pages so whitespace diffs don't clutter your review.

## Install

1. Clone this repo
2. Open `chrome://extensions` in Chrome
3. Enable **Developer mode**
4. Click **Load unpacked** and select the repo folder

## How it works

A floating panel appears on PR pages with preset filters (Humans only / All / Bots only) and per-author checkboxes. Classification overrides are persisted via `chrome.storage.local`. The extension handles GitHub's SPA navigation (`turbo:load`, `pjax:end`) and observes the DOM for lazy-loaded comments.
