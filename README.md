# Deepseek Harness SourceFerry Plugin V1.0

Two independently switchable [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugins that send web search and page fetch requests to your [SourceFerry Gateway](https://github.com/HashForkTech/SourceFerry).

| Operation | Model tool | Harness plugin | Provider ID | Gateway endpoint |
| --- | --- | --- | --- | --- |
| Search | `SourceFerry_search` | `local-web-search` | `local-crawl4ai-search` | `POST /search` |
| Fetch | `SourceFerry_fetch` | `local-web-fetch` | `local-crawl4ai-fetch` | `POST /fetch` |

The default installer replaces native `web_search` and `web_fetch` in the selected profile. SourceFerry handles SearXNG discovery and Crawl4AI browser rendering; the Harness computer needs no Docker or Chromium for these plugins.

## Requirements

- Node.js **24 or newer**, with npm, on Linux, macOS or Windows. For WSL, run the Linux installer inside WSL.
- A running SourceFerry gateway, its reachable URL and its existing `LOCAL_WEB_API_TOKEN`. Install the gateway separately using its own installer.
- Internet access to the npm registry for installation and to the gateway for tool calls.
- Harness **`0.2.0-rc.2`**. If `dsh` is absent, the installer installs that version under your Harness home without changing global packages. An existing different version is rejected to avoid an unverified profile migration.

## Install with one command

Download and extract the release ZIP (or clone this private repository with your GitHub credentials), open a terminal in the package directory, and run:

Linux / macOS / WSL:

```bash
bash ./install.sh
```

Windows PowerShell:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

The installer prompts for the gateway URL and existing token. **Token input is hidden.** If SourceFerry runs on a server or VM, enter its reachable LAN address, such as `http://192.168.1.20:8080`; use `localhost` only when the gateway runs on the Harness computer. Installation does not require your DeepSeek model API key; configure Harness's model authentication when you launch it.

The installer:

1. Checks gateway health and authenticated search and fetch responses. Fetch verification uses `https://example.com/` as a neutral control page.
2. Installs pinned plugin dependencies into a permanent directory and prepares pnpm if needed.
3. Installs the pinned Harness CLI if missing and checks its exact version.
4. Validates both plugins using Harness's real schema compiler and executes both tools against the gateway.
5. Backs up profile files, then adds both plugin bundles with `dsh plugin --profile SourceFerry add .`.
6. Disables every native web tool instance by preserving each complete effective preset configuration and changing its search/fetch flags.
7. Checks the composed profile and writes a private configuration, installation report and launch wrapper.

On a profile-update failure, it restores the backed-up profile files and attempts to reconcile dependencies. Reinstallation reuses saved credentials and creates a fresh installation directory and backup. Keep the permanent installation directories: Harness links to them. Fully quit any running Harness instance before installation.

## Start Harness

The installer prints your exact launcher path. For the default home and `SourceFerry` profile:

**Open the browser UI automatically** for normal local use:

```bash
~/.dsh/sourceferry/bin/dsh-SourceFerry
```

```powershell
& "$HOME\.dsh\sourceferry\bin\dsh-SourceFerry.cmd"
```

**Start without opening a browser** for server, SSH or manual browser use:

```bash
~/.dsh/sourceferry/bin/dsh-SourceFerry --no-open
```

```powershell
& "$HOME\.dsh\sourceferry\bin\dsh-SourceFerry.cmd" --no-open
```

With `--no-open`, Harness still serves the UI and prints its startup URL; open that URL manually. SSH sessions also suppress automatic browser opening. This option affects browser opening only and is optional for SourceFerry. The wrapper forwards it to Harness when supplied.

The wrapper loads credentials before starting `dsh`, pins `DSH_WEB_FETCH_PROVIDER=local-crawl4ai-fetch` and clears `DSH_WEB_SEARCH_PROVIDER` in the child process. Both custom tools dispatch directly to their SourceFerry providers, independently of native provider selection. Launch through the wrapper after installation, and open a **new conversation** after changing plugins.

## Options

```bash
bash ./install.sh --profile SourceFerry --gateway-url http://192.168.1.20:8080
bash ./install.sh --keep-native
bash ./install.sh --verify
bash ./install.sh --help
```

```powershell
.\install.ps1 -Profile SourceFerry -GatewayUrl http://192.168.1.20:8080
.\install.ps1 -KeepNative
.\install.ps1 -Verify
.\install.ps1 -Help
```

`--keep-native` leaves the current native-tool configuration intact; it does not re-enable previously disabled tools. Custom profiles must provide the `tools` and `web` services. The installer creates the default `SourceFerry` profile from Harness's shipped `web` template when it is missing. Your existing `web` profile is preserved. For `desktop`, initialize the application once and fully quit it before installation; use its matching CLI and the generated launcher.

For unattended installation, set `LOCAL_WEB_GATEWAY_URL` and `LOCAL_WEB_API_TOKEN` in the environment before invoking the same command. Use your environment's secret store or a private shell prompt for the token. Do not place it in command arguments, Git files, screenshots or logs. `LOCAL_WEB_TIMEOUT_MS` optionally overrides the default 600,000 ms request timeout.

## Use the tools

```text
Use only SourceFerry_search to search for DeepSeek Harness official site.
Return the top 3 results with titles, URLs and snippets.
```

```text
Use only SourceFerry_fetch to fetch https://www.deepseek.com/harness/.
Return the page title and first main heading.
```

Search arguments are `queries` (1–4 strings) and optional `max_results` (1–20, default 8). Fetch takes `url`. Search results retain source titles, URLs and snippets. Fetch normalizes SourceFerry's `content.markdown` to Harness's text-body schema and also supports the older direct Crawl4AI payload. It uses a supplied origin `status_code` when available and otherwise reports 200 for a successful crawl. Web content is explicitly marked as untrusted data. Errors, cancellation and timeouts never trigger a fallback to another web backend.

Enable or disable each plugin independently in Harness's plugin manager. The two `cordis.patch.yml` bundle rows retain the exact identities from the provided installation notes.

## Configuration, verification and rollback

`DSH_HOME` is respected; the default is `~/.dsh`. Under that home:

```text
sourceferry/
  bin/                              launch wrappers
  profiles/SourceFerry/config.json          private gateway credentials and CLI paths
  profiles/SourceFerry/effective-config.yml  effective profile after installation
  profiles/SourceFerry/installation-report.json
  installations/                    permanent plugin runtime copies
  harness/                          managed CLI, when dsh was missing
  tooling/                          managed pnpm, when it was missing
  backups/                          original profile files and snapshot manifest
```

Credential files use mode 600 on Unix. On Windows, the installer removes inherited access and grants the current user, SYSTEM and administrators access; use a local filesystem that supports Windows ACLs. It never changes shell startup files or stores credentials in the repository. `--verify` reruns gateway checks, real plugin dispatch and effective-profile checks without reinstalling.

Installation backups support rollback of a failed installation. Uninstall never restores them into the active profile; use the selective script below.

If installation reports a remaining native web tool, inspect `$DSH_HOME/cordis.patch.yml`: that home-level layer overrides profile patches. The installer fails and restores profile files instead of overwriting that shared layer. Dynamic native web configurations also require manual review or `--keep-native`.

## Uninstall

Stop Harness, open the extracted package directory, and run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\uninstall.ps1
```

```bash
bash ./uninstall.sh
```

DSH_HOME must select the home used for installation. For another profile, use `-Profile name` / `--profile name`. `-DryRun` / `--dry-run` previews removal without writing files.

**Selective removal is the only uninstall mode.** The script edits the current configuration and removes only SourceFerry registrations, its private gateway configuration, reports, launcher and its two profile dependency registrations and links. Other plugins, profiles, settings, files and dependencies remain in place, including additions made after installation or a reinstall. The profile directory, other lockfile entries and package-manager dependency store remain in place.

Installer changes to native web preferences are undone field by field only where the current value still equals the value written by SourceFerry. Subsequent user changes and newly created profiles are preserved. If ownership cannot be established, the preference is left unchanged.

Managed CLIs, shared runtime/dependency directories and private installation backups are retained: another plugin or launcher may now use them. Removed SourceFerry files are moved to a private recovery directory under `sourceferry/uninstall-recovery`; only the changes made by the current uninstall are rolled back if it fails. Backups are never applied to the user environment during uninstall. Running uninstall again is harmless.

## Development and package

```bash
npm ci --ignore-scripts
npm test
npm run package
```

The package command creates `dist/deepseek-harness-sourceferry-plugin-1.0.0.zip` and its SHA-256 checksum. It includes installer scripts, both plugins, shared code, the dependency lockfile and documentation; it excludes credentials, dependencies, research downloads and test artifacts. The ZIP requires npm registry access on first installation. GitHub Actions tests Node 24 on Linux, macOS and Windows, checks real Harness composition and builds a downloadable package artifact.

See [VALIDATION.md](VALIDATION.md) for what has been tested and the limits of those checks.

## Credits and license

Original plugin and installer code: [MIT](LICENSE), HashForkTech. DeepSeek Harness and Cordis are developed by DeepSeek AI and retain their upstream licenses. SourceFerry, SearXNG and Crawl4AI run separately on the gateway; this package does not redistribute their server binaries. The supplied `plugin_install.md` was used as technical reference; its machine-specific migration commands were not executed on this computer.

See [RELEASE_NOTES.md](RELEASE_NOTES.md) for the V1.0 release details.
