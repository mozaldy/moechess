import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { gunzipSync } from "node:zlib";

const RELEASE = "19.0.0";
const SOURCE_REVISION = "54fde71d90c7c403964f6cacef48f7bbec495df1";
const NETWORK_FILE = "nn-61e7af4bb97d.nnue";
const BUILD_INSTRUCTIONS = `Reproducing the Stockfish.js 19 lite single-threaded engine

Source revision: ${SOURCE_REVISION}
Required Emscripten version: 3.1.7
Required NNUE input: ${NETWORK_FILE}

1. Extract the corresponding source archive in this directory.
2. Copy ${NETWORK_FILE} into the extracted source tree's src directory.
3. Install and activate Emscripten 3.1.7 so emcc is on PATH.
4. From the extracted source root run:

   node build.js --single-threaded --lite -f

The expected outputs are bin/stockfish-19-lite-single.js and
bin/stockfish-19-lite-single.wasm. Compare their SHA-256 hashes with
manifest.json. The distributed binaries are the verified v19.0.0 release
assets; rebuilds can differ if the remaining compiler/toolchain environment
differs from the release builder.
`;
const OUTPUT_DIR = join(process.cwd(), "public/engines/stockfish");
const MANIFEST_PATH = join(OUTPUT_DIR, "manifest.json");
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

function usage() {
  throw new Error("Usage: node scripts/vendor-stockfish.mjs --source <archive> | --check");
}

async function packageMetadata() {
  const pkg = JSON.parse(await readFile("node_modules/stockfish/package.json", "utf8"));
  if (pkg.version !== RELEASE) throw new Error("Unexpected Stockfish package version");
  if (pkg.license !== "GPL-3.0" || !String(pkg.repository?.url).includes("nmrugg/stockfish.js")) {
    throw new Error("Stockfish package source provenance is absent or unexpected");
  }
  return pkg;
}

async function releaseAssets() {
  const names = await readdir("node_modules/stockfish/bin");
  const matches = names.filter((name) => /^stockfish-19-lite-single\.(js|wasm)$/.test(name));
  const scripts = matches.filter((name) => name.endsWith(".js"));
  const wasm = matches.filter((name) => name.endsWith(".wasm"));
  if (scripts.length !== 1 || wasm.length !== 1 || matches.length !== 2) {
    throw new Error("Missing or ambiguous lite single-threaded Stockfish asset pair");
  }
  if (scripts[0].replace(/\.js$/, "") !== wasm[0].replace(/\.wasm$/, "")) {
    throw new Error("Stockfish worker and WASM companion filenames do not match");
  }
  return [scripts[0], wasm[0]];
}

function archiveFile(tarBytes, wantedName) {
  const matches = [];
  for (let offset = 0; offset + 512 <= tarBytes.byteLength;) {
    const header = tarBytes.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const text = (start, end) => header.subarray(start, end).toString("utf8").replace(/\0.*$/, "");
    const name = text(0, 100);
    const prefix = text(345, 500);
    const path = prefix ? `${prefix}/${name}` : name;
    const sizeText = text(124, 136).trim();
    const size = Number.parseInt(sizeText, 8);
    if (!Number.isSafeInteger(size) || size < 0) {
      throw new Error(`Source archive has an invalid tar size for ${path || "an unnamed entry"}`);
    }
    const contentStart = offset + 512;
    const contentEnd = contentStart + size;
    if (contentEnd > tarBytes.byteLength) throw new Error(`Source archive entry is truncated: ${path}`);
    if (path === wantedName || path.endsWith(`/${wantedName}`)) {
      matches.push(Buffer.from(tarBytes.subarray(contentStart, contentEnd)));
    }
    offset = contentStart + Math.ceil(size / 512) * 512;
  }
  if (matches.length !== 1) {
    throw new Error(`Source archive must contain exactly one ${wantedName}`);
  }
  return matches[0];
}

function validateSourceArchive(sourcePath, bytes) {
  if (!basename(sourcePath).includes(SOURCE_REVISION)) {
    throw new Error(`Source archive filename must identify revision ${SOURCE_REVISION}`);
  }
  let tarBytes;
  try {
    tarBytes = gunzipSync(bytes);
  } catch (cause) {
    throw new Error("Source archive is not a readable gzip archive", { cause });
  }
  const listing = tarBytes.toString("latin1");
  const required = ["/build.js", "/Copying.txt", "/AUTHORS", "/scripts/net.sh", "/src/evaluate.h"];
  if (!listing.includes(SOURCE_REVISION) || required.some((entry) => !listing.includes(entry))) {
    throw new Error("Source archive does not contain the verified revision and build material");
  }
  return { licenseBytes: archiveFile(tarBytes, "Copying.txt") };
}

async function hashEntry(name, url) {
  const bytes = await readFile(join(OUTPUT_DIR, name));
  return { file: name, url, sha256: digest(bytes), bytes: bytes.byteLength };
}

