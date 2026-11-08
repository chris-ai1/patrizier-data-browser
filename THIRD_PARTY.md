# Third-party software

Authors: Christian Reitwiessner (integration and this document).

## TFMX audio playback

The music player uses **libtfmxaudiodecoder** by Michael Schwendt and its original
contributors, licensed GPL-2.0-or-later. Its full decoder source, copyright
headers, configuration and license are preserved in `vendor/libtfmxaudiodecoder/`.
The upstream revision is recorded in its `VENDORING.md`.

The Emscripten wrapper, AudioWorklet, generated JS/WASM, and TextDecoder polyfill
are from **CoolModFiles**, by Ronny Trommer and contributors, GPL-3.0-or-later:
https://github.com/no42-org/CoolModFiles/tree/37c7a44937462e494f8d5f75b290ff52d8972458

Their existing authorship headers are preserved. The exact unmodified binaries
and worklet are in `public/audio/`; the corresponding wrapper and build script
are in `vendor/CoolModFiles/scripts/`. To rebuild, use the original script with
the vendored library at `vendor/libtfmxaudiodecoder` and output `public/audio/`.
The build script has only its integration paths adapted by Christian Reitwiessner.
It requires Emscripten, autotools and libtool. The generated library JS
also contains Emscripten runtime support.

The application integration and original resource decoding code are authored by
Christian Reitwiessner. This browser distribution uses GPL-3.0-or-later; see
`LICENSE`. No original game files, artwork, sample banks or music data are
included. They are read only from the archive the visitor supplies.

## Rust dependencies

`miniz_oxide` (MIT/Zlib/Apache-2.0), `adler2` (0BSD/MIT/Apache-2.0), and RustCrypto
`sha2`, `digest`, `crypto-common`, `block-buffer`, `generic-array`, `typenum`,
`cfg-if`, `cpufeatures`, and `version_check` (MIT/Apache-2.0, with the applicable
upstream terms) are pinned in `engine/Cargo.lock`. Their complete source and license files are vendored in `engine/vendor/`
and used by Cargo without fetching dependencies at build time. Their package license files apply unchanged.
