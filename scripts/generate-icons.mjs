import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const publicDir = path.join(root, "public");
const androidRes = path.join(root, "android", "app", "src", "main", "res");
const tempDir = path.join(root, "..", "work", "icon-generation");
fs.mkdirSync(tempDir, { recursive: true });

function sips(source, width, height, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  execFileSync("sips", ["-z", String(height), String(width), source, "--out", target], {
    stdio: "ignore"
  });
}

function svgToPng(source, width, height, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  execFileSync(
    "sips",
    ["-s", "format", "png", "--resampleHeightWidth", String(height), String(width), source, "--out", target],
    { stdio: "ignore" }
  );
}

const icon512 = path.join(publicDir, "icon-512.png");
svgToPng(path.join(publicDir, "icon.svg"), 512, 512, icon512);
sips(icon512, 192, 192, path.join(publicDir, "icon-192.png"));

const densitySizes = [
  ["mdpi", 48, 108],
  ["hdpi", 72, 162],
  ["xhdpi", 96, 216],
  ["xxhdpi", 144, 324],
  ["xxxhdpi", 192, 432]
];

const foregroundSource = path.join(tempDir, "icon-foreground.png");
svgToPng(path.join(publicDir, "icon-foreground.svg"), 432, 432, foregroundSource);

for (const [density, iconSize, foregroundSize] of densitySizes) {
  const directory = path.join(androidRes, `mipmap-${density}`);
  sips(icon512, iconSize, iconSize, path.join(directory, "ic_launcher.png"));
  sips(icon512, iconSize, iconSize, path.join(directory, "ic_launcher_round.png"));
  sips(
    foregroundSource,
    foregroundSize,
    foregroundSize,
    path.join(directory, "ic_launcher_foreground.png")
  );
}

const iconBase64 = fs.readFileSync(icon512).toString("base64");
const splashTargets = [
  ["drawable-land-mdpi", 480, 320],
  ["drawable-land-hdpi", 800, 480],
  ["drawable-land-xhdpi", 1280, 720],
  ["drawable-land-xxhdpi", 1600, 960],
  ["drawable-land-xxxhdpi", 1920, 1280],
  ["drawable-port-mdpi", 320, 480],
  ["drawable-port-hdpi", 480, 800],
  ["drawable-port-xhdpi", 720, 1280],
  ["drawable-port-xxhdpi", 960, 1600],
  ["drawable-port-xxxhdpi", 1280, 1920],
  ["drawable", 480, 320]
];

for (const [directory, width, height] of splashTargets) {
  const iconSize = Math.round(Math.min(width, height) * 0.46);
  const x = Math.round((width - iconSize) / 2);
  const y = Math.round((height - iconSize) / 2);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect width="${width}" height="${height}" fill="#D92C22"/>
    <image x="${x}" y="${y}" width="${iconSize}" height="${iconSize}" href="data:image/png;base64,${iconBase64}"/>
  </svg>`;
  const svgPath = path.join(tempDir, `${directory}.svg`);
  fs.writeFileSync(svgPath, svg);
  svgToPng(
    svgPath,
    width,
    height,
    path.join(androidRes, directory, "splash.png")
  );
}

console.log("Generated PWA, Android launcher, adaptive, and splash icons.");
