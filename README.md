# Ride the Monsoon

An offline browser game for a Grade 10 Networks of Exchange project. The single playable mode is Level 5: The Monsoon Voyage, a full-length Kilwa–Calicut–Kilwa survival crossing designed for about 15 minutes. Sail by the monsoon, manage resources and return cargo, make eight historically grounded choices, and respond to disasters and pirate encounters.

## Run it

Open `index.html` in a modern browser. No server, login, dependency installation, or internet connection is required.

## Publish it with GitHub Pages

This is a static website and does not need a build step.

1. Sign in to GitHub and create a **public** repository.
2. Upload the project files and folders to the repository, keeping `index.html` at the repository root, and commit them to the `main` branch.
3. In the repository, open **Settings → Pages** and set the deployment source to **GitHub Actions**.
4. Open **Actions** and wait for the **Deploy to GitHub Pages** workflow to finish.
5. Find the public website URL under **Settings → Pages** or in the workflow's deployment details.

The workflow in `.github/workflows/pages.yml` publishes the site after every push to `main`. The source repository must be public for anyone to see its code; GitHub Pages availability for private repositories depends on your GitHub plan.

## Controls

- `A` / `D` or arrow keys: steer
- `W` / `S`: adjust sail deployment
- `Space`: brace during rough conditions
- `M`: toggle route chart
- `P`: pause

The game includes three voyage endings, a decision log, disaster-specific three-choice events, a 28-second collision-based pirate chase, a Calicut sale-and-repurchase market, reflection prompts, and Teacher / Presentation Mode.
