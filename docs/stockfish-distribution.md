# Stockfish.js browser-engine distribution

Moechess distributes the lite, single-threaded WebAssembly build from Stockfish.js
19.0.0. The application loads it as a classic browser worker. The selected build does
not require cross-origin isolation.

## Provenance

- npm package: `stockfish@19.0.0`
- npm integrity: `sha512-jDyYLbqNpboQcMs5HodTHI2CrKL74zkQWb1+sgoNXw5HI6avTblW4G0X7afFt3BBOc6VbTSkOV64EUxm/DWSpg==`
- npm tarball: `https://registry.npmjs.org/stockfish/-/stockfish-19.0.0.tgz`
- source repository: `https://github.com/nmrugg/stockfish.js`
- package `gitHead`: `54fde71d90c7c403964f6cacef48f7bbec495df1`
- release: `https://github.com/nmrugg/stockfish.js/releases/tag/v19.0.0`
- lite NNUE input: `nn-61e7af4bb97d.nnue`, whose full SHA-256 is recorded in
  the manifest

The npm metadata and source revision were checked before the package was installed.
The checked-in manifest at `public/engines/stockfish/manifest.json` records the public
URL, byte length, and SHA-256 digest of every distributed file. It also gives the engine
build identity used by analysis caches.

## Distributed material

`public/engines/stockfish/` contains:

- the matching `stockfish-19-lite-single.js` worker and
  `stockfish-19-lite-single.wasm` companion;
- the GPLv3 license and upstream release notice;
- a source archive fixed to the package's exact `gitHead`;
- the hash-addressed lite NNUE network needed by the build; and
- `BUILDING.txt`, with the exact variant command and required Emscripten version.

The source archive includes the Stockfish.js build script, engine sources, authors,
license, and vendored JavaScript minifier used by this revision. The network file is
provided separately because the upstream build script normally downloads it by its
content-addressed filename.

## Refreshing and verification

For an intentional refresh, first verify the registry metadata and source revision.
Download the source archive at that exact revision and the hash-addressed NNUE input
beside it. Then run:

```text
node scripts/vendor-stockfish.mjs --source /path/to/stockfish.js-<revision>.tar.gz
```

The vendoring script accepts only the pinned package release, the exact source revision,
one unambiguous lite single-threaded JS/WASM pair, and a network whose content matches
its name. It copies only those runtime assets and the compliance/build material.

To verify the checked-in distribution without writing files, run:

```text
node scripts/vendor-stockfish.mjs --check
```

The check reads each staged file and compares its URL, length, and SHA-256 digest with
the manifest. See the staged `BUILDING.txt` for the reproducible-build procedure. The
manifest hashes describe the upstream release binaries; compiler environment details
beyond the pinned Emscripten version can cause a local rebuild to differ byte-for-byte.
