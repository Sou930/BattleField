# BattleField

A browser-based multiplayer battle game built with React, TypeScript, Vite, Three.js and PeerJS.

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

Deployment is automated via GitHub Actions. Every push to the `main` branch
builds the project and publishes `dist/` to GitHub Pages.

### One-time setup

1. Copy the workflow template into place (it cannot be pushed automatically
   without the `workflows` token permission):

   ```bash
   mkdir -p .github/workflows
   cp docs/github-pages/deploy.yml.txt .github/workflows/deploy.yml
   git add .github/workflows/deploy.yml
   git commit -m "ci: add GitHub Pages deploy workflow"
   git push
   ```

2. In the GitHub repository, go to **Settings → Pages**.
3. Under **Build and deployment → Source**, select **GitHub Actions**.
4. (Optional) The custom domain is configured via `public/CNAME`
   (`battle-field.duckdns.org`). Ensure the matching DNS record points to
   GitHub Pages.

After the first successful run the site will be available at the configured
custom domain (or `https://<user>.github.io/<repo>/` if no custom domain is set).
