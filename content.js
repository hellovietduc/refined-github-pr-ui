(function () {
  'use strict';

  // --- Constants ---

  const STORAGE_KEY = 'pr-filter-bot-overrides';
  const WHITESPACE_KEY = 'pr-filter-hide-whitespace';

  const KNOWN_BOTS = new Set([
    'github-actions',
    'graphite-app',
    'neetoplaydash',
    'codecov',
    'netlify',
    'vercel',
    'dependabot',
    'renovate',
    'cursor',
    'chatgpt-codex-connector',
    'coderabbit',
    'copilot',
    'linear',
    'mergify',
    'percy',
    'chromatic',
    'snyk',
    'sonarcloud',
  ]);

  // --- State ---

  let authors = new Map();
  let activePreset = 'humans';
  let panelExpanded = false;
  let panelEl = null;
  let cachedOverrides = {};

  let whitespaceHidden = true;
  let whitespacePanelExpanded = true;
  let linkInterceptionSetup = false;

  // --- Storage (chrome.storage.local instead of localStorage) ---

  function loadOverrides() {
    return cachedOverrides;
  }

  function saveOverrides(overrides) {
    cachedOverrides = overrides;
    chrome.storage.local.set({ [STORAGE_KEY]: overrides });
  }

  function initStorage(callback) {
    chrome.storage.local.get([STORAGE_KEY, WHITESPACE_KEY], (result) => {
      cachedOverrides = result[STORAGE_KEY] || {};
      whitespaceHidden = result[WHITESPACE_KEY] !== false;
      callback();
    });
  }

  // --- Page detection ---

  function isChangesPage() {
    return /\/pull\/\d+\/changes/.test(window.location.pathname);
  }

  // --- Whitespace redirect ---

  function handleWhitespaceRedirect() {
    if (!isChangesPage()) return false;

    const url = new URL(window.location.href);
    if (whitespaceHidden && url.searchParams.get('w') !== '1') {
      url.searchParams.set('w', '1');
      window.location.replace(url.toString());
      return true;
    }
    if (!whitespaceHidden && url.searchParams.get('w') === '1') {
      url.searchParams.delete('w');
      window.location.replace(url.toString());
      return true;
    }
    return false;
  }

  // --- Link interception ---

  function setupLinkInterception() {
    if (linkInterceptionSetup) return;
    linkInterceptionSetup = true;

    document.addEventListener('click', (e) => {
      const link = e.target.closest('a');
      if (!link) return;

      const href = link.getAttribute('href');
      if (!href) return;

      if (/\/pull\/\d+\/changes/.test(href)) {
        e.preventDefault();
        e.stopPropagation();

        const url = new URL(href, window.location.origin);
        if (whitespaceHidden) {
          url.searchParams.set('w', '1');
        }
        window.location.href = url.toString();
      }
    }, true);
  }

  // --- Bot detection ---

  function isBot(username) {
    const overrides = loadOverrides();
    if (overrides[username] === 'bot') return true;
    if (overrides[username] === 'human') return false;
    if (username.endsWith('[bot]')) return true;
    if (username.endsWith('-app')) return true;
    if (username.includes('-actions')) return true;
    if (KNOWN_BOTS.has(username)) return true;
    return false;
  }

  // --- Comment scanning ---

  function getAuthorFromComment(el) {
    const authorLink =
      el.querySelector('.author') ||
      el.querySelector('a.timeline-comment-header-text');
    if (authorLink) return authorLink.textContent.trim();
    return null;
  }

  function getCommentElements() {
    return [
      ...document.querySelectorAll(
        '.timeline-comment, .review-comment, .js-timeline-item'
      ),
    ];
  }

  function scanComments() {
    authors.clear();
    const elements = getCommentElements();
    let isFirst = true;

    for (const el of elements) {
      const username = getAuthorFromComment(el);
      if (!username) continue;

      if (isFirst) {
        isFirst = false;
        continue;
      }

      if (!authors.has(username)) {
        authors.set(username, {
          isBot: isBot(username),
          count: 0,
          elements: [],
        });
      }
      const entry = authors.get(username);
      entry.count++;
      entry.elements.push(el);
    }
  }

  // --- Filtering ---

  function getVisibleAuthors() {
    const visible = new Set();
    for (const [username, data] of authors) {
      if (activePreset === 'humans' && !data.isBot) visible.add(username);
      else if (activePreset === 'bots' && data.isBot) visible.add(username);
      else if (activePreset === 'all') visible.add(username);
    }
    return visible;
  }

  function applyFilters(visibleAuthors) {
    let visibleCount = 0;
    let totalCount = 0;

    for (const [username, data] of authors) {
      const show = visibleAuthors.has(username);
      for (const el of data.elements) {
        el.style.display = show ? '' : 'none';
      }
      totalCount += data.count;
      if (show) visibleCount += data.count;
    }

    return { visibleCount, totalCount };
  }

  function applyPreset(preset) {
    activePreset = preset;
    const visible = getVisibleAuthors();
    const counts = applyFilters(visible);
    renderPanel(counts, visible);
  }

  function toggleAuthor() {
    activePreset = 'custom';
    const visible = new Set();
    const checkboxes = panelEl.querySelectorAll('input[data-author]');
    for (const cb of checkboxes) {
      if (cb.checked) visible.add(cb.dataset.author);
    }

    const counts = applyFilters(visible);
    renderPanel(counts, visible);
  }

  // --- UI ---

  function createStyles() {
    if (document.getElementById('pr-filter-styles')) return;
    const style = document.createElement('style');
    style.id = 'pr-filter-styles';
    style.textContent = `
      #pr-filter-panel {
        position: fixed;
        bottom: 20px;
        right: 20px;
        z-index: 9999;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
        font-size: 13px;
        color: #e6edf3;
      }

      #pr-filter-pill {
        background: #21262d;
        border: 1px solid #30363d;
        border-radius: 20px;
        padding: 6px 14px;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 6px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        user-select: none;
      }
      #pr-filter-pill:hover {
        border-color: #58a6ff;
      }

      #pr-filter-expanded {
        background: #161b22;
        border: 1px solid #30363d;
        border-radius: 8px;
        width: 260px;
        box-shadow: 0 4px 16px rgba(0,0,0,0.4);
        overflow: hidden;
      }

      .pr-filter-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 10px 12px;
        border-bottom: 1px solid #30363d;
        font-weight: 600;
        font-size: 13px;
      }
      .pr-filter-header button {
        background: none;
        border: none;
        color: #8b949e;
        cursor: pointer;
        font-size: 16px;
        padding: 0 2px;
        line-height: 1;
      }
      .pr-filter-header button:hover { color: #e6edf3; }

      .pr-filter-presets {
        display: flex;
        gap: 4px;
        padding: 8px 12px;
        border-bottom: 1px solid #30363d;
      }
      .pr-filter-presets button {
        flex: 1;
        padding: 4px 8px;
        border-radius: 4px;
        border: 1px solid #30363d;
        background: #21262d;
        color: #8b949e;
        cursor: pointer;
        font-size: 12px;
        font-weight: 500;
      }
      .pr-filter-presets button:hover { border-color: #58a6ff; color: #e6edf3; }
      .pr-filter-presets button.active {
        background: #1f6feb;
        border-color: #1f6feb;
        color: #fff;
      }

      .pr-filter-section {
        padding: 6px 12px;
      }
      .pr-filter-section-title {
        font-size: 11px;
        font-weight: 600;
        color: #8b949e;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin-bottom: 4px;
      }

      .pr-filter-author {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 3px 0;
        position: relative;
      }
      .pr-filter-author input[type="checkbox"] {
        margin: 0;
        cursor: pointer;
      }
      .pr-filter-author label {
        flex: 1;
        cursor: pointer;
        display: flex;
        justify-content: space-between;
      }
      .pr-filter-author .count {
        color: #8b949e;
      }

      .pr-filter-status {
        padding: 8px 12px;
        border-top: 1px solid #30363d;
        color: #8b949e;
        font-size: 12px;
      }

      .pr-filter-empty-banner {
        padding: 8px 12px;
        color: #d29922;
        font-size: 12px;
        border-top: 1px solid #30363d;
      }

      .pr-filter-ctx-menu {
        position: fixed;
        background: #21262d;
        border: 1px solid #30363d;
        border-radius: 6px;
        padding: 4px 0;
        z-index: 10000;
        box-shadow: 0 4px 12px rgba(0,0,0,0.4);
      }
      .pr-filter-ctx-menu button {
        display: block;
        width: 100%;
        padding: 6px 14px;
        background: none;
        border: none;
        color: #e6edf3;
        cursor: pointer;
        font-size: 12px;
        text-align: left;
        white-space: nowrap;
      }
      .pr-filter-ctx-menu button:hover {
        background: #30363d;
      }

      .pr-filter-ws-buttons {
        display: flex;
        gap: 6px;
        padding: 10px 12px;
      }
      .pr-filter-ws-btn {
        flex: 1;
        padding: 6px 12px;
        border-radius: 6px;
        border: 1px solid #30363d;
        background: #21262d;
        color: #8b949e;
        cursor: pointer;
        font-size: 13px;
        font-weight: 500;
      }
      .pr-filter-ws-btn:hover {
        border-color: #58a6ff;
        color: #e6edf3;
      }
      .pr-filter-ws-btn.active {
        background: #1f6feb;
        border-color: #1f6feb;
        color: #fff;
      }
    `;
    document.head.appendChild(style);
  }

  function renderPanel(counts, visibleAuthors) {
    if (!panelEl) {
      panelEl = document.createElement('div');
      panelEl.id = 'pr-filter-panel';
      document.body.appendChild(panelEl);
    }

    const { visibleCount, totalCount } = counts || { visibleCount: 0, totalCount: 0 };
    visibleAuthors = visibleAuthors || new Set();

    if (!panelExpanded) {
      panelEl.innerHTML = `
        <div id="pr-filter-pill">
          <span style="font-size: 14px;">&#x1F50D;</span>
          <span>${visibleCount}/${totalCount}</span>
        </div>
      `;
      panelEl.querySelector('#pr-filter-pill').addEventListener('click', () => {
        panelExpanded = true;
        renderPanel(counts, visibleAuthors);
      });
      return;
    }

    const bots = [];
    const humans = [];
    for (const [username, data] of authors) {
      if (data.isBot) bots.push([username, data]);
      else humans.push([username, data]);
    }
    bots.sort((a, b) => a[0].localeCompare(b[0]));
    humans.sort((a, b) => a[0].localeCompare(b[0]));

    const presetBtn = (name, label) =>
      `<button data-preset="${name}" class="${activePreset === name ? 'active' : ''}">${label}</button>`;

    const authorRow = (username, data) => {
      const checked = visibleAuthors.has(username) ? 'checked' : '';
      return `
        <div class="pr-filter-author" data-ctx-author="${username}">
          <input type="checkbox" data-author="${username}" ${checked}>
          <label data-author-label="${username}">
            <span>${username}</span>
            <span class="count">(${data.count})</span>
          </label>
        </div>
      `;
    };

    let emptyBanner = '';
    if (visibleCount === 0 && totalCount > 0) {
      emptyBanner = `<div class="pr-filter-empty-banner">All comments filtered &mdash; adjust filters to see more</div>`;
    }

    let noComments = '';
    if (totalCount === 0) {
      noComments = `<div class="pr-filter-status">No comments on this PR</div>`;
    }

    panelEl.innerHTML = `
      <div id="pr-filter-expanded">
        <div class="pr-filter-header">
          <span>PR Comment Filter</span>
          <button id="pr-filter-collapse" title="Collapse">&minus;</button>
        </div>
        <div class="pr-filter-presets">
          ${presetBtn('humans', 'Humans only')}
          ${presetBtn('all', 'All')}
          ${presetBtn('bots', 'Bots only')}
        </div>
        ${bots.length ? `
          <div class="pr-filter-section">
            <div class="pr-filter-section-title">Bots</div>
            ${bots.map(([u, d]) => authorRow(u, d)).join('')}
          </div>
        ` : ''}
        ${humans.length ? `
          <div class="pr-filter-section">
            <div class="pr-filter-section-title">Humans</div>
            ${humans.map(([u, d]) => authorRow(u, d)).join('')}
          </div>
        ` : ''}
        ${noComments}
        ${emptyBanner}
        <div class="pr-filter-status">Showing ${visibleCount}/${totalCount} comments</div>
      </div>
    `;

    panelEl.querySelector('#pr-filter-collapse').addEventListener('click', () => {
      panelExpanded = false;
      renderPanel(counts, visibleAuthors);
    });

    for (const btn of panelEl.querySelectorAll('[data-preset]')) {
      btn.addEventListener('click', () => applyPreset(btn.dataset.preset));
    }

    for (const cb of panelEl.querySelectorAll('input[data-author]')) {
      cb.addEventListener('change', () => toggleAuthor(cb.dataset.author));
    }

    for (const row of panelEl.querySelectorAll('[data-ctx-author]')) {
      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showContextMenu(e.clientX, e.clientY, row.dataset.ctxAuthor);
      });
    }
  }

  // --- Whitespace Panel ---

  function renderWhitespacePanel() {
    if (!panelEl) {
      panelEl = document.createElement('div');
      panelEl.id = 'pr-filter-panel';
      document.body.appendChild(panelEl);
    }

    if (!whitespacePanelExpanded) {
      panelEl.innerHTML = `
        <div id="pr-filter-pill">
          <span>WS</span>
          <span>${whitespaceHidden ? 'Hidden' : 'Visible'}</span>
        </div>
      `;
      panelEl.querySelector('#pr-filter-pill').addEventListener('click', () => {
        whitespacePanelExpanded = true;
        renderWhitespacePanel();
      });
      return;
    }

    panelEl.innerHTML = `
      <div id="pr-filter-expanded">
        <div class="pr-filter-header">
          <span>Hide whitespace changes</span>
          <button id="pr-filter-collapse" title="Collapse">&minus;</button>
        </div>
        <div class="pr-filter-ws-buttons">
          <button class="pr-filter-ws-btn ${whitespaceHidden ? 'active' : ''}" data-ws="hide">Yes</button>
          <button class="pr-filter-ws-btn ${!whitespaceHidden ? 'active' : ''}" data-ws="show">No</button>
        </div>
      </div>
    `;

    panelEl.querySelector('#pr-filter-collapse').addEventListener('click', () => {
      whitespacePanelExpanded = false;
      renderWhitespacePanel();
    });

    for (const btn of panelEl.querySelectorAll('.pr-filter-ws-btn')) {
      btn.addEventListener('click', () => {
        const wantHide = btn.dataset.ws === 'hide';
        if (wantHide === whitespaceHidden) return;

        whitespaceHidden = wantHide;
        chrome.storage.local.set({ [WHITESPACE_KEY]: wantHide });

        const url = new URL(window.location.href);
        if (wantHide) {
          url.searchParams.set('w', '1');
        } else {
          url.searchParams.delete('w');
        }
        window.location.href = url.toString();
      });
    }
  }

  // --- Context menu ---

  function showContextMenu(x, y, username) {
    removeContextMenu();
    const data = authors.get(username);
    if (!data) return;

    const menu = document.createElement('div');
    menu.className = 'pr-filter-ctx-menu';
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';

    const label = data.isBot ? 'Mark as human' : 'Mark as bot';
    menu.innerHTML = `<button>${label}</button>`;

    menu.querySelector('button').addEventListener('click', () => {
      const overrides = loadOverrides();
      overrides[username] = data.isBot ? 'human' : 'bot';
      saveOverrides(overrides);
      removeContextMenu();
      reinit();
    });

    document.body.appendChild(menu);

    setTimeout(() => {
      document.addEventListener('click', removeContextMenu, { once: true });
    }, 0);
  }

  function removeContextMenu() {
    const existing = document.querySelector('.pr-filter-ctx-menu');
    if (existing) existing.remove();
  }

  // --- MutationObserver for lazy-loaded comments ---

  let observer = null;

  function setupObserver() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }

    const timeline = document.querySelector('.js-discussion, [data-target="diff-layout.mainContainer"]');
    if (!timeline) return;

    observer = new MutationObserver((mutations) => {
      let hasNewComments = false;
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === 1 && (
            node.matches?.('.timeline-comment, .review-comment, .js-timeline-item') ||
            node.querySelector?.('.timeline-comment, .review-comment')
          )) {
            hasNewComments = true;
            break;
          }
        }
        if (hasNewComments) break;
      }

      if (hasNewComments) {
        scanComments();
        const visible = getVisibleAuthors();
        const counts = applyFilters(visible);
        renderPanel(counts, visible);
      }
    });

    observer.observe(timeline, { childList: true, subtree: true });
  }

  // --- Init ---

  function reinit() {
    if (isChangesPage()) {
      renderWhitespacePanel();
      return;
    }
    scanComments();
    const visible = getVisibleAuthors();
    const counts = applyFilters(visible);
    renderPanel(counts, visible);
    setupObserver();
  }

  function init() {
    const existing = document.getElementById('pr-filter-panel');
    if (existing) existing.remove();
    panelEl = null;

    createStyles();
    setupLinkInterception();

    if (isChangesPage()) {
      if (handleWhitespaceRedirect()) return;
      whitespacePanelExpanded = false;
      renderWhitespacePanel();
      return;
    }

    panelExpanded = false;
    activePreset = 'humans';

    scanComments();
    const visible = getVisibleAuthors();
    const counts = applyFilters(visible);
    renderPanel(counts, visible);
    setupObserver();
  }

  // Bootstrap: load storage first, then run
  initStorage(() => {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  });

  // Re-init on GitHub SPA navigation
  document.addEventListener('turbo:load', () => initStorage(init));
  document.addEventListener('pjax:end', () => initStorage(init));
})();
