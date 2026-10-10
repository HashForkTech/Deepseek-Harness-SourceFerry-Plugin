# V1.0 validation

The automated suite covers gateway responses, credentials, installation, and selective uninstall. The suite includes real Harness schema compilation, composed-profile checks, and search/fetch tool dispatch.

Preservation checks cover plugins and settings added after installation, user-edited native preferences, preview mode, repeated removal, malformed configuration, and rejection of unsupported uninstall options. Uninstall changes only SourceFerry entries and files. Installation failure recovery is limited to the installation operation.

Private gateway credentials are excluded from source and packages. Shared runtimes, CLIs, dependency stores and installation backups remain available after uninstall. Extracted-package uninstall was checked in an isolated home with no gateway connection or dependency installation.

These checks validate integration and preservation behavior; they do not guarantee upstream search-result availability. See [README.md](README.md) for installation, verification and uninstall commands.
