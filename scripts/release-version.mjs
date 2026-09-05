import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const versionFiles = [
  "package.json",
  "src-tauri/tauri.conf.json",
  "src-tauri/Cargo.toml",
  "src-tauri/Cargo.lock",
];

export function parseReleaseTag(tag) {
  const match =
    /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(alpha|beta|rc)\.(0|[1-9]\d*))?$/.exec(
      tag,
    );
  // JavaScript's $ also matches before a trailing newline. Require an exact match.
  if (
    !match ||
    match[0] !== tag ||
    match.slice(1, 4).some((part) => Number(part) > 65535)
  ) {
    throw new Error(
      "标签格式应为 v1.2.3 或 v1.2.3-beta.1（支持 alpha/beta/rc；前三段最大 65535）",
    );
  }
  return { tag, version: tag.slice(1), prerelease: Boolean(match[4]) };
}

function packageSection(source, lockfile) {
  const sections = [
    ...source.matchAll(
      lockfile
        ? /^\[\[package\]\][^]*?(?=^\[\[package\]\]|$(?![^]))/gm
        : /^\[package\][^]*?(?=^\[|$(?![^]))/gm,
    ),
  ];
  const matches = sections.filter((section) =>
    /^name\s*=\s*"miraihub"\s*$/m.test(section[0]),
  );
  if (matches.length !== 1)
    throw new Error("Rust 配置必须包含唯一的 miraihub package");
  const section = matches[0];
  const versions = [...section[0].matchAll(/^version\s*=\s*"([^"]+)"/gm)];
  if (versions.length !== 1)
    throw new Error("miraihub package 必须包含唯一的版本号");
  return { section, version: versions[0][1] };
}

function inspectFile(file, source) {
  if (file.endsWith(".json")) {
    const parsed = JSON.parse(source);
    if (typeof parsed.version !== "string")
      throw new Error(`${file} 缺少版本号`);
    return {
      version: parsed.version,
      update: (version) =>
        `${JSON.stringify({ ...parsed, version }, null, 2)}\n`,
    };
  }
  const { section, version } = packageSection(source, file.endsWith(".lock"));
  return {
    version,
    update: (next) =>
      source.slice(0, section.index) +
      section[0].replace(/^(version\s*=\s*")[^"]+(")/m, `$1${next}$2`) +
      source.slice(section.index + section[0].length),
  };
}

export function syncReleaseVersion(root, tag, { check = false } = {}) {
  const release = tag === undefined ? undefined : parseReleaseTag(tag);
  // Read and validate every file before changing any file.
  const files = versionFiles.map((file) => {
    const path = resolve(root, file);
    const source = readFileSync(path, "utf8");
    return { file, path, source, ...inspectFile(file, source) };
  });
  const expected = release ?? parseReleaseTag(`v${files[0].version}`);
  if (check) {
    const mismatches = files.filter(
      (file) => file.version !== expected.version,
    );
    if (mismatches.length)
      throw new Error(
        `版本号不一致，期望 ${expected.version}：${mismatches.map((file) => `${file.file}=${file.version}`).join(", ")}`,
      );
  } else {
    if (!release)
      throw new Error("请指定版本标签，例如 pnpm version:set v0.2.0");
    for (const file of files) {
      const next = file.update(release.version);
      if (next !== file.source) writeFileSync(file.path, next);
    }
  }
  return expected;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const args = process.argv.slice(2);
    const tags = args.filter((arg) => !arg.startsWith("--"));
    if (
      tags.length > 1 ||
      args.some(
        (arg) =>
          arg.startsWith("--") && !["--check", "--github-output"].includes(arg),
      )
    ) {
      throw new Error(
        "用法：node scripts/release-version.mjs [v1.2.3] [--check] [--github-output]",
      );
    }
    const release = syncReleaseVersion(projectRoot, tags[0], {
      check: args.includes("--check"),
    });
    if (args.includes("--github-output")) {
      if (!process.env.GITHUB_OUTPUT) throw new Error("缺少 GITHUB_OUTPUT");
      appendFileSync(
        process.env.GITHUB_OUTPUT,
        `tag=${release.tag}\nversion=${release.version}\nprerelease=${release.prerelease}\n`,
      );
    }
    console.log(
      `${args.includes("--check") ? "版本校验通过" : "版本已同步"}：${release.version}`,
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
