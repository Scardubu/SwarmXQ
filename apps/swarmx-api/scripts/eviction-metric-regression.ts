import assert from "node:assert";
import { getSwarmPressure, recordEviction } from "../src/services/swarm-pressure-monitor.js";

function main(): void {
  const before = getSwarmPressure(true).metrics.evictionCount;
  recordEviction();
  const afterOne = getSwarmPressure(true).metrics.evictionCount;
  assert.strictEqual(
    afterOne,
    before + 1,
    `evictionCount should increment by 1 (before=${before}, after=${afterOne})`,
  );

  recordEviction();
  const afterTwo = getSwarmPressure(true).metrics.evictionCount;
  assert.strictEqual(
    afterTwo,
    before + 2,
    `evictionCount should increment again (afterOne=${afterOne}, afterTwo=${afterTwo})`,
  );

  console.log("PASS: eviction metric tracking works as expected");
}

main();
