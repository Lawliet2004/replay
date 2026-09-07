# Android release signing

The release workflow aligns the arm64 release APK, signs it with a persistent
keystore, and verifies its signature and alignment before uploading it. Missing
credentials or failed verification stop the Android job and release publication.

## One-time setup

Reuse the existing release key if the app has previously shipped signed APKs.
Otherwise, create a key outside the repository (the command prompts for passwords):

```sh
keytool -genkeypair -v -keystore replay-release.jks -storetype JKS -alias replay -keyalg RSA -keysize 3072 -validity 10000
```

Back up the keystore, alias, and passwords securely. Use the same key for all
future releases so installed apps can be updated. Do not commit these files.

In GitHub repository Settings → Secrets and variables → Actions, configure:

| Secret                      | Value                                                  |
| --------------------------- | ------------------------------------------------------ |
| `ANDROID_KEYSTORE_BASE64`   | Base64 encoding of the entire keystore file            |
| `ANDROID_KEYSTORE_PASSWORD` | Keystore password                                      |
| `ANDROID_KEY_ALIAS`         | `replay`, or the existing key's alias                  |
| `ANDROID_KEY_PASSWORD`      | Private key password (may equal the keystore password) |

To upload the keystore from PowerShell without printing it (GitHub CLI required):

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes((Resolve-Path ./replay-release.jks))) | gh secret set ANDROID_KEYSTORE_BASE64 --repo Lawliet2004/replay
gh secret set ANDROID_KEYSTORE_PASSWORD --repo Lawliet2004/replay
gh secret set ANDROID_KEY_ALIAS --repo Lawliet2004/replay
gh secret set ANDROID_KEY_PASSWORD --repo Lawliet2004/replay
```

The last three commands prompt for their values. Never paste credentials into
issues, release notes, or chat.

## Release and verification

Publish a new version tag containing the updated workflow after configuring the
secrets. Re-running an old tag uses that tag's old workflow and does not apply this
fix. Download the new release's `Replay-<tag>-android-aarch64.apk` on the phone.

The signing step runs Android SDK Build Tools 35.0.0 `zipalign` before `apksigner`,
then checks the final APK with `apksigner verify --verbose --print-certs` and
`zipalign -c -P 16 4`. It accepts exactly one release APK to avoid accidentally
publishing a debug or unrelated build.

An already downloaded unsigned APK stays invalid; it must be replaced with the
signed release. A previous debug installation may have a different signing key;
back up app data before uninstalling it if Android reports a signature conflict.

References: [apksigner](https://developer.android.com/tools/apksigner) and
[zipalign](https://developer.android.com/tools/zipalign).
