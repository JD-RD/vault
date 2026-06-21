const express = require('express');
const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');
const matter = require('gray-matter');
const { marked } = require('marked');

// Disable raw HTML in markdown to prevent XSS
marked.use({
  breaks: true,
  gfm: true,
  renderer: {
    html: ({ text }) => '', // strip raw HTML tags
  },
});

const Fuse = require('fuse.js');

const configPath = path.join(__dirname, 'config.json');
let config;
try {
  config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
} catch (e) {
  console.error(`[vault] Missing config.json! Copy config.example.json to config.json and edit it.`);
  console.error(`[vault]   cp config.example.json config.json`);
  process.exit(1);
}
const DATA_FILE = path.join(__dirname, '.vault-index.json');
const PORT = config.port || 5002;

// ── Tag extraction ────────────────────────────────────────
function extractTags(data, raw) {
  // 1. Already an array from YAML
  if (Array.isArray(data.tags) && data.tags.length > 0) {
    return data.tags.map(t => String(t).replace(/^#/, '').trim()).filter(Boolean);
  }
  // 2. String from frontmatter (comma or space separated, possibly with #)
  if (typeof data.tags === 'string' && data.tags.trim()) {
    return data.tags.split(/[, ]+/).map(t => t.replace(/^#/, '').trim()).filter(Boolean);
  }
  // 3. Case-insensitive: Tags:, tags:, keyword:, KeyWords: etc.
  for (const key of Object.keys(data)) {
    if (key.toLowerCase() === 'tags' && key !== 'tags') {
      const val = data[key];
      if (Array.isArray(val)) return val.map(t => String(t).replace(/^#/, '').trim()).filter(Boolean);
      if (typeof val === 'string' && val.trim()) return val.split(/[, ]+/).map(t => t.replace(/^#/, '').trim()).filter(Boolean);
    }
  }
  // 4. Scan body for #hashtags
  const body = raw.replace(/```[\s\S]*?```/g, ''); // skip code blocks
  const hashtags = body.match(/(?<!\w)#([a-zA-ZÀ-ÿ0-9_-]{2,})/g);
  if (hashtags) {
    const tags = [...new Set(hashtags.map(t => t.slice(1).toLowerCase()))];
    // Filter out markdown heading markers and common false positives
    return tags.filter(t => !/^\d+$/.test(t) && !['nbsp', '39'].includes(t));
  }
  return [];
}

// ── Data store ──────────────────────────────────────────────
let docs = [];
let fuse = null;
let watcher = null;

function buildIndex() {
  const all = [];
  config.directories.forEach(dir => {
    if (!fs.existsSync(dir)) {
      console.warn(`[vault] Directory not found, skipping: ${dir}`);
      return;
    }
    const walk = (p) => {
      let entries;
      try { entries = fs.readdirSync(p, { withFileTypes: true }); } catch { return; }
      entries.forEach(e => {
        const full = path.join(p, e.name);
        if (e.isDirectory()) {
          const base = path.basename(full);
          if (base.startsWith('.') || base === 'node_modules' || base === '.git') return;
          walk(full);
        } else if (e.isFile() && e.name.endsWith('.md')) {
          try {
            const raw = fs.readFileSync(full, 'utf-8');
            const parsed = matter(raw);
            const rel = path.relative(dir, full);
            // Find which configured dir this belongs to
            const rootDir = config.directories.find(d => full.startsWith(d));
            all.push({
              title: parsed.data.title || path.basename(e.name, '.md'),
              tags: extractTags(parsed.data, raw),
              created: parsed.data.date || null,
              modified: parsed.data.updated || null,
              excerpt: raw.slice(0, 250).replace(/#{1,6}\s/g, '').replace(/[*`~]/g, '').trim(),
              path: full,
              relativePath: rel,
              dir: rootDir || dir,
              size: raw.length,
              body: raw,
            });
          } catch (err) {
            console.warn(`[vault] Skipping unreadable: ${full} — ${err.message}`);
          }
        }
      });
    };
    walk(dir);
  });

  docs = all;
  fuse = new Fuse(docs, {
    keys: ['title', 'tags', 'excerpt', 'body'],
    threshold: 0.4,
    includeScore: true,
  });

  // Persist lightweight index (no body) for fast restart
  const index = docs.map(d => ({ ...d, body: undefined }));
  fs.writeFileSync(DATA_FILE, JSON.stringify(index, null, 2), 'utf-8');
  console.log(`[vault] Indexed ${docs.length} docs from ${config.directories.length} directories`);
}

function startWatcher() {
  if (watcher) watcher.close();
  const dirs = config.directories.filter(d => fs.existsSync(d));
  if (dirs.length === 0) return;
  watcher = chokidar.watch(dirs, {
    ignored: (path) => path.includes('node_modules') || /(^|[\/\\])\../.test(path), // dotfiles + node_modules
    persistent: true,
    ignoreInitial: true,
    depth: 20,
    followSymlinks: false,
  });
  const reindex = () => {
    try { buildIndex(); } catch (e) { console.error('[vault] Reindex error:', e.message); }
  };
  watcher.on('add', reindex);
  watcher.on('change', reindex);
  watcher.on('unlink', reindex);
}

// ── Express app ─────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: '500kb' }));

// Security headers (CSP)
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self' https://cdn.jsdelivr.net; " +
    "style-src 'self' https://fonts.googleapis.com; " +
    "font-src https://fonts.gstatic.com; " +
    "img-src 'self' data: file:; " +
    "connect-src 'self'; " +
    "form-action 'none'; " +
    "frame-ancestors 'none'"
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// API: list all docs (lightweight, no body)
app.get('/api/docs', (req, res) => {
  res.json(docs.map(d => ({ ...d, body: undefined })));
});

// API: search
app.get('/api/search', (req, res) => {
  const q = (req.query.q || '').trim();
  const tag = (req.query.tag || '').trim();
  const dir = (req.query.dir || '').trim();

  let results = q ? fuse.search(q).map(r => r.item) : [...docs];

  if (tag) {
    results = results.filter(d => d.tags && d.tags.includes(tag));
  }
  if (dir) {
    results = results.filter(d => d.dir === dir);
  }

  res.json(results.map(d => ({ ...d, body: undefined })));
});

// API: get single doc with body
app.get('/api/docs/:id', (req, res) => {
  const encoded = decodeURIComponent(req.params.id);
  const doc = docs.find(d => d.path === encoded);
  if (!doc) return res.status(404).json({ error: 'Not found' });
  res.json({ ...doc, html: marked(doc.body) });
});

// API: save doc
app.put('/api/docs/:id', (req, res) => {
  const encoded = decodeURIComponent(req.params.id);
  const doc = docs.find(d => d.path === encoded);
  if (!doc) return res.status(404).json({ error: 'Not found' });

  const { body, encoding } = req.body;
  if (body === undefined) return res.status(400).json({ error: 'body required' });

  // Validate path is within a configured directory
  const allowed = config.directories.some(dir => doc.path.startsWith(dir));
  if (!allowed) return res.status(403).json({ error: 'Path not allowed' });

  try {
    // If user wants frontmatter preserved, re-parse + merge
    if (encoding === 'full') {
      fs.writeFileSync(doc.path, body, 'utf-8');
    } else {
      // Default: body only, preserve frontmatter
      const existing = fs.readFileSync(doc.path, 'utf-8');
      const parsed = matter(existing);
      const newContent = matter.stringify(body.trim(), parsed.data);
      fs.writeFileSync(doc.path, newContent, 'utf-8');
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: list directories in use
app.get('/api/dirs', (req, res) => {
  const available = config.directories.filter(d => fs.existsSync(d));
  const stats = available.map(d => ({
    path: d,
    name: path.basename(d),
    count: docs.filter(doc => doc.dir === d).length,
  }));
  res.json(stats);
});

// API: tags summary
app.get('/api/tags', (req, res) => {
  const tagMap = {};
  docs.forEach(d => {
    (d.tags || []).forEach(t => {
      tagMap[t] = (tagMap[t] || 0) + 1;
    });
  });
  const tags = Object.entries(tagMap).map(([name, count]) => ({ name, count }));
  tags.sort((a, b) => b.count - a.count);
  res.json(tags);
});

// ── Start ───────────────────────────────────────────────────
buildIndex();
startWatcher();

app.listen(PORT, () => {
  console.log(`[vault] Running at http://localhost:${PORT}`);
});
