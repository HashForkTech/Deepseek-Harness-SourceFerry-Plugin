# Validation

Version 1.2.0 replaces snapshot restoration with selective uninstall. Both old and new installations can be removed using the current package.

Automated preservation tests cover plugins and settings added after installation, shared plugin marketplaces, native preferences edited by the user, read-only preview, repeated removal, malformed configuration, and rejection of force/full-restore options. Installation rollback remains limited to the installation operation.

Private gateway credentials are excluded from source and distributable packages. Shared runtimes, CLIs, package-manager dependencies and historical backups are intentionally retained. Uninstall does not restore old configuration files, contact the gateway, or reinstall dependencies.

The ZIP includes a pinned configuration parser with its license; extracted uninstall works without npm installation. See README.md for commands and the treatment of unknown legacy native preferences.
