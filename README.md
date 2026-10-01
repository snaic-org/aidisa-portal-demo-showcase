# AIDISA Portal - GitHub Pages Demo

A standalone, fully static, public showcase of the AIDISA Portal concept,
hosted on GitHub Pages.

**This repository is intentionally separate from the real AIDISA codebase**
(which lives in a private repository) and shares no code or git history with
it. It is plain HTML/CSS/JavaScript with no framework, no dependencies, and
no build step.

## What this is

**A demo only.** All data is synthetic, generated locally in the browser
with simple rules-based logic, and stored in `localStorage`. No real/live
data is ever fetched from IFS, an API, or any external system. It shows the
same offline-demo ideas as the real system's offline demo mode (feedback
trend chart, event surge tracker with a wide public-commute-incident keyword
vocabulary, generate-now with an "advance by" time offset, live
auto-generation, and a simple case assignment / workload view) rebuilt as a
single static page.

## Run locally

Open `index.html` directly in a browser, or serve the folder with any
static file server, e.g.:

```powershell
python -m http.server 4173
```

Then open http://localhost:4173.

## Deploy to GitHub Pages

1. In this repo's GitHub settings: **Settings &rarr; Pages &rarr; Source &rarr;
   GitHub Actions** (one-time setup).
2. Push a change to `main` (or run the **Deploy GitHub Pages demo** workflow
   manually from the Actions tab).
3. The workflow at `.github/workflows/gh-pages-demo.yml` publishes the repo
   root as-is - no build step is needed.

## Files

- `index.html` - page structure and layout
- `styles.css` - styling (no external CSS framework)
- `app.js` - demo data store (localStorage), classifier, chart rendering,
  and event handlers
