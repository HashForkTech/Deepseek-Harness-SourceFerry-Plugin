# Validation

Validated locally on Windows with Node.js `24.20.0`, npm `12.1.0`, pnpm `11.0.0` and the actual published Harness `0.2.0-rc.2` packages.

## Automated checks

All 15 automated tests pass. The test suite covers:

- SourceFerry bearer authentication, search request shape and bounded normalized results.
- Current nested fetch payloads (`content.markdown`) and the older direct payload.
- Invalid inputs, empty/unsuccessful crawls, HTTP and network failures, redacted errors, cancellation and request deadlines.
- Real Harness tool-schema compilation and canonical output validation.
- Actual HTTP dispatch by both plugins, even when native provider IDs are selected.
- Real Cordis plugin activation and independent disposal of both tools and providers.
- Complete preset preservation, unrelated configuration, YAML comments and `!!js` expressions.
- Real Harness composition of generated profile overrides.
- Installer execution, reinstallation, verification, launcher environment inheritance, private file creation and rollback after a higher-priority profile override defeats native-tool disabling. This test substitutes package-manager and CLI commands while retaining real plugin code, schema compilation, HTTP calls and Harness patch composition.

## Real CLI installation

The complete installer was also run against the actual pinned `dsh` and pnpm executables in an isolated workspace Harness home. It installed permanent plugin dependencies, linked both plugin bundles, disabled all four native web instances in the stock web profile, preserved the complete standard/PTC/Cordis presets, wrote a private credential configuration and launcher, and passed `--verify`.

The installed web profile also announced server readiness without plugin activation warnings. Its HTTP endpoint enforced Harness's browser authentication. Browser-session login and model conversation execution were not exercised in this check.

Initial checks used a local fixture implementing SourceFerry's public contract, verified against [the gateway source](https://github.com/HashForkTech/SourceFerry/blob/main/gateway/app.py).

Live validation then used the user's running SourceFerry gateway and supplied bearer token. Health, authenticated search, Markdown extraction, dispatch through both registered plugins, a full real-CLI installation and subsequent `--verify` all passed. Search returned the official `https://www.deepseek.com/en/harness/` page, and the fetch tool retrieved content from a search result. The URL and token remain runtime configuration and are excluded from the source and ZIP. Model-facing conversation calls were not exercised; the tests dispatched the registered tool definitions directly without an LLM API key.

The supplied CI matrix schedules the tests on Linux, macOS and Windows; local validation was performed on Windows. The managed missing-CLI bootstrap branch uses the same pinned npm package tested locally. SourceFerry and Node.js are prerequisites; the package installs Harness when missing, pnpm when missing, the two plugins and their runtime configuration.

The release ZIP is built from an explicit file allowlist and includes a dependency lockfile and SHA-256 checksum. Runtime credentials, local test profiles, dependencies, research downloads and logs are excluded.
