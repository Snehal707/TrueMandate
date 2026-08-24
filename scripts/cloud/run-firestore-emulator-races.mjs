#!/usr/bin/env node
/**
 * Fail closed if Firestore emulator is not running, then run emulator race suite.
 */
import { spawnSync } from "node:child_process";
import net from "node:net";

const hostEnv = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8081";
process.env.FIRESTORE_EMULATOR_HOST = hostEnv;
process.env.GOOGLE_CLOUD_PROJECT =
  process.env.GOOGLE_CLOUD_PROJECT ?? "truemandate-emulator";

const [host, portRaw] = hostEnv.split(":");
const port = Number(portRaw ?? "8081");

async function probe() {
  return new Promise((resolve) => {
    const socket = net.connect({ host: host ?? "127.0.0.1", port }, () => {
      socket.end();
      resolve(true);
    });
    socket.on("error", () => resolve(false));
    socket.setTimeout(1500, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

if (!(await probe())) {
  console.error(
    `Firestore emulator is not running at ${hostEnv}. Start it, then re-run.`,
  );
  process.exit(1);
}

const result = spawnSync(
  "pnpm",
  ["exec", "vitest", "run", "packages/cloud-firestore/src/firestore-emulator-races.test.ts"],
  { stdio: "inherit", env: process.env, shell: true },
);
process.exit(result.status ?? 1);
