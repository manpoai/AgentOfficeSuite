# AOSE Release Checklist

For releases that include both **npm gateway artifact** (existing channel) and **Electron Desktop App DMG** (new channel as of v3.0.5).

## Pre-flight

- [ ] All P0/P1 bug fixes merged to `feat/desktop-app-sync` (or main)
- [ ] Working tree clean: `git status` shows nothing staged/unstaged
- [ ] `npm view aose-main versions` — note the next free version
- [ ] `gh release list --limit 5` — confirm next version free on GitHub Releases
- [ ] Same version free on **all three channels** (npm, GH releases, DMG version)

## Version Bump

Update version in **all** of these to the same number:

- [ ] `package.json` (root)
- [ ] `electron/package.json`
- [ ] `bootstrap-cli.js` `FALLBACK_ARTIFACT_URL` (this points at the GH release URL — update the version segment)
- [ ] `shell/package.json` (if version-tracked)

## Build artifacts

### 1. Gateway runtime tarball (existing flow)

```
bash build-release.sh
```

Produces `dist/aose-runtime.tar.gz`. Verify:
```
python3 -c "import tarfile,json; print(json.load(tarfile.open('dist/aose-runtime.tar.gz').extractfile('aose-runtime/package.json'))['version'])"
tar tzf dist/aose-runtime.tar.gz | grep skills    # skills present
```

### 2. Electron App DMG (new flow)

Prerequisite: `electron/assets/icon.icns` (macOS), `electron/assets/icon.png` (≥512×512 for Linux/Win), `electron/assets/tray-icon.png`.

```
cd shell
npm run build:app    # builds + auto-rsync to ../shell-dist
cd ..

# macOS arm64 + x64 universal-style (two separate DMGs)
npx electron-builder --mac --arm64 --x64 --publish never

# Output:
#   release/AgentOfficeSuite-3.0.5-arm64.dmg
#   release/AgentOfficeSuite-3.0.5.dmg              (x64)
#   release/latest-mac.yml                          (auto-update manifest)
```

For **signed + notarized** builds (required for distribution outside dev machines):

```
export APPLE_ID=...
export APPLE_APP_SPECIFIC_PASSWORD=...
export APPLE_TEAM_ID=...
export CSC_LINK=path/to/cert.p12
export CSC_KEY_PASSWORD=...
npx electron-builder --mac --arm64 --x64 --publish never
```

Verify the output:
```
codesign -dv --verbose=4 release/mac-arm64/AgentOfficeSuite.app
spctl --assess --type execute -vvv release/mac-arm64/AgentOfficeSuite.app
xcrun stapler validate release/AgentOfficeSuite-3.0.5-arm64.dmg
```

## Local smoke test (before publishing)

- [ ] Mount each DMG, drag to /Applications, launch — no Gatekeeper warning if signed
- [ ] First launch creates `~/.aose/data/gateway.db` and `~/.aose/logs/main.log`
- [ ] Port auto-detection works: kill another process on 4000, App still starts
- [ ] Connect to a remote agent (zylos or own claude-code) via Connect Agents UI
- [ ] Cloud Sync: connect, edit a doc, verify it syncs to web
- [ ] Auto-update check: menu → Check for Updates (or wait for poll)

## Publish

Order matters — npm before GH release before DMG, so each subsequent channel can reference the previous artifact.

1. **Commit + tag**
   ```
   git tag v3.0.5
   git push origin main --tags
   ```

2. **GitHub Release** with all artifacts attached:
   ```
   gh release create v3.0.5 \
     --title "v3.0.5" --notes-file docs/RELEASE_NOTES.md \
     dist/aose-runtime.tar.gz \
     release/AgentOfficeSuite-3.0.5-arm64.dmg \
     release/AgentOfficeSuite-3.0.5.dmg \
     release/AgentOfficeSuite-3.0.5-arm64-mac.zip \
     release/AgentOfficeSuite-3.0.5-mac.zip \
     release/latest-mac.yml
   ```

3. **npm publish**
   ```
   npm publish
   ```

4. **Auto-update channel**: `latest-mac.yml` is in the GH Release; existing App installs will see the update via electron-updater on next launch.

## Post-publish verification

- [ ] `npm pack aose-main@3.0.5` → extract → check `bootstrap-cli.js` fallback URL points at v3.0.5
- [ ] `gh release download v3.0.5 -p '*.tar.gz'` → extract → smoke test
- [ ] Download DMG from GH Release in a fresh user account on Mac, launch — Gatekeeper passes, App opens, gateway starts
- [ ] On an existing v3.0.4 install, verify auto-updater notices v3.0.5 and offers to update

## Rollback

If a critical issue is found post-release:

- **For npm**: cannot unpublish after 72h; publish a patch (v3.0.6) immediately with the fix
- **For GH Release**: do NOT delete the release (electron-updater clients have already cached the URL); publish v3.0.6 instead, optionally edit v3.0.5 notes to add a "do not install" warning
- **For DMG**: same as GH Release — auto-updater will move users forward
- **Never** delete or republish over an existing version number on any channel

## Apple Developer cert setup (one-time)

1. Apple Developer account ($99/year)
2. Generate "Developer ID Application" cert in developer.apple.com → download .p12
3. Generate app-specific password at appleid.apple.com → use as `APPLE_APP_SPECIFIC_PASSWORD`
4. Find Team ID at developer.apple.com/account → `APPLE_TEAM_ID`
5. Store .p12 + password in CI secrets (or local keychain for solo releases)

## Channels summary

| Channel | What | Used by |
|---------|------|---------|
| npm `aose-main` | Bootstrap CLI | Self-hosted gateway users |
| GitHub Release tarball | Gateway runtime | npm bootstrap fallback |
| GitHub Release DMG (arm64) | Electron App | Apple Silicon Macs |
| GitHub Release DMG (x64) | Electron App | Intel Macs |
| GitHub Release latest-mac.yml | Auto-update manifest | electron-updater clients |

All MUST share the same version number on a given release.
