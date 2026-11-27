# Fortuna Desktop

On macOS 26 or later, extract the ARM64 ZIP, move `Fortuna.app` to Applications, and open it. On Windows 11 x64, run the per-user installer or extract the entire portable ZIP to a writable folder and open `Fortuna.exe`. Each distribution includes Electron, the React UI, Python, and the backend dependencies. Built-in mode works offline from the first launch.

## Workspaces and backups

Choose a workspace on the **Server** page, available from the workspace and login screens.

| Selection | Account and storage |
| --- | --- |
| Built-in | Opens the default database automatically as its persistent local account. |
| Database file | Open an existing Fortuna SQLite file or create a new one. Register or sign in to an account in that file. Each account sees its own records. |
| Remote server | Test a server address and sign in to that server. Remote sessions are saved by address. |

Fortuna remembers the active mode, remote URL and last selected file in `connection.json` in the Electron profile. Switching files starts a fresh embedded server with its own sessions. The previous workspace stays active until the new file opens successfully. Reopening a file after a restart or switch requires signing in again. If the file moved, use **Open database…** to locate it. Switching does not copy records between workspaces.

**Open database…** uses a populated Fortuna database in place. Desktop startup validates the existing schema and reports an error if required columns are missing or the database version is newer. **Create database…** requires a new filename and uses the standard Fortuna schema.

In the built-in workspace, use **Settings → Local database → Show database location** to select the live file in Finder or Explorer. **Export database backup…** takes a consistent snapshot through SQLite's Online Backup API while the app is open. Choose a new `.sqlite3` filename. A backup includes the local account, settings and reports. Treat it as private financial data. Opening such a backup as a separate database file requires an ordinary account. To recover the built-in identity and its reports, restore the backup to the built-in location.

| Distribution | Live database |
| --- | --- |
| Installed Windows | `%APPDATA%\Fortuna\data\fortuna.sqlite3` |
| macOS | `~/Library/Application Support/Fortuna/data/fortuna.sqlite3` |
| Windows portable | `data\fortuna.sqlite3` beside `Fortuna.exe` |
| Development shell | `user-data/desktop/data/fortuna.sqlite3` in the repository |

Installed updates replace the application files. The next launch checks that the existing database is compatible. When updating a portable copy, quit Fortuna and keep the entire `data` directory beside the new executable. It holds both the database and the portable Electron profile. Windows and macOS may also keep normal execution history and caches.

To restore, quit Fortuna, preserve the current data directory under a different name, and place a copy of the exported backup at the live database path in a clean data directory. Keep the old directory until you have verified the restored reports. Copying an open SQLite file can omit pending journal or WAL changes.

## Build on the target platform

Use native ARM64 Python on macOS and native x64 Python on Windows. Python 3.14+, Node 24+ and Vite+ (`vp`) are build tools. Vite+ installs the locked dependencies using the project's pinned pnpm version. PyInstaller 6.22.3 builds an onedir backend. The spec includes the SQL and configuration schemas, JSON Schema registries and Argon2 bindings. Each platform packages its own interpreter and native libraries.

From the repository root, create the build environment once. On macOS:

```sh
python3.14 -m venv venv
venv/bin/python -m pip install -r electron/requirements-build.txt
```

On Windows in PowerShell:

```powershell
py -3.14 -m venv venv
.\venv\Scripts\python.exe -m pip install -r electron/requirements-build.txt
```

With Make available, use these targets from the repository root. Set `PYTHON` to your virtual environment's interpreter if it differs from `venv/bin/python`.

```sh
make desktop-install    # Install Python, web and Electron dependencies
make desktop            # Launch the development app and watch for changes
make desktop-test       # Build and test the backend, shell and database controls
make desktop-build      # Package for this platform
make desktop-release    # Require release signing
make clean              # Clear generated desktop runtime, renderer and backend build cache
```

You can also run the build directly on either platform. Activate the virtual environment before running these commands.

```sh
vp -C web install --frozen-lockfile
vp -C electron install --frozen-lockfile
python electron/build.py --dev
```

In watch mode, changes to the web UI rebuild the renderer and reload the window. Changes in `electron/src/` or `shared/` rebuild the Electron runtime and restart the app after a successful build. Quit the app or press Ctrl+C to stop watching. After changing Python backend code, quit and rerun `make desktop` to rebuild the frozen backend.

Desktop builds reuse the frozen backend in `build/backend/` while its source, resources, Python environment and bundle are current. `make clean` removes the desktop build intermediates so the next build starts fresh. Workspaces live under the configured data location and packaged distributions live under `build/desktop/`.

