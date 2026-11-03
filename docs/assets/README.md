# README demo

`tails-demo.gif` shows the report from the sample specs in `cli/examples/feature-flags`.
The sample contains a scope conflict and a requirement with no design or test case.
All project names, links, commits, and pull request states in the demo are sample data.

The capture uses the real indexer, checks, pages, filters, and document reader.
Each frame pauses so the viewer can read the page. The caption describes the action.

## Rebuild the GIF

Build the CLI from `cli/`:

```sh
npm ci
npm run build
```

Install Playwright and its Chromium browser in a separate tools folder.
Install Pillow in a Python environment. These tools are only needed to make the GIF.

From `cli/`, capture the pages into a new output folder:

```sh
node scripts/demo.mjs /path/to/capture /path/to/playwright/index.mjs
python scripts/demo-gif.py /path/to/capture ../docs/assets/tails-demo.gif
```

To render the sample report without screenshots, omit the Playwright path.
