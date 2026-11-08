# Patrizier Archive Explorer

Authors: Christian Reitwiessner

A static, browser-only explorer for the supplied German three-disk Amiga release
of **Der Patrizier (1992)**. Hosted with GitHub Pages under **Chris-ai1**.

Visitors supply `patrizier.zip` themselves. The archive, disk images and extracted
files never leave the browser. There is no API, upload endpoint, account,
analytics, or runtime CDN dependency. The site downloads its own static decoder
code; it does not download game assets.

## Features

- Search and filter all 105 files from the three OFS disks.
- Preview original full screens and the scrolling map with their actual palettes.
- Inspect city fragments, font, object bitmaps and all 13 streams in the cache
  file using configurable dimensions, bitplane depth, offset and palette.
- Play TFMX music locally using its matching sample bank, including subsong
  selection, pause, stop and volume.
- Inspect sample-bank waveforms and audition their signed 8-bit PCM as WAV.
- Hex view with paging; strings with offsets; original-file SHA-256 identities.
- Download original files, decoded FDL bytes and rendered PNGs locally.

The archive is pinned to SHA-256
`64ee8a6a1e8d527f05de53533c427e0e6161cc950f4cac6cb9b2de0f7b7fc9df`.
Other releases need separate verification. Raw bitmap interpretation is an
inspection tool, not a claim that sprite sheets are assembled exactly as in the
game. Audio uses a third-party TFMX player; it is not a claim of bit-identical
Paula output from the original game's replayer.

## Build

Requires Rust with `wasm32-unknown-unknown` and Node.js 22 or later:

```sh
rustup target add wasm32-unknown-unknown
npm run build
npm test
```

`dist/` is an entirely static site. Serve it over HTTPS (or localhost) for
AudioWorklet support. The Pages workflow builds it from source and deploys on
push to `main`. No secrets are needed beyond GitHub's built-in workflow token.

Optional browser interaction checks (requires Playwright and a browser):

```sh
PATRIZIER_ZIP=/path/to/patrizier.zip node scripts/browser-check.mjs
```

The check starts a temporary loopback-only static test server, then closes it. It covers local
archive import, PNG downloads, cached-screen palettes, music playback and
subsong controls, sample WAV playback, hex/strings, mobile width, and absence of
upload requests.

The shared portable Rust core is vendored as source in `engine/` so the public
site can build without access to the private game repository. Its new code is
credited to Christian Reitwiessner. The browser ABI is also used in the game
project; game simulation work remains separate.

Optional integration verification with the original archive (never checked in):

```sh
PATRIZIER_ZIP=/path/to/patrizier.zip npm test
```

## Credits

Original game assets and music remain credited to their original creators.
TFMX playback uses libtfmxaudiodecoder and CoolModFiles' browser integration;
existing contributors' copyright and license headers are retained. See
[THIRD_PARTY.md](THIRD_PARTY.md) and [LICENSE](LICENSE).