For a one-off launch without watching, run `python electron/build.py --prepare` and `vp -C electron run start`. The shell loads bundled assets through `fortuna://workspace` in both development and packaged builds; watched UI output is kept separate from the packaging output.

Native app icons are built from `electron/resources/icon.png`, a 1024×1024 export of `web/src/assets/fortuna-logo.webp`. Update both files when changing the logo. On macOS and Windows, `prepare-icon.mjs` generates `build/electron/desktop-icon.png` with rounded corners and transparent padding, using less padding on Windows so the artwork stays readable at small sizes. The development app uses the PNG directly; electron-builder converts it to `.icns` on macOS or `.ico` on Windows.

```sh
python electron/build.py          # Native development distribution
python electron/build.py --signed # Release distribution with signing credentials
```

The Mac build writes an `.app` and a ZIP under `build/desktop/installed/`. The Windows build writes an NSIS installer there and a ZIP under `build/desktop/portable/`. The ZIP includes a `resources/portable.flag` marker. If the portable folder is read-only, extract it somewhere writable. The app reports the error and keeps the chosen data location.

### Signing and verification

For a Mac release, install a **Developer ID Application** identity in the build keychain, or supply the certificate through electron-builder's `CSC_LINK` and `CSC_KEY_PASSWORD`. Supply `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` through the build environment. The signed target requires an identity, signs the nested Python executable and native code, enables the hardened runtime, and requests notarization. The native `ditto` archive preserves the signed bundle. Development archives are ad-hoc signed. Check a release with `codesign --verify --deep --strict Fortuna.app`, `xcrun stapler validate Fortuna.app`, and Gatekeeper on another Mac.

For Windows signing, configure an Authenticode certificate accepted by electron-builder, for example using `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD` through the release environment. The signed build requires signing and covers bundled executables and native libraries. Verify the installer and extracted executable using `Get-AuthenticodeSignature`. Development CI produces unsigned Windows packages and ad-hoc Mac packages.

```sh
python -m unittest discover -s server/tests
vp -C electron run test
vp -C web run test:desktop-files
python electron/tests/smoke.py build/desktop/installed/mac-arm64/Fortuna.app/Contents/MacOS/Fortuna
```

On Windows, pass the path to the installed `Fortuna.exe` or one in a freshly extracted portable test copy to `smoke.py`. The test creates reports in the test workspace. It starts a temporary ordinary Fortuna server for remote registration and session tests, launches the packaged app with an empty `PATH`, and exercises switching and relaunch. For release acceptance, repeat installation, offline launch, backup and upgrade with a populated workspace on a clean OS account or VM without developer runtimes.

## Runtime and authentication

The browser build and `server/src/main.py` retain normal server configuration and `Fortuna-Auth` sessions. Application environment controls diagnostics. Runtime mode controls authentication. Only the dedicated desktop launcher requests `embedded` mode. It generates a production configuration in memory, validates the absolute database path using the existing schema, and uses Waitress on `127.0.0.1` with an OS-assigned port.

Only the default database signs in automatically. The backend looks up `__fortuna_builtin__` in `user_account` and reuses its existing user ID and settings. If that username is absent, one transaction creates the account and its settings using the standard tables, a UUIDv7 ID and an Argon2id hash of a random discarded password. A user-selected file uses the normal registration, login, account settings and logout handlers.

Electron main generates a fresh 256-bit secret each time it starts Python and sends it through the child's stdin pipe. Python checks the secret on every embedded API call. With a selected file, protected calls additionally require the user's session token. Closing the pipe terminates the backend after a parent crash. The selected file has a sibling `.fortuna.lock` file to prevent competing desktop writers. The desktop file picker and child launcher handle database changes, so there is no HTTP route accepting filesystem paths.

The sandboxed renderer uses a narrow preload API. Main checks the sender and frame URL, selected connection, API method, route and JSON sizes. Remote requests use the configured HTTP(S) address, reject redirects and carry only the corresponding remote session token. Use HTTPS to protect remote credentials in transit. The loopback credential prevents unauthenticated localhost access. A process with control of the same OS user can still read the SQLite file or inspect running processes. The local database and exported backups are ordinary, unencrypted SQLite files.

## Troubleshooting

If a local workspace fails to open, expand **Diagnostics**. Check available storage, directory permissions, and whether another Fortuna instance is using that data directory. Close the other instance and choose **Retry**. **Remote server** remains available during a local failure. For a corrupt database, use a known-good backup. If a remote workspace asks for credentials after a server restart, sign in again to renew the in-memory server session.

The independent web and Flask deployment commands are in the [repository README](../README.md).
