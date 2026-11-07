import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "..");
const watchMode = process.argv.includes("--watch");
const remote = process.env.GIT_REMOTE || "origin";
const branch = process.env.GIT_BRANCH || "main";

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: appRoot,
      env: process.env,
      stdio: "inherit"
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

async function hasChanges() {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["status", "--porcelain"], {
      cwd: appRoot,
      stdio: ["ignore", "pipe", "inherit"]
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve(output.trim().length > 0);
      else reject(new Error(`git status exited with code ${code}`));
    });
  });
}

async function publish() {
  console.log(`\n[${new Date().toLocaleString("zh-CN")}] Building latest version...`);
  await run("npm", ["run", "check"]);
  await run("npm", ["run", "build"]);

  if (!(await hasChanges())) {
    console.log("No source changes to publish.");
    return;
  }

  await run("git", ["add", "-A"]);
  await run("git", ["commit", "-m", `sync: ${new Date().toISOString()}`]);
  await run("git", ["push", remote, `HEAD:${branch}`]);
  console.log("Pushed to GitHub. Pages deployment will start automatically.");
}

const watchedPaths = [
  "src",
  "public",
  "data",
  "index.html",
  "vite.config.ts",
  "package.json",
  ".github/workflows"
];
const ignoredSegments = new Set([
  "node_modules",
  "dist",
  ".git",
  ".edgeone",
  ".playwright-cli",
  "output"
]);

function shouldSync(filename) {
  if (!filename) return false;
  const parts = filename.toString().split(path.sep);
  if (parts.some((part) => ignoredSegments.has(part))) return false;
  return (
    filename.startsWith("src") ||
    filename.startsWith("public") ||
    filename.startsWith("data") ||
    filename.startsWith(".github") ||
    filename === "index.html" ||
    filename === "vite.config.ts" ||
    filename === "package.json"
  );
}

if (!watchMode) {
  publish().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
} else {
  let debounceTimer;
  let running = false;
  let pending = "";

  async function drainQueue() {
    if (running) return;
    running = true;
    while (pending) {
      const reason = pending;
      pending = "";
      console.log(`Detected change: ${reason}`);
      try {
        await publish();
      } catch (error) {
        console.error("Auto publish failed. Keeping watcher active.", error);
      }
    }
    running = false;
  }

  function queue(filename) {
    if (!shouldSync(filename)) return;
    pending = filename;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => void drainQueue(), 1500);
  }

  console.log("GitHub Pages auto-sync is running.");
  console.log(`Watching: ${watchedPaths.join(", ")}`);
  console.log("Press Ctrl+C to stop.");

  for (const relativePath of watchedPaths) {
    const absolutePath = path.join(appRoot, relativePath);
    if (!fs.existsSync(absolutePath)) continue;
    fs.watch(
      absolutePath,
      { recursive: fs.statSync(absolutePath).isDirectory() },
      (_, filename) => {
        if (!filename) return;
        queue(path.join(relativePath, filename.toString()));
      }
    );
  }
}
