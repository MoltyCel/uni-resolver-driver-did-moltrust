const { Hono } = require("hono");
const { serve } = require("@hono/node-server");
const https = require("https");
const http = require("http");

const app = new Hono();
const PORT = parseInt(process.env.PORT || "8080", 10);
const MOLTRUST_API = process.env.MOLTRUST_API || "https://api.moltrust.ch";

// §2.2 of the did:moltrust method spec: the method-specific identifier is a
// lowercase hexadecimal string of exactly 16 characters.
//   method-specific-id := [0-9a-f]{16}
// Checking it here means a malformed identifier never reaches the network, and
// the caller gets invalidDid instead of a failure that looks like ours.
const METHOD_SPECIFIC_ID = /^did:moltrust:[0-9a-f]{16}$/;

const JSON_LD = "application/did+ld+json";

function resolutionError(error, message) {
  const metadata = { error, contentType: JSON_LD };
  if (message) metadata.message = message;
  return { didDocument: null, didResolutionMetadata: metadata, didDocumentMetadata: {} };
}

/**
 * Fetch DID Document from MolTrust registry.
 *
 * A 400 from the registry means it rejected the identifier, which is the
 * caller's problem and not ours. It is rejected with code "invalidDid" so the
 * handler can say so; everything else stays an internal error.
 */
function fetchDidDocument(did) {
  return new Promise((resolve, reject) => {
    const url = `${MOLTRUST_API}/identity/resolve/${encodeURIComponent(did)}`;
    const client = url.startsWith("http://") ? http : https;
    client.get(url, { headers: { Accept: "application/json" } }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if (res.statusCode === 200) {
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error("Invalid JSON from registry"));
          }
        } else if (res.statusCode === 404) {
          resolve(null);
        } else if (res.statusCode === 400) {
          const err = new Error("registry rejected the identifier");
          err.code = "invalidDid";
          reject(err);
        } else {
          reject(new Error(`Registry returned ${res.statusCode}`));
        }
      });
    }).on("error", reject);
  });
}

/**
 * Universal Resolver driver endpoint.
 * GET /1.0/identifiers/{did}
 */
app.get("/1.0/identifiers/:did{did:moltrust:.+}", async (c) => {
  const did = c.req.param("did");

  if (!did || !did.startsWith("did:moltrust:")) {
    return c.json(resolutionError("methodNotSupported"), 400);
  }

  // Syntax before network, per §2.2.
  if (!METHOD_SPECIFIC_ID.test(did)) {
    return c.json(
      resolutionError("invalidDid", "method-specific identifier is not [0-9a-f]{16} (spec §2.2)"),
      400,
    );
  }

  try {
    const didDocument = await fetchDidDocument(did);

    if (!didDocument) {
      return c.json(resolutionError("notFound"), 404);
    }

    const created = didDocument.metadata?.created || null;
    const response = {
      didDocument,
      didResolutionMetadata: { contentType: JSON_LD },
      didDocumentMetadata: {
        created,
        updated: created,
      },
    };

    return c.json(response, 200);
  } catch (err) {
    if (err.code === "invalidDid") {
      return c.json(resolutionError("invalidDid", err.message), 400);
    }
    return c.json(resolutionError("internalError", err.message), 500);
  }
});

app.get("/health", (c) => c.json({ status: "ok", driver: "did:moltrust", version: "1.1.0" }));

// Only listen when run directly, so the tests can drive app.fetch in-process.
if (require.main === module) {
  serve({ fetch: app.fetch, port: PORT }, () => {
    console.log(`did:moltrust driver running on port ${PORT}`);
  });
}

module.exports = { app, METHOD_SPECIFIC_ID };
