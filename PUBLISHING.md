# Publishing Multi-Harness Terminal Editor

This document walks through releasing the extension to **both** galleries with the **same VSIX file**: the Visual Studio Marketplace and Open VSX.

> **Note — release identity.** `package.json` publishes under `publisher: "yasir-erkam-ozdemir"` with the repository `https://github.com/yasir-erkam/Multi-Harness-Terminal-Editor.git`. The Marketplace publisher ID **must** equal `package.json.publisher` (`yasir-erkam-ozdemir`), the Open VSX namespace with the same id must be created before the first Open VSX publish, and the GitHub repository must exist at `github.com/yasir-erkam/Multi-Harness-Terminal-Editor` before the first push.

---

## 1. Prerequisites

- **Publisher identity.** The publisher ID in `package.json` (`publisher`) must match the publisher you create on the Marketplace. Decide the name once — see the reservation warning in the [checklist](#6-first-publish-checklist).
- **Release identity is fixed.** `publisher: "yasir-erkam-ozdemir"` and the `yasir-erkam/Multi-Harness-Terminal-Editor` repository are set in `package.json` and baked into the VSIX metadata at `vsce package` time.
- **GitHub repository created and pushed.** Both the CI and release workflows expect a pushed repository, and the Open VSX namespace claim requires a public repository that matches the namespace.
- **Node.js ≥ 22** for `@vscode/vsce`.
- **One version, one publish.** Both galleries reject a version you have already published (see the checklist). Bump `version` in `package.json` for every release.

---

## 2. Package once, publish twice

Both galleries accept the same `.vsix` artifact, so package a single file and hand it to each publisher:

```bash
node --version                          # must be >= 22
npm run package
ls -1 artifacts/*.vsix
```

`--no-dependencies` is correct here: the extension has **no runtime dependencies**, so no `node_modules` needs to be bundled.

---

## 3. Visual Studio Marketplace

### 3.1 Create the publisher and a Personal Access Token

1. Sign in to **<https://marketplace.visualstudio.com/manage>** and create the publisher. Its ID must equal `package.json.publisher`.
2. Create an Azure DevOps organization (or reuse one) and generate a **Personal Access Token** at `https://dev.azure.com/<org>/_usersSettings/tokens`.
   - Organization: **All accessible organizations**.
   - Scope: **Marketplace → Manage**.

### 3.2 Log in and verify the token

```bash
npx @vscode/vsce login yasir-erkam-ozdemir      # paste the PAT when prompted
npx @vscode/vsce verify-pat yasir-erkam-ozdemir # confirms the PAT is valid for the publisher
```

The logged-in PAT is stored locally; you do not need to paste it for every `publish`.

### 3.3 Publish with the CLI

```bash
npx @vscode/vsce publish --packagePath ./artifacts/multi-harness-terminal-editor-1.0.0.vsix
```

### 3.4 Or upload manually

From the publisher's **Manage** page, use the upload control to add the `.vsix` by hand. This is the fallback when CI cannot hold a PAT.

---

## 4. Open VSX

### 4.1 Account and Publisher Agreement

1. Create an **Eclipse Foundation account** at <https://accounts.eclipse.org>.
2. Link your **GitHub account** to that Eclipse account.
3. Sign the **Publisher Agreement** on your Open VSX profile page at <https://open-vsx.org>. This is mandatory before any publish.
4. Generate an access token at <https://open-vsx.org/user-settings/tokens>.

### 4.2 Create the namespace

```bash
export OVSX_PAT="<your open-vsx token>"
npx ovsx create-namespace yasir-erkam-ozdemir -p "$OVSX_PAT"
```

### 4.3 Publish the same VSIX

```bash
npx ovsx publish ./artifacts/multi-harness-terminal-editor-1.0.0.vsix -p "$OVSX_PAT"
```

### 4.4 Claim the namespace for the verified badge

Namespace **ownership** (and the verified badge) is not granted automatically: open a GitHub issue on the Open VSX repository claiming the namespace, referencing the public repository that matches it.

---

## 5. Global Azure DevOps PATs are retired on 2026-12-01

Until **2026-12-01** the Azure DevOps PAT flow in section 3.1 works. After that date, global PATs stop working, and you must use one of these two alternatives:

- **Entra ID with a managed identity.** Authenticate the publishing environment with Entra ID, then publish with
  ```bash
  npx @vscode/vsce publish --azure-credential --packagePath <file>.vsix
  ```
- **OIDC trusted publishing.** Let the GitHub Actions workflow exchange its OIDC token for publishing rights:
  ```yaml
  permissions:
    id-token: write
  # ...
  npx @vscode/vsce publish --oidc --packagePath <file>.vsix
  ```
  The `id-token: write` permission is required for the OIDC token exchange. As a bonus, no long-lived PAT secret is stored in the repository.

Open VSX tokens are unaffected by this retirement; only the Marketplace's Azure DevOps PAT flow changes.

---

## 6. First-publish checklist

- [ ] **New version for every publish.** Both galleries refuse a version that has already been used, and a **deleted version can never be reused**. Bump `version` in `package.json` before each release.
- [ ] **Names stay reserved.** The Microsoft Marketplace **permanently reserves the extension name** after you remove an extension, so choose the `name`/`displayName` deliberately.
- [ ] **Icon must not be SVG.** `vsce` requires a **PNG** icon (`icon.png`); SVG icons are rejected at package/publish time.
- [ ] **README/CHANGELOG images must be `https` and not SVG.** Image URLs inside the README and CHANGELOG must use `https` and must not point at SVG files (badge providers are exempt from the SVG restriction).
- [ ] **`LICENSE` file and `repository` field.** Both are expected; when they are missing, `vsce` warns and CI prompts. The `repository` field points at `github.com/yasir-erkam/Multi-Harness-Terminal-Editor` and the `LICENSE` file is in place.
- [ ] **A `license` field is required.** Open VSX has **no open-source-license requirement**, but every extension must declare a `license` in `package.json`. If it is unspecified, the Publisher Agreement defaults it to **MIT** — still, declare it explicitly. This project uses `MIT`.
- [ ] **Keywords ≤ 30.** The `keywords` array is capped at 30 entries at publish time.
- [ ] **Pre-release rules.** A pre-release version must be plain `major.minor.patch` — **no `-beta` suffix**. If you want pre-releases, use the `--pre-release` flag and an **odd minor** version designation (for example `0.3.0` as an odd minor following a stable `0.2.0`).
- [ ] **One VSIX, two galleries.** The same `.vsix` file is valid on both galleries — do not rebuild between the two publishes.

---

## 7. Automated releases

`.github/workflows/release.yml` runs on `v*` tags and automates everything above:

1. checks out the repo, sets up Node 22, runs `npm ci` and `npm run package`;
2. selects `artifacts/<package-name>-<package-version>.vsix` from the manifest and publishes it to the Marketplace when the `VSCE_PAT` secret is set;
3. publishes the same file to Open VSX when the `OVSX_PAT` secret is set;
4. creates a **published** GitHub release with the VSIX attached.

Add the tokens once via **Settings → Secrets and variables → Actions** (repository secrets named exactly `VSCE_PAT` and `OVSX_PAT`), or with the GitHub CLI:

```bash
gh secret set VSCE_PAT
gh secret set OVSX_PAT
```

Because each publish step is guarded, the workflow still succeeds when only one token is configured — useful while you finish setting up the second gallery. Remember to re-read section 5 before 2026-12-01.
