import { OrbitportSDK } from "@spacecomputer-io/orbitport-sdk-ts";

// Helper function to validate bit length
const validate64Bit = (source: string, hexValue: string) => {
  if (!hexValue) {
    console.error(`[${source}] ❌ Error: No value received.`);
    return;
  }

  // standard hex string cleanup
  const cleanHex = hexValue.replace(/^0x/, ""); 
  const charLength = cleanHex.length;
  
  // 1 Hex char = 4 bits. Therefore 64 bits = 16 chars.
  const bitLength = charLength * 4; 

  if (bitLength !== 64) {
    console.error(`\n[${source}] ❌ Bit-length Mismatch Error`);
    console.error(`   Expected: 64-bit (16 hex chars)`);
    console.error(`   Received: ${bitLength}-bit (${charLength} hex chars)`);
    console.error(`   Value:    ${cleanHex}`);
  } else {
    console.log(`\n[${source}] ✅ Success: Valid 64-bit value received.`);
    console.log(`   Value:    ${cleanHex}`);
  }
};

// 1. With API credentials
const sdkWithAPI = new OrbitportSDK({
  config: {
    clientId: process.env.OP_CLIENT_ID,
    clientSecret: process.env.OP_CLIENT_SECRET,
  },
});

console.log("--- Testing API Mode ---");
try {
  const resultWithAPI = await sdkWithAPI.ctrng.random();
  validate64Bit("API Mode", resultWithAPI.data.data);
} catch (error) {
  console.error("[API Mode] Request failed:", error);
}

// 2. Without API credentials (IPFS Only)
const sdkIPFSOnly = new OrbitportSDK({ config: {} });

console.log("\n--- Testing IPFS Mode ---");
try {
  const resultIPFSOnly = await sdkIPFSOnly.ctrng.random();
  validate64Bit("IPFS Mode", resultIPFSOnly.data.data);
} catch (error) {
  console.error("[IPFS Mode] Request failed:", error);
}
