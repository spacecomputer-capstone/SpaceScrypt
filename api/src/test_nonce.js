import { OrbitportSDK } from "@spacecomputer-io/orbitport-sdk-ts";

// With API credentials (tries API first, falls back to IPFS)
const sdkWithAPI = new OrbitportSDK({
  config: {
    clientId: process.env.OP_CLIENT_ID,
    clientSecret: process.env.OP_CLIENT_SECRET,
  },
});

const resultWithAPI = await sdkWithAPI.ctrng.random();
console.log(resultWithAPI.data.data);

// Without API credentials (uses IPFS only)
const sdkIPFSOnly = new OrbitportSDK({ config: {} });
const resultIPFSOnly = await sdkIPFSOnly.ctrng.random();
console.log(resultIPFSOnly.data.data);
