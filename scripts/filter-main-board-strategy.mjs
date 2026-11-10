import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { filterMainBoard } from "./main-board.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const paths = [
  path.join(ROOT, "data", "strategy.json"),
  path.join(ROOT, "public", "strategy.json")
];

for (const file of paths) {
  const strategy = JSON.parse(await fs.readFile(file, "utf8"));
  const candidates = filterMainBoard(strategy.candidates ?? []);
  const reviewUniverse = filterMainBoard(
    strategy.reviewUniverse ?? candidates
  );
  strategy.candidates = candidates;
  strategy.reviewUniverse = reviewUniverse;
  strategy.recommendation = candidates[0] ?? reviewUniverse[0] ?? null;
  if (
    strategy.rawModelLeader &&
    !filterMainBoard([strategy.rawModelLeader]).length
  ) {
    strategy.rawModelLeader = reviewUniverse[0] ?? null;
  }
  await fs.writeFile(file, `${JSON.stringify(strategy, null, 2)}\n`, "utf8");
  console.log(
    `${path.relative(ROOT, file)}: ${candidates.length} picks, ` +
      `${reviewUniverse.length} review candidates`
  );
}
