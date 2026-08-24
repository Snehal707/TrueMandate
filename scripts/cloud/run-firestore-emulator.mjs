#!/usr/bin/env node
/** Run the local demo Firestore emulator and the repository race runner. */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

function javaBin() {
  if (process.env.JAVA_HOME) return join(process.env.JAVA_HOME, "bin");
  if (process.platform !== "win32") return undefined;
  const root = join(process.env.ProgramFiles ?? "C:\\Program Files", "Microsoft");
  if (!existsSync(root)) return undefined;
  const jdk = readdirSync(root).find((entry) => entry.toLowerCase().startsWith("jdk-"));
  return jdk ? join(root, jdk, "bin") : undefined;
}

const bin = javaBin();
if (bin && existsSync(join(bin, process.platform === "win32" ? "java.exe" : "java"))) {
  const delimiter = process.platform === "win32" ? ";" : ":";
  const path = `${bin}${delimiter}${process.env.PATH ?? process.env.Path ?? ""}`;
  process.env.PATH = path;
  process.env.Path = path;
}

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const npmRoot = execFileSync(npm, ["root", "-g"], { encoding: "utf8", shell: process.platform === "win32" }).trim();
const firebaseCli = join(npmRoot, "firebase-tools", "lib", "bin", "firebase.js");
const result = spawnSync(process.execPath, [firebaseCli,
  "emulators:exec", "node scripts/cloud/run-firestore-emulator-races.mjs",
  "--only", "firestore", "--config", "firebase.json", "--project", "demo-truemandate",
], { stdio: "inherit", env: process.env });
if (result.error) console.error(`Unable to start Firebase CLI: ${result.error.message}`);
process.exit(result.status ?? 1);
