import fs from "node:fs";
import path from "node:path";

// beaconIdHex -> publicKeyHex
const REG = new Map<string, string>(); 

export function loadBeaconRegistry(file = path.join(process.cwd(), "config/beacons.json")) {
  REG.clear();
  if (!fs.existsSync(file)) {
    console.warn(`Beacon registry not found at ${file}. Using empty registry.`);
    return;
  }
  const raw = fs.readFileSync(file, "utf8");
  const obj = JSON.parse(raw) as Record<string, string>;

  for (const [beaconIdHex, publicKeyHex] of Object.entries(obj)) {
    if (!/^[0-9a-f]{16}$/i.test(beaconIdHex)) {
      throw new Error(`Bad beaconIdHex: ${beaconIdHex} (expect 16 hex chars)`);
    }
    if (!/^[0-9a-f]{64}$/i.test(publicKeyHex)) {
      throw new Error(`Bad publicKeyHex for ${beaconIdHex} (expect 64 hex chars)`);
    }
    REG.set(beaconIdHex.toLowerCase(), publicKeyHex.toLowerCase());
  }
  console.log(`Loaded ${REG.size} beacon(s) from beacons.json`);
}

export function getPublicKeyHex(beaconIdHex: string): string | undefined {
  return REG.get(beaconIdHex.toLowerCase());
}
