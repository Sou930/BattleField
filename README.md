# BattleField

A browser-based single-player battle game built with React, TypeScript, Vite and Three.js.

## Development

```bash
npm install
npm run dev
```

The dev server runs at http://localhost:8080.

## Build

```bash
npm run build
```

The static site is generated into the `dist/` directory. A `404.html` copy of
`index.html` is created automatically for SPA fallback.

## Deployment (GitHub Pages)

> **Important:** GitHub Pages can only serve **built static files**, not the
> raw source. If Pages is set to *Deploy from a branch* and serves the source
> `index.html` (which references `/src/main.tsx`), the browser will fail with:
>
> ```
> Failed to load module script: Expected a JavaScript-or-Wasm module script
> but the server responded with a MIME type of "application/octet-stream".
> ```
>
> The fix is to build the project with Vite and publish the `dist/` output.
> This repository does that automatically via GitHub Actions.

Deployment is automated via GitHub Actions
(`.github/workflows/deploy.yml`). Every push to the `main` branch builds the
project (`npm run build`) and publishes the generated `dist/` directory to
GitHub Pages.

### One-time setup

1. Copy the workflow template into place. (The workflow file itself cannot be
   pushed automatically without the `workflows` token permission, so it lives
   as a template under `docs/`.)

   ```bash
   mkdir -p .github/workflows
   cp docs/github-pages/deploy.yml.txt .github/workflows/deploy.yml
   git add .github/workflows/deploy.yml
   git commit -m "ci: add GitHub Pages deploy workflow"
   git push
   ```

2. In the GitHub repository, go to **Settings → Pages**.
3. Under **Build and deployment → Source**, select **GitHub Actions**
   (NOT "Deploy from a branch").
4. Push to `main` (or run the workflow manually via the **Actions** tab) to
   trigger the first deployment.
5. The custom domain is configured via `public/CNAME`
   (`battle-field.duckdns.org`) and is copied into `dist/` on every build.
   Ensure the matching DNS record points to GitHub Pages.

After the first successful run the site is available at the configured custom
domain.

### Serving from a project page (no custom domain)

If you instead serve the site from `https://<user>.github.io/<repo>/`, the
asset URLs must be prefixed with the repository name. Build with the
`VITE_BASE` environment variable set to your repo path:

```bash
VITE_BASE="/BattleField/" npm run build
```

(When using the custom domain / CNAME, leave `VITE_BASE` unset — it defaults
to `/`.)

### Notes

- `.nojekyll` is emitted into `dist/` so GitHub Pages does not run files
  through Jekyll.
- `404.html` is a copy of `index.html` for SPA client-side routing fallback.
