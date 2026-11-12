import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { exit, platform } from "node:process";

function run(command, args) {
  const result = spawnSync(command, args, {
    shell: platform === "win32",
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) exit(result.status ?? 1);
}

run("pnpm", ["run", "build"]);

if (existsSync(".git")) {
  run("pnpm", ["exec", "husky"]);
}