async function vendor(sourcePath) {
  await packageMetadata();
  const [workerFile, wasmFile] = await releaseAssets();
  const sourceBytes = await readFile(sourcePath);
  const { licenseBytes } = validateSourceArchive(sourcePath, sourceBytes);
  const packageLicenseBytes = await readFile("node_modules/stockfish/Copying.txt");
  if (digest(packageLicenseBytes) !== digest(licenseBytes)) {
    throw new Error("Package license does not match Copying.txt in the fixed source archive");
  }

  const networkPath = join(dirname(sourcePath), NETWORK_FILE);
  const networkBytes = await readFile(networkPath);
  if (digest(networkBytes).slice(0, 12) !== "61e7af4bb97d") {
    throw new Error(`Network input ${NETWORK_FILE} failed its content-addressed hash check`);
  }

  const sourceFile = `stockfish.js-${RELEASE}-source-${SOURCE_REVISION}.tar.gz`;
  const licenseFile = "COPYING-GPL-3.0.txt";
  const noticeFile = "NOTICE.txt";
  const buildFile = "BUILDING.txt";
  await mkdir(OUTPUT_DIR, { recursive: true });
  await Promise.all([
    copyFile(join("node_modules/stockfish/bin", workerFile), join(OUTPUT_DIR, workerFile)),
    copyFile(join("node_modules/stockfish/bin", wasmFile), join(OUTPUT_DIR, wasmFile)),
    writeFile(join(OUTPUT_DIR, licenseFile), licenseBytes),
    copyFile("node_modules/stockfish/README.md", join(OUTPUT_DIR, noticeFile)),
    copyFile(sourcePath, join(OUTPUT_DIR, sourceFile)),
    copyFile(networkPath, join(OUTPUT_DIR, NETWORK_FILE)),
    writeFile(join(OUTPUT_DIR, buildFile), BUILD_INSTRUCTIONS),
  ]);

  const publicUrl = (name) => `/engines/stockfish/${name}`;
  const assets = Object.fromEntries(await Promise.all([
    ["worker", workerFile],
    ["wasm", wasmFile],
    ["license", licenseFile],
    ["notice", noticeFile],
    ["source", sourceFile],
    ["network", NETWORK_FILE],
    ["buildInstructions", buildFile],
  ].map(async ([key, file]) => [key, await hashEntry(file, publicUrl(file))])));

  const manifest = {
    release: RELEASE,
    sourceRevision: SOURCE_REVISION,
    buildId: `stockfish.js-${RELEASE}-lite-single-${assets.wasm.sha256.slice(0, 12)}`,
    workerUrl: assets.worker.url,
    wasmUrl: assets.wasm.url,
    licenseUrl: assets.license.url,
    noticeUrl: assets.notice.url,
    sourceUrl: assets.source.url,
    networkUrl: assets.network.url,
    buildInstructionsUrl: assets.buildInstructions.url,
    upstreamReleaseUrl: `https://github.com/nmrugg/stockfish.js/releases/tag/v${RELEASE}`,
    upstreamSourceUrl: `https://github.com/nmrugg/stockfish.js/archive/${SOURCE_REVISION}.tar.gz`,
    assets,
  };
  await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
}

async function check() {
  const manifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
  if (manifest.release !== RELEASE || manifest.sourceRevision !== SOURCE_REVISION) {
    throw new Error("Stockfish manifest provenance does not match the pinned release");
  }
  for (const [key, entry] of Object.entries(manifest.assets ?? {})) {
    const bytes = await readFile(join(OUTPUT_DIR, entry.file));
    if (digest(bytes) !== entry.sha256 || bytes.byteLength !== entry.bytes) {
      throw new Error(`Stockfish ${key} asset does not match its manifest hash`);
    }
    if (entry.url !== `/engines/stockfish/${entry.file}`) {
      throw new Error(`Stockfish ${key} asset URL does not match its staged filename`);
    }
  }
  if (Object.keys(manifest.assets ?? {}).sort().join(",") !== "buildInstructions,license,network,notice,source,wasm,worker") {
    throw new Error("Stockfish manifest has a missing or unexpected asset set");
  }
  if (manifest.workerUrl !== manifest.assets.worker.url || manifest.wasmUrl !== manifest.assets.wasm.url) {
    throw new Error("Stockfish companion URLs do not match the hashed asset entries");
  }
  const sourcePath = join(OUTPUT_DIR, manifest.assets.source.file);
  const sourceBytes = await readFile(sourcePath);
  const { licenseBytes: sourceLicenseBytes } = validateSourceArchive(sourcePath, sourceBytes);
  const stagedLicenseBytes = await readFile(join(OUTPUT_DIR, manifest.assets.license.file));
  if (digest(stagedLicenseBytes) !== digest(sourceLicenseBytes)) {
    throw new Error("Staged license bytes do not match Copying.txt in the fixed source archive");
  }
}

if (process.argv.length === 3 && process.argv[2] === "--check") {
  await check();
} else if (process.argv.length === 4 && process.argv[2] === "--source") {
  await vendor(process.argv[3]);
} else {
  usage();
}
