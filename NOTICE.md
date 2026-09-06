# Third-party components / 第三者コンポーネント

This project bundles or depends on the following third-party components. Their
licenses and terms are those of their respective owners.

## Bundled in the distributed binaries (IPA / .deb)

### Web front-end (shared with the Android build)
- The HTML/CSS/JS front-end is the same as the Android build and is kept in
  [koetomoProject](https://github.com/haizarakun/koetomoProject) (`apk-skeleton/assets/web/`).
  See that repository's NOTICE.md for `lame.min.js` (client-side MP3 encoding).

### skyway_room.js  (SkyWay WebRTC SDK)
- Purpose: real-time voice calls.
- Origin: **SkyWay** by NTT Communications — a proprietary commercial SDK.
- The SDK is **not** included in this source repository. It is present only in the
  binaries the author distributes, under SkyWay's terms.

## Build tooling (not distributed)
- **Theos** (theos.dev) — build system, GPL/MIT components; used only at build time.
- **ldid** (ProcursusTeam) — code signing at build time.
- Apple iOS SDK — used at build time under Apple's SDK terms; no SDK files are redistributed.

## Fonts
- The UI offers Google Fonts loaded at runtime from Google's CDN (SIL Open
  Font License). No font files are redistributed in this repository.

---

If you add or change any third-party component, update this file.
