/* ── State ────────────────────────────────────────────────── */
const state = {
  docs: [],
  currentDoc: null,
  view: 'list', // 'list' | 'doc' | 'edit'
  filter: { q: '', tag: '', dir: '' },
};

/* ── Helpers ─────────────────────────────────────────────── */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function isMobile() {
  return window.innerWidth <= 768;
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function formatDate(d) {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt)) return '';
  return dt.toLocaleDateString('fr-CA', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

/* ── Sidebar toggle ──────────────────────────────────────── */
function openSidebar() {
  $('#sidebar').classList.add('open');
  $('#sidebar-overlay').classList.remove('hidden');
}
function closeSidebar() {
  $('#sidebar').classList.remove('open');
  $('#sidebar-overlay').classList.add('hidden');
}

/* ── API ─────────────────────────────────────────────────── */
async function api(path, opts = {}) {
  const r = await fetch(path, opts);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}

/* ── Load & Build ────────────────────────────────────────── */
async function loadDocs() {
  state.docs = await api('/api/docs');
  renderTags();
  renderDirs();
  renderGrid();
  syncSearch();
}

/* ── Tags ────────────────────────────────────────────────── */
async function renderTags() {
  const tags = await api('/api/tags');
  const container = $('#tag-cloud');
  container.innerHTML = tags.map(t =>
    `<span class="tag${state.filter.tag === t.name ? ' active' : ''}" data-tag="${t.name}">
      ${t.name} <span class="count">${t.count}</span>
    </span>`
  ).join('');
  container.querySelectorAll('.tag').forEach(el => {
    el.addEventListener('click', () => {
      const tag = el.dataset.tag;
      state.filter.tag = state.filter.tag === tag ? '' : tag;
      renderTags();
      applyFilter();
      if (isMobile()) closeSidebar();
    });
  });
}

/* ── Directories ─────────────────────────────────────────── */
async function renderDirs() {
  const dirs = await api('/api/dirs');
  const sel = $('#dir-filter');
  sel.innerHTML = '<option value="">Tous les dossiers</option>' +
    dirs.map(d => `<option value="${d.path}"${state.filter.dir === d.path ? ' selected' : ''}>${d.name} (${d.count})</option>`).join('');
  const activeDirs = dirs.filter(d => d.count > 0);
  $('#dir-count').textContent = `${activeDirs.length} dossier${activeDirs.length !== 1 ? 's' : ''}`;

  // Sync mobile filter
  const msel = $('#mobile-dir-filter');
  if (msel) {
    msel.innerHTML = sel.innerHTML;
    msel.value = state.filter.dir;
  }
}

/* ── Card Grid ───────────────────────────────────────────── */
function renderGrid() {
  const container = $('#card-grid');
  let items = filterDocs();

  if (items.length === 0) {
    container.innerHTML = `<div class="empty-state">
      <h2>Aucun document trouvé</h2>
      <p>Essaie de modifier tes filtres, ou ajoute des fichiers .md dans un dossier configuré.</p>
    </div>`;
    return;
  }

  container.innerHTML = items.map(d => {
    const tags = (d.tags || []).map(t =>
      `<span class="tag" data-tag="${t}">${t}</span>`
    ).join('');
    return `<div class="card" data-path="${escapeHtml(d.path)}">
      <h3>${escapeHtml(d.title)}</h3>
      <div class="card-meta">
        <span class="card-dir">${d.dir ? d.dir.split('/').pop() : ''}</span>
        ${d.created ? `<span>${formatDate(d.created)}</span>` : ''}
        <span>${d.size} o</span>
      </div>
      <div class="card-excerpt">${escapeHtml(d.excerpt)}</div>
      ${tags ? `<div class="card-tags">${tags}</div>` : ''}
    </div>`;
  }).join('');

  container.querySelectorAll('.card').forEach(el => {
    el.addEventListener('click', () => openDoc(el.dataset.path));
    el.querySelectorAll('.tag').forEach(t => t.addEventListener('click', e => {
      e.stopPropagation();
      state.filter.tag = state.filter.tag === t.dataset.tag ? '' : t.dataset.tag;
      renderTags();
      applyFilter();
    }));
  });

  $('#doc-count').textContent = `${items.length} doc${items.length !== 1 ? 's' : ''}`;
}

/* ── Filtering / Search ──────────────────────────────────── */
function filterDocs() {
  let items = [...state.docs];
  const { q, tag, dir } = state.filter;

  if (dir) items = items.filter(d => d.dir === dir);
  if (tag) items = items.filter(d => d.tags && d.tags.includes(tag));
  if (q) {
    const lq = q.toLowerCase();
    items = items.filter(d =>
      d.title.toLowerCase().includes(lq) ||
      d.excerpt.toLowerCase().includes(lq) ||
      (d.tags || []).some(t => t.toLowerCase().includes(lq))
    );
  }
  return items;
}

function applyFilter() {
  renderGrid();
  renderTags();
}

function syncSearch() {
  // Sync mobile search from desktop
  const desktopVal = $('#search-input').value;
  const mobileInput = $('#mobile-search-input');
  if (mobileInput && mobileInput.value !== desktopVal) {
    mobileInput.value = desktopVal;
  }
}

/* ── Document View ───────────────────────────────────────── */
async function openDoc(filePath) {
  state.currentDoc = await api(`/api/docs/${encodeURIComponent(filePath)}`);
  state.view = 'doc';
  showView('doc');

  $('#doc-title-display').textContent = state.currentDoc.title;
  const tags = (state.currentDoc.tags || []).join(', ');
  $('#doc-meta').textContent = [state.currentDoc.created, tags, `${state.currentDoc.size} o`].filter(Boolean).join(' · ');
  $('#doc-content').innerHTML = state.currentDoc.html;
  $('#btn-open-file').href = `file://${state.currentDoc.path}`;

  // Scroll to top
  $('#main').scrollTop = 0;
}

/* ── Edit View ───────────────────────────────────────────── */
function openEdit() {
  if (!state.currentDoc) return;
  state.view = 'edit';
  showView('edit');

  $('#edit-title').textContent = `✎ ${state.currentDoc.title}`;
  const ta = $('#edit-textarea');
  ta.value = state.currentDoc.body;
  renderPreview();
  // On mobile, start in edit mode, not preview
  if (isMobile() && previewVisible) togglePreview();
}

let previewVisible = false;

function renderPreview() {
  const preview = $('#preview-pane');
  preview.innerHTML = marked.parse($('#edit-textarea').value);
}

function togglePreview() {
  previewVisible = !previewVisible;
  const pane = $('#preview-pane');
  const editor = $('#edit-textarea');
  const toolbar = $('#edit-toolbar-format');
  const btn = $('#edit-preview-toggle');

  pane.classList.toggle('hidden', !previewVisible);
  editor.style.display = previewVisible ? 'none' : '';
  toolbar.style.display = previewVisible ? 'none' : '';
  // Reset edit-container to flex-column (editor takes space when visible)
  btn.textContent = previewVisible ? '✎' : 'Aperçu';
}

async function saveDoc() {
  const body = $('#edit-textarea').value;
  const path = state.currentDoc.path;
  try {
    await api(`/api/docs/${encodeURIComponent(path)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body, encoding: 'full' }),
    });
    await loadDocs();
    await openDoc(path);
  } catch (e) {
    alert('Erreur: ' + e.message);
  }
}

/* ── View Switching ──────────────────────────────────────── */
function showView(view) {
  $('#list-view').classList.toggle('hidden', view !== 'list');
  $('#doc-view').classList.toggle('hidden', view !== 'doc');
  $('#edit-view').classList.toggle('hidden', view !== 'edit');
  if (isMobile() && view === 'list') closeSidebar();
}

/* ── Event Listeners ─────────────────────────────────────── */

// Sidebar
$('#btn-hamburger').addEventListener('click', openSidebar);
$('#btn-hamburger-main').addEventListener('click', openSidebar);
$('#sidebar-overlay').addEventListener('click', closeSidebar);

// Search (desktop)
$('#search-input').addEventListener('input', () => {
  state.filter.q = $('#search-input').value;
  const mobileInput = $('#mobile-search-input');
  if (mobileInput) mobileInput.value = state.filter.q;
  applyFilter();
});
$('#btn-clear').addEventListener('click', () => {
  $('#search-input').value = '';
  state.filter.q = '';
  const mobileInput = $('#mobile-search-input');
  if (mobileInput) mobileInput.value = '';
  applyFilter();
});

// Search (mobile)
$('#mobile-search-input').addEventListener('input', () => {
  state.filter.q = $('#mobile-search-input').value;
  $('#search-input').value = state.filter.q;
  applyFilter();
});
$('#mobile-btn-clear').addEventListener('click', () => {
  $('#mobile-search-input').value = '';
  state.filter.q = '';
  $('#search-input').value = '';
  applyFilter();
});

// Directory filters
$('#dir-filter').addEventListener('change', () => {
  state.filter.dir = $('#dir-filter').value;
  const msel = $('#mobile-dir-filter');
  if (msel) msel.value = state.filter.dir;
  applyFilter();
});
$('#mobile-dir-filter').addEventListener('change', () => {
  state.filter.dir = $('#mobile-dir-filter').value;
  $('#dir-filter').value = state.filter.dir;
  applyFilter();
});

// Navigation
$('#btn-back').addEventListener('click', () => {
  state.view = 'list';
  state.currentDoc = null;
  showView('list');
  applyFilter();
});

$('#btn-edit').addEventListener('click', openEdit);
$('#edit-back').addEventListener('click', async () => {
  if (state.currentDoc) {
    state.view = 'doc';
    showView('doc');
    $('#doc-content').innerHTML = state.currentDoc.html;
  } else {
    state.view = 'list';
    showView('list');
  }
});
$('#edit-preview-toggle').addEventListener('click', togglePreview);
$('#edit-save').addEventListener('click', saveDoc);

// Re-index
$('#btn-index').addEventListener('click', async () => {
  $('#btn-index').textContent = '…';
  await loadDocs();
  $('#btn-index').textContent = '⟳';
  if (state.view === 'list') applyFilter();
});

// Live preview on keystroke
$('#edit-textarea').addEventListener('input', () => {
  if (previewVisible) renderPreview();
});

// Format toolbar
$('#edit-toolbar-format').addEventListener('click', e => {
  const btn = e.target.closest('button');
  if (!btn || !btn.dataset.cmd) return;
  const ta = $('#edit-textarea');
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const sel = ta.value.slice(start, end);
  const lines = ta.value.slice(0, start).split('\n');
  const curLine = lines.length - 1;
  const curLineText = lines[curLine] || '';

  const inserts = {
    bold: ['**', '**'],
    italic: ['*', '*'],
    code: ['`', '`'],
    link: ['[', '](url)'],
  };

  const cmd = btn.dataset.cmd;
  if (cmd === 'header') {
    const before = ta.value.slice(0, start);
    const lineStart = before.lastIndexOf('\n') + 1;
    const prefix = curLineText.trim().startsWith('#') ? '' : '## ';
    ta.value = ta.value.slice(0, lineStart) + prefix + ta.value.slice(lineStart);
    ta.selectionStart = ta.selectionEnd = start + prefix.length;
  } else if (cmd === 'list') {
    const before = ta.value.slice(0, start);
    const lineStart = before.lastIndexOf('\n') + 1;
    ta.value = ta.value.slice(0, lineStart) + '- ' + ta.value.slice(lineStart);
    ta.selectionStart = ta.selectionEnd = start + 2;
  } else if (cmd === 'hr') {
    ta.value = ta.value.slice(0, start) + '\n---\n' + ta.value.slice(end);
    ta.selectionStart = ta.selectionEnd = start + 5;
  } else if (inserts[cmd]) {
    const [open, close] = inserts[cmd];
    ta.value = ta.value.slice(0, start) + open + sel + close + ta.value.slice(end);
    ta.selectionStart = start + open.length;
    ta.selectionEnd = sel ? start + open.length + sel.length : start + open.length;
  }

  ta.focus();
  if (previewVisible) renderPreview();
});

// Keyboard shortcuts
$('#edit-textarea').addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    saveDoc();
  }
});

// Handle resize for mobile/desktop transitions
window.addEventListener('resize', () => {
  if (!isMobile()) closeSidebar();
});

// Swipe to close sidebar on mobile
let touchStartX = 0;
document.addEventListener('touchstart', (e) => {
  touchStartX = e.changedTouches[0].screenX;
});
document.addEventListener('touchend', (e) => {
  const dx = e.changedTouches[0].screenX - touchStartX;
  if (isMobile() && dx > 80 && $('#sidebar').classList.contains('open')) {
    closeSidebar();
  }
});

// Fix mobile 100vh issue (Chrome address bar)
function fixVH() {
  let vh = window.innerHeight;
  document.documentElement.style.setProperty('--app-height', `${vh}px`);
}
fixVH();
window.addEventListener('resize', fixVH);
window.addEventListener('orientationchange', () => setTimeout(fixVH, 100));

/* ── Init ─────────────────────────────────────────────────── */
loadDocs();

// Reload docs when tab gets focus
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && state.view === 'list') loadDocs();
});

// Hide mobile topbar elements if sidebar search is visible (on resize)
if (!isMobile()) {
  $('#mobile-topbar').style.display = 'none';
}

console.log('⚡ Vault loaded');
