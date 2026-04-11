const { Hono } = require("hono");
const { serve } = require("@hono/node-server");
const https = require("https");

const app = new Hono();
const PORT = parseInt(process.env.PORT || "8080", 10);
const MOLTRUST_API = process.env.MOLTRUST_API || "https://api.moltrust.ch";

/**
 * Fetch DID Document from MolTrust registry.
 */
function fetchDidDocument(did) {
  return new Promise((resolve, reject) => {
    const url = `${MOLTRUST_API}/identity/resolve/${encodeURIComponent(did)}`;
    https.get(url, { headers: { Accept: "application/json" } }, (res) => {
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
    return c.json({
      didDocument: null,
      didResolutionMetadata: { error: "invalidDid", contentType: "application/did+ld+json" },
      didDocumentMetadata: {},
    }, 400);
  }

  try {
    const didDocument = await fetchDidDocument(did);

    if (!didDocument) {
      return c.json({
        didDocument: null,
        didResolutionMetadata: { error: "notFound", contentType: "application/did+ld+json" },
        didDocumentMetadata: {},
      }, 404);
    }

    const created = didDocument.metadata?.created || null;
    const response = {
      didDocument,
      didResolutionMetadata: { contentType: "application/did+ld+json" },
      didDocumentMetadata: {
        created,
        updated: created,
      },
    };

    return c.json(response, 200);
  } catch (err) {
    return c.json({
      didDocument: null,
      didResolutionMetadata: { error: "internalError", message: err.message, contentType: "application/did+ld+json" },
      didDocumentMetadata: {},
    }, 500);
  }
});

app.get("/health", (c) => c.json({ status: "ok", driver: "did:moltrust", version: "1.0.0" }));

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`did:moltrust driver running on port ${PORT}`);
});
