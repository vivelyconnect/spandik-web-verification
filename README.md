# Spandik web app — build verification snapshot

Published by **Vively Technology** so that anyone can independently check that
the web app served at **https://app.spandik.com** is built from exactly the
source in this repository.

- **Published for independent build verification only.** This is not an
  open-source release: **no license is granted** and all rights are reserved.
- **What is here:** the web client source and its locked build dependencies —
  the minimum needed to rebuild the deployed web app byte for byte. No server
  code, configuration secrets or operational material.
- **Each release** is recorded in `releases/<source-commit>/`: the SHA-256 of
  every deployed file (`manifest.json`), a Sigstore bundle signed keylessly by
  this repository's verification workflow (`manifest.sigstore.json`), and the
  public Rekor transparency-log entry (`rekor.txt`).

## Verify it yourself

Requirements: Node.js 24 and npm.

```sh
git clone <this repository> && cd <it>
git checkout <release tag>          # tags are named after the source commit
npm ci                              # exact versions from package-lock.json
cd frontend
VITE_API_URL=https://api.spandik.com \
VITE_CHAT_WS_URL=wss://chat.spandik.com \
VITE_LC_WS_URL=wss://lc.spandik.com \
VITE_MEDIA_URL=https://media.spandik.com \
npx vite build
cd ..
node tools/release-manifest.mjs frontend/dist                         # "root" must equal releases/<commit>/manifest.json
node tools/release-manifest.mjs --compare frontend/dist https://app.spandik.com   # every live file must be identical
```

Check the signature and the transparency-log entry with
[cosign](https://docs.sigstore.dev/):

```sh
cosign verify-blob releases/<commit>/manifest.json \
  --bundle releases/<commit>/manifest.sigstore.json \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  --certificate-identity-regexp '^https://github.com/vivelyconnect/spandik-web-verification/'
```

The `--compare` step checks what the live site serves *now*; when a newer
release is deployed, verify that release's tag instead.
