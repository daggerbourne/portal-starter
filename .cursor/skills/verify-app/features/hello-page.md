# Hello page

The hello page is the public Portal Starter page at `/portal-starter/`. It shows the heading Hello and loads `tokens.css`.

## Sub-features

- `hello-open` shows the title Portal Starter and the heading Hello.
- `hello-tokens` loads `tokens.css` from the same `/portal-starter/` path. The stylesheet defines `--bg-deep`.

## How to get to it (user POV)

- Open `https://main--portal-starter.netlify.app/portal-starter/`.
- Open `https://deploy-preview-<pr>--portal-starter.netlify.app/portal-starter/` when Netlify built that pull request.

## Driving it with verify-app

Preconditions:

- `node .cursor/skills/verify-app/run.mjs patterns` exits `0`.
- `google-chrome` is on `PATH`.
- Doctor on the same target prints kind `app`.

- **Open the page.** Run `node .cursor/skills/verify-app/run.mjs run --target main`. The command prints `live` with status `200` and kind `app`, then `hello title Portal Starter heading Hello stylesheet tokens.css`.
- **Stylesheet.** The same command fetches `tokens.css`. The result line includes `tokens 200`. The file is `text/css` and contains `--bg-deep`.
- **Proof.** After cleanup the command prints `evidence kept` and a size above `1000`. Open that PNG. It shows Hello on a dark page. `doctor.txt` in the same directory repeats the doctor lines.

## Gotchas

- The app path is `/portal-starter/`. The host root is not the page.
- `run` drives the hello page only.
- A Markdown-only pull request does not get a Netlify build. Use main's branch deploy, or a preview from a pull request Netlify built.
- If the command prints `Netlify login page. Stop.`, do not type a password.
- Chrome stays up after it writes a screenshot. The script kills the Chrome process it started. Cleanup kills a process only when `/proc/<pid>/cmdline` contains that run's profile directory.
- Each run id has its own directory under `/tmp/verify-app/`.
