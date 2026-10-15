import { copyFile, lstat, mkdir, realpath, rm } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
const output = resolve(root, "dist");
const publicFiles = [
  "index.html",
  "styles.css",
  "app.js",
  "icon.svg",
  "src/schedule.mjs",
  "examples/schedule.sample.json",
];

// Keep the deployment artifact independent of any private files in the checkout.
for (const path of publicFiles) {
  const info = await lstat(resolve(root, path));
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error(`Public source must be a regular file: ${path}`);
  }
  const source = await realpath(resolve(root, path));
  const fromRoot = relative(root, source);
  if (isAbsolute(fromRoot) || fromRoot === ".." || fromRoot.startsWith(`..${sep}`)) {
    throw new Error(`Public source must stay inside the project: ${path}`);
  }
}

// Verify the exact cleanup target and reject a symlink before recursive deletion.
if (dirname(output) !== root || basename(output) !== "dist") {
  throw new Error("Unexpected build output path.");
}
try {
  const info = await lstat(output);
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new Error("dist must be a regular directory.");
  }
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

await rm(output, { recursive: true, force: true });
for (const path of publicFiles) {
  const target = resolve(output, path);
  await mkdir(dirname(target), { recursive: true });
  await copyFile(resolve(root, path), target);
}
console.log(`Built ${publicFiles.length} public files into dist/.`);
