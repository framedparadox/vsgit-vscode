# VsGit website

The static marketing site for VsGit — plain HTML, CSS and JavaScript with no
build step.

```
website/
  index.html        the page
  styles.css        all styles
  main.js           progressive enhancements (scroll effects, tabs, lightbox)
  assets/
    icon.svg/.png   brand icon (copied from resources/)
    screens/*.png   screenshots (copied from docs/images/)
```

## Preview locally

```bash
cd website
python3 -m http.server 8080   # or: npx serve .
```

Then open <http://localhost:8080>.

## Deploy

`.github/workflows/pages.yml` publishes this folder to GitHub Pages whenever
`website/**` changes on `main` (or when run manually). Enable it once under
**Settings → Pages → Source: GitHub Actions**. The site will be served at
<https://framedparadox.github.io/vsgit-vscode/>.

The folder is excluded from the `.vsix` via `.vscodeignore`.

## Updating screenshots

When a screenshot in `docs/images/` is recaptured, copy the new file over the
matching one in `assets/screens/`. Update the version in the Tech specs section
and the JSON-LD block in `index.html` on each release.
