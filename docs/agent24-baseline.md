# OpenDesign Agent24 integration baseline

Baseline captured from `open-design-v0.22.2` at commit
`73953213a6fec2c8092e8e77d229a3074aa828a9` on
`integration/agent24-open-design-v0.22.2`.

Environment:

- macOS arm64
- Node `v24.21.0`
- Corepack `0.36.0`
- pnpm `10.33.2` (from `package.json`)

## Commands

| Command | Result | Duration |
| --- | --- | ---: |
| `pnpm install --frozen-lockfile` | PASS; 1131 packages installed | 110.13s |
| `pnpm --filter @open-design/daemon build` | PASS | 18.69s |
| `pnpm typecheck` | PASS | 73.30s |
| `pnpm guard` | PASS | 13.36s |
| `pnpm --filter @open-design/daemon test -- --runInBand` | INCOMPLETE baseline; interrupted after 195.05s | 195.05s |

The daemon test run reached `tests/connection-test.test.ts` with 160 tests and
reported one failure:

```text
launches OpenCode connection tests with 1.3-compatible JSON stdin args
[test:agent] OpenCode → outdated_cli: exit 1 · stderr: incompatible opencode args
```

The process produced no further progress for the bounded observation window and
was interrupted with SIGINT. This is retained as an upstream baseline result,
not attributed to Agent24 integration changes.

## Headless daemon smoke

Started the daemon through the documented lifecycle entry point with an isolated
runtime root:

```bash
OD_DATA_DIR=/tmp/open-design-agent24-baseline-data \
  pnpm tools-dev start daemon \
  --namespace agent24-baseline \
  --tools-dev-root /tmp/open-design-agent24-baseline-tools \
  --no-env-file --daemon-port 17654 --json
```

The daemon reported `state: running` at `http://127.0.0.1:17654`.

Health check:

```bash
curl --fail --silent --show-error \
  -D - http://127.0.0.1:17654/api/health \
  -o /tmp/open-design-agent24-baseline-health.json
```

Result: HTTP `200`, body began with `{"ok":true,"version":"0.22.1"`.
The daemon was stopped successfully with `pnpm tools-dev stop daemon` using the
same namespace and tools-dev root.

No product code or upstream functionality was changed in this baseline commit.
