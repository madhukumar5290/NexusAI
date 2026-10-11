# Jarwis Project Structure

Use this as a map before editing files. The app is an existing local-first
Node.js project; it is not split into a separate Python backend and Next.js
frontend.

## Main folders

| Location | What it contains |
|---|---|
| `public/` | The browser and desktop interface: HTML, CSS, JavaScript, install manifest, icon, and offline service worker. |
| `src/server.js` | The Express server and most HTTP API routes. |
| `src/agent/` | Agent loops, task planning, workspace tools, research, and other specialist capabilities. |
| `src/memory/`, `src/rag/` | Local memories and document search/indexing. |
| `src/routes/` | Additional API route modules. |
| `lib/providers/` | Provider-neutral chat interface and Ollama, OpenAI-compatible, Anthropic, and Google transports. Named compatible providers reuse the OpenAI-compatible transport. |
| `lib/models/` | Model catalogue, runtime health checks, hardware estimates, selection, and fallback policy. |
| `lib/agents/`, `lib/integrations/`, `lib/workflows/` | Registries for specialist agents, external connectors, and workflows. |
| `lib/security/` | Local authentication, permission checks, and security audit records. |
| `electron/` | Windows desktop application shell and local server startup. |
| `tests/` | Automated tests. Run `npm.cmd test` or `npm.cmd run verify`. |
| `scripts/` | Verification, UI smoke, browser, and build-support scripts referenced by `package.json`. |
| `docs/` | Beginner setup and project-map guides. |
| `data/`, `workspaces/`, `workspace/`, `nexus.db` | Local runtime data and generated files. Back these up before cleanup. |
| `release/` | Desktop installer build output. Rebuild with `npm.cmd run desktop:build`. |

## Root configuration files

- `package.json` and `package-lock.json` define the app, dependencies, tests,
  and build commands. Keep their dependency changes in sync with `npm.cmd
  install`.
- `.env.example` documents supported provider settings. `.env` contains
  private local secrets; never commit or share it.
- `Dockerfile`, `docker-compose.yml`, and `render.yaml` describe optional
  container or hosted deployments; you do not need them for the local desktop
  app.
- `README.md` is the main setup and capability guide.

## Files to review before deleting

This working folder also contains local development leftovers:
`public/*.orig` source snapshots, `tests/server.js.phase2-backup`, root-level
logs and `post-*.out` files, `preview-*.png` screenshots, and scratch/debug
scripts such as `scripts/_*.mjs`, `scripts/diag1.mjs`, and the settings audit
scripts. They are not part of normal app startup. The installer explicitly
excludes `public/*.orig`; tests and scratch scripts are also excluded by the
package file list. These files have been left in place so a potentially useful
backup, screenshot, or debugging result is not silently lost. Review and
remove only the specific files you no longer need.

Similarly named code is not always a duplicate: the top-level `server.js` is
a small compatibility launcher, while `src/server.js` is the actual server
used by `npm.cmd start`. Do not move application source folders casually:
their relative imports, tests, Electron packaging rules, and scripts depend
on the current paths.
