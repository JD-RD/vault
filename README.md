# Vault ◈

Navigate, search, read and edit your markdown files from any device on your LAN.

A lightweight self-hosted research vault — point it at your markdown folders, browse by tags, search full-text, and edit inline with live preview.

## Features

- **Full-text search** across all your `.md` files
- **Tag navigation** from YAML frontmatter and `#hashtags` in body
- **Browse** by folder, filter by tags
- **Read** rendered markdown (dark theme, mobile-friendly)
- **Edit** with markdown toolbar, live preview toggle
- **Auto-index** — watches your folders for changes
- **No database** — files are the source of truth

## Quick start

```bash
git clone https://github.com/JD-RD/vault.git
cd vault
npm install
cp config.example.json config.json
# edit config.json with your directories
npm start
```

Then open **http://localhost:5002**

## Configuration

Edit `config.json`:

```json
{
  "port": 5002,
  "directories": [
    "/home/user/notes",
    "/home/user/projects"
  ]
}
```

## Security

- CSP headers restrict scripts and inline content
- Raw HTML is stripped from rendered markdown (XSS protection)
- Write operations validate the target path is within configured directories
- `config.json` is gitignored — your paths stay local

## Tech

Node.js, Express, [marked](https://marked.js.org/), [Fuse.js](https://fusejs.io/), [gray-matter](https://github.com/jonschlinkert/gray-matter), [chokidar](https://github.com/paulmillr/chokidar).
