#!/usr/bin/env node
/**
 * Fetch Windows LGPL libmpv runtime into native-deps/windows-x64.
 * Source: zhongfly/mpv-winbuild mpv-dev-lgpl builds (FFmpeg LGPL, -Dgpl=false intent).
 */
import { createHash } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { execFileSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "../..");
const outRoot = join(root, "native-deps", "windows-x64");
const manifestPath = join(root, "native-deps", "windows-x64.manifest.json");

const OWNER = "zhongfly";
const REPO = "mpv-winbuild";

async function latestLgplAsset() {
  const res = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "replay-native-fetch" },
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  const release = await res.json();
  const asset = (release.assets || []).find((a) => /mpv-dev-lgpl-x86_64.*\.7z$/i.test(a.name));
  if (!asset) {
    // Fallback: any mpv-dev-x86_64 if lgpl asset naming differs
    const fallback = (release.assets || []).find((a) => /mpv-dev-x86_64(?!-v3).*\.7z$/i.test(a.name));
    if (!fallback) throw new Error("No mpv-dev-lgpl/x86_64 asset found in latest release");
    console.warn("LGPL-named asset not found; using", fallback.name);
    return { release, asset: fallback };
  }
  return { release, asset };
}

async function download(url, dest) {
  const res = await fetch(url, { redirect: "follow", headers: { "User-Agent": "replay-native-fetch" } });
  if (!res.ok) throw new Error(`Download failed ${res.status}`);
  await pipeline(res.body, createWriteStream(dest));
}

function sha256File(path) {
  const hash = createHash("sha256");
  hash.update(readFileSync(path));
  return hash.digest("hex");
}

function ensure7zr() {
  const local = join(root, "tools", "7zr.exe");
  if (existsSync(local)) return local;
  mkdirSync(dirname(local), { recursive: true });
  console.log("Downloading portable 7zr.exe…");
  // sync download via powershell for reliability on Windows agents
  execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      `Invoke-WebRequest -Uri https://www.7-zip.org/a/7zr.exe -OutFile '${local.replace(/'/g, "''")}' -UseBasicParsing`,
    ],
    { stdio: "inherit" },
  );
  return local;
}

function extract7z(archive, dest) {
  mkdirSync(dest, { recursive: true });
  const candidates = [
    ensure7zr(),
    join(root, "tools", "7za.exe"),
    "7z",
    "7za",
    join(process.env.ProgramFiles || "C:\\Program Files", "7-Zip", "7z.exe"),
    join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "7-Zip", "7z.exe"),
  ];
  for (const c of candidates) {
    try {
      execFileSync(c, ["--help"], { stdio: "ignore" });
      execFileSync(c, ["x", archive, `-o${dest}`, "-y"], { stdio: "inherit" });
      return;
    } catch {
      /* try next */
    }
  }
  try {
    execFileSync(
      "python",
      [
        "-c",
        "import py7zr,sys; py7zr.SevenZipFile(sys.argv[1]).extractall(sys.argv[2])",
        archive,
        dest,
      ],
      { stdio: "inherit" },
    );
    return;
  } catch {
    throw new Error(
      "Need 7-Zip/7zr or Python py7zr to extract mpv-dev archives. Re-run npm run native:fetch.",
    );
  }
}

async function main() {
  mkdirSync(outRoot, { recursive: true });
  const { release, asset } = await latestLgplAsset();
  const archive = join(outRoot, asset.name);
  console.log(`Fetching ${asset.name} from ${release.tag_name}…`);
  await download(asset.browser_download_url, archive);
  const sha256 = sha256File(archive);
  const extractDir = join(outRoot, "_extract");
  rmSync(extractDir, { recursive: true, force: true });
  extract7z(archive, extractDir);

  const binDir = join(outRoot, "bin");
  const includeDir = join(outRoot, "include");
  const libDir = join(outRoot, "lib");
  mkdirSync(binDir, { recursive: true });
  mkdirSync(includeDir, { recursive: true });
  mkdirSync(libDir, { recursive: true });

  // Copy DLL + headers using PowerShell for glob simplicity on Windows
  execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      `
      $root = '${extractDir.replace(/'/g, "''")}'
      $bin = '${binDir.replace(/'/g, "''")}'
      $inc = '${includeDir.replace(/'/g, "''")}'
      $lib = '${libDir.replace(/'/g, "''")}'
      Get-ChildItem -Path $root -Recurse -Filter 'libmpv-2.dll' | ForEach-Object { Copy-Item $_.FullName (Join-Path $bin $_.Name) -Force }
      Get-ChildItem -Path $root -Recurse -Filter 'mpv-2.dll' | ForEach-Object { Copy-Item $_.FullName (Join-Path $bin $_.Name) -Force }
      Get-ChildItem -Path $root -Recurse -Filter 'mpv.dll' | ForEach-Object { Copy-Item $_.FullName (Join-Path $bin $_.Name) -Force }
      Get-ChildItem -Path $root -Recurse -Directory -Filter 'mpv' | ForEach-Object {
        Copy-Item $_.FullName (Join-Path $inc 'mpv') -Recurse -Force
      }
      Get-ChildItem -Path $root -Recurse -Include '*.def','*.lib','*.a','*.dll.a' | ForEach-Object {
        Copy-Item $_.FullName (Join-Path $lib $_.Name) -Force
      }
      `,
    ],
    { stdio: "inherit" },
  );

  const dll = join(binDir, "libmpv-2.dll");
  if (!existsSync(dll) && existsSync(join(binDir, "mpv-2.dll"))) {
    // normalize name
    execFileSync("powershell.exe", [
      "-NoProfile",
      "-Command",
      `Copy-Item '${join(binDir, "mpv-2.dll")}' '${dll}' -Force`,
    ]);
  }
  if (!existsSync(dll)) {
    throw new Error("libmpv-2.dll not found after extract");
  }

  const manifest = {
    platform: "windows-x64",
    source: {
      owner: OWNER,
      repo: REPO,
      tag: release.tag_name,
      asset: asset.name,
      url: asset.browser_download_url,
      preference: "mpv-dev-lgpl (LGPL-oriented build)",
    },
    archiveSha256: sha256,
    dll: "bin/libmpv-2.dll",
    dllSha256: sha256File(dll),
    fetchedAt: new Date().toISOString(),
    notes:
      "Replay dynamically loads libmpv-2.dll. Prefer LGPL builds (-Dgpl=false). Verify THIRD_PARTY_NOTICES before redistribution.",
  };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  writeFileSync(join(outRoot, "README.md"), `# Windows x64 native deps\n\nSee \`windows-x64.manifest.json\` for provenance.\nDLL: \`bin/libmpv-2.dll\`\n`);
  console.log("Wrote", manifestPath);
  console.log("DLL sha256", manifest.dllSha256);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
