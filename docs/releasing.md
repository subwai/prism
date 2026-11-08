# Releasing

[← Back to the README](../README.md) · [Development](development.md) · [Architecture](architecture.md)

- [Checks](#checks)
- [Making a release](#making-a-release)
- [Release app setup](#release-app-setup)
- [Automatic updates](#automatic-updates)
- [Self-signed macOS test builds](#self-signed-macos-test-builds)
- [Windows signing](#windows-signing)

## Checks

The Checks workflow runs lint, type checking, tests, and formatting on pull requests targeting
`main`. The end-to-end tests run in a job beside the rest, under Xvfb so they have a display.
The Windows imaging addon builds and runs its tests on a Windows runner, restoring the Cargo
dependencies that the release's Windows build saves on `main`. These checks are separate from
release builds.

## Making a release

The release workflow builds macOS (arm64 and x64), Windows (x64 NSIS), and Linux (x64 AppImage)
on native GitHub runners. Two small local actions read the version's release notes and trust the
macOS test certificate. Changesets manages the release PR, and electron-builder uploads the
installers to a draft release that the workflow publishes once every platform is in.

1. Run `pnpm changeset`, select `prism`, and describe the change. Add one to every PR that
   changes what people notice, refactors included when they fix a bug or speed something up;
   without a changeset, merging opens no release PR. Internal process and shared packages stay
   private and do not get separate releases.
2. Merge changes into `main`. Nothing is built for them yet.
3. Changesets maintains a **Release app version** PR containing the final version, changelog,
   consumed changesets, and regenerated lockfile.
4. Merge that PR to build and release its version, such as `0.2.0`.

The workflow builds only when `package.json` holds a version with no published release, so a
rerun of a failed release picks up its draft again and other pushes stop after updating the
release PR. After all platform builds succeed, it uploads installers, blockmaps, and `latest*.yml`
metadata to a draft GitHub release in this repository, then publishes it. Builds never publish
npm packages. Each release's notes are its changelog section, with the pull request and author
that `@changesets/changelog-github` looks up for every changeset.

## Release app setup

The release PR is opened by a GitHub App rather than `GITHUB_TOKEN`, because GitHub doesn't
start workflows for pull requests made with `GITHUB_TOKEN`, so the Checks would wait for
approval. To set it up once:

1. Create a private GitHub App under your account's **Developer settings**, with no webhook and
   the repository permissions **Contents: Read and write** and **Pull requests: Read and
   write**.
2. Install the app on this repository only.
3. Add its client ID as the repository variable `RELEASE_APP_CLIENT_ID`, and a private key
   generated on the app's page as the repository secret `RELEASE_APP_PRIVATE_KEY`.

## Automatic updates

Packaged applications check for updates on startup, download them in the background, and install
downloaded updates on normal quit. **Check for Updates…** (in the app menu on macOS, File
elsewhere) checks again and says what it found; the item shows a download in progress and
becomes **Restart to Update** once one is ready. Development and `pnpm start` skip update
checks.
`electron-builder.yml` defines the app identity, installers, and update provider. Keep the app
ID and signing identity consistent across versions.

The repository is public, so installed apps read its releases without a token. Never embed the
CI publishing token in the app.

## Self-signed macOS test builds

Notarization is disabled. The workflow uses a persistent self-signed code-signing identity,
which must be trusted on test Macs. Apple does not notarize self-signed apps, so this setup is
for controlled testing. Use the same certificate for the initial installation and every update;
ad-hoc signatures do not provide that persistent identity.

Create a **Self Signed Root** certificate of type **Code Signing** with Keychain Access's
Certificate Assistant. Export its identity (certificate and private key) as a password-protected
`.p12`, and export the public certificate as `.cer`. Store these files under `.context/` and
configure these repository Actions secrets:

| Secret                 | Value                                    |
| ---------------------- | ---------------------------------------- |
| `CSC_LINK`             | Base64-encoded `.p12` signing identity   |
| `CSC_KEY_PASSWORD`     | Password used when exporting the `.p12`  |
| `MAC_SELF_SIGNED_CERT` | Base64-encoded public `.cer` certificate |

The local signing action trusts the public certificate on the disposable macOS runner;
electron-builder imports the `.p12` and signs the app. Certificate trust runs with
noninteractive administrator privileges and a timeout so an authorization prompt cannot stall
the release indefinitely. It fails if no signing identity is available. No Apple Developer
account or notarization credentials are needed for these test builds.

On a test Mac, import the public certificate into Keychain Access and explicitly trust it for
code signing before testing an installed build and its update. The initial download can still
trigger Gatekeeper's unnotarized-app prompt. Certificate creation, repository secrets, and local
trust are setup steps; they are not performed by `pnpm install`.

## Windows signing

Windows signing is optional for testing. Supply `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD`
repository secrets when you have a Windows signing identity. A signed, installed two-version
update must be tested before distributing the app.
