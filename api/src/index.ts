import Fastify from "fastify";
import cors from "@fastify/cors";
import nacl from "tweetnacl";
import { z } from "zod";
import { bytesToHex, hexToBytes, buildMessage, randomNonce16 } from "./crypto.js";
import { loadBeaconRegistry, getPublicKeyHex } from "./registry.js";
import swagger from "@fastify/swagger";
import swaggerUI from "@fastify/swagger-ui";
import Ajv from "ajv";
import addFormats from "ajv-formats";

const app = Fastify();
await app.register(cors, { origin: true });

const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addKeyword('example');
app.setValidatorCompiler(({ schema }) => ajv.compile(schema));

loadBeaconRegistry();

// swagger
await app.register(swagger, {
  openapi: {
    info: { title: "Spacecomputer API (MVP)", version: "0.0.1" },
    servers: [{ url: "http://localhost:8787" }]
  }
});
await app.register(swaggerUI, { routePrefix: "/docs", staticCSP: true });

// GET /api/nonce -> { nonceHex }
app.get("/api/nonce", {
  schema: {
    tags: ["nonce"],
    description: "Returns a 16-byte random nonce as lowercase hex (32 chars).",
    response: {
      200: {
        type: "object",
        properties: {
          nonceHex: {
            type: "string",
            pattern: "^[0-9a-f]{32}$",
            example: "0123456789abcdef0123456789abcdef" 
          }
        },
        required: ["nonceHex"],
        additionalProperties: false
      }
    }
  }
}, async (_req, res) => {
  const nonce = randomNonce16();
  return res.send({ nonceHex: bytesToHex(nonce) });
});

// POST /api/verify -> { ok }
app.post("/api/verify", {
  schema: {
    tags: ["verify"],
    description: "Verify Ed25519 signature over message = nonce(16) || ts_be64(8).",
    body: {
      type: "object",
      properties: {
        beaconIdHex: {
          type: "string",
          pattern: "^[0-9a-fA-F]{16}$",
          example: "a1b2c3d4e5f60708"
        },
        nonceHex: {
          type: "string",
          pattern: "^[0-9a-fA-F]{32}$",
          example: "0123456789abcdef0123456789abcdef"
        },
        tsMs: {
          type: "string",
          pattern: "^[0-9]+$",
          example: "1739550123456"
        },
        sigHex: {
          type: "string",
          pattern: "^[0-9a-fA-F]{128}$",
          example: "00".repeat(64) 
        }
      },
      required: ["beaconIdHex", "nonceHex", "tsMs", "sigHex"],
      additionalProperties: false,
    },
    response: {
      200: {
        type: "object",
        properties: { ok: { type: "boolean", example: true } },
        required: ["ok"],
        example: { ok: true }
      },
      400: {
        type: "object",
        properties: {
          ok: { type: "boolean", const: false, example: false },
          error: { type: "string", example: "unknown_beacon" }
        },
        required: ["ok", "error"],
        example: { ok: false, error: "unknown_beacon" }
      }
    }
  }
}, async (req, res) => {
  const body = z.object({
    beaconIdHex: z.string().regex(/^[0-9a-f]{16}$/i, "beaconId must be 8 bytes hex"),
    nonceHex:    z.string().regex(/^[0-9a-f]{32}$/i,   "nonce must be 16 bytes hex"),
    tsMs:        z.string().regex(/^[0-9]+$/,          "tsMs must be a decimal string"),
    sigHex:      z.string().regex(/^[0-9a-f]{128}$/i,  "signature must be 64 bytes hex")
  }).parse(req.body);

  const pubHex = getPublicKeyHex(body.beaconIdHex);
  if (!pubHex) {
    return res.code(400).send({ ok: false, error: "unknown_beacon" });
  }

  const msg = buildMessage(body.nonceHex, body.tsMs);
  const sig = hexToBytes(body.sigHex);
  const pub = hexToBytes(pubHex);

  const valid = nacl.sign.detached.verify(msg, sig, pub);
  return res.send({ ok: !!valid });
});



const PORT = Number(process.env.PORT || 8787);
app.listen({ host: "0.0.0.0", port: PORT })
  .then(() => console.log(`API listening on http://localhost:${PORT} (docs at /docs)`))
  .catch((e) => { console.error(e); process.exit(1); });
