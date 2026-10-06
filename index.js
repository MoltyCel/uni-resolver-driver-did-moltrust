const { Hono } = require("hono");
const { serve } = require("@hono/node-server");
const https = require("https");
const http = require("http");

const app = new Hono();
const PORT = parseInt(process.env.PORT || "8080", 10);
const MOLTRUST_API = process.env.MOLTRUST_API || "https://api.moltrust.ch";
// Without this a hung registry holds the request open for as long as the socket
// lives. server.js, which has been serving uresolver.moltrust.ch since
// 2026-09-20, aborts after 5 s; this driver had no timeout at all.
const UPSTREAM_TIMEOUT_MS = parseInt(process.env.UPSTREAM_TIMEOUT_MS || "5000", 10);
// What answers /health. A commit is checkable against the repository; a version
// string is only as true as whoever last edited it, and the deployed service and
// the published image both claimed 1.0.0 while behaving differently.
const BUILD_COMMIT = process.env.BUILD_COMMIT || "unknown";

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
    // encodeURIComponent on a decoded DID, so the registry sees one consistent
    // form no matter which the caller used.
    const url = `${MOLTRUST_API}/identity/resolve/${encodeURIComponent(did)}`;
    const client = url.startsWith("http://") ? http : https;
    const req = client.get(url, {
      headers: { Accept: "application/json" },
      timeout: UPSTREAM_TIMEOUT_MS,
    }, (res) => {
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
    });
    req.on("timeout", () => {
      const err = new Error(`registry did not answer within ${UPSTREAM_TIMEOUT_MS} ms`);
      err.code = "upstreamTimeout";
      req.destroy(err);
    });
    req.on("error", reject);
  });
}

/**
 * Universal Resolver driver endpoint.
 * GET /1.0/identifiers/{did}
 */
// Any segment, not a pattern over the raw path. did%3Amoltrust%3A... is the same
// address as did:moltrust:... per RFC 3986, and a pattern that reads the raw path
// answers one and not the other - with a plain-text 404 carrying no resolution
// metadata at all, which is worse than a wrong code.
app.get("/1.0/identifiers/:did{.+}", async (c) => {
  // Hono hands back the raw segment, so decode here. A malformed escape is the
  // caller's problem and is reported as such rather than thrown.
  let did;
  try {
    did = decodeURIComponent(c.req.param("did"));
  } catch {
    return c.json(resolutionError("invalidDid", "the path is not valid percent-encoding"), 400);
  }

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
    const didDocumentMetadata = {
      created,
      // did:moltrust documents are immutable after registration, so updated
      // tracks created until mutable documents ship.
      updated: didDocument.metadata?.updated || created,
    };
    // The on-chain anchoring proof. The registry carries it under
    // metadata.keyAnchor; a resolver that drops it loses the one piece of this
    // method a relying party can check against a chain.
    if (didDocument.metadata?.keyAnchor) {
      didDocumentMetadata.keyAnchor = didDocument.metadata.keyAnchor;
    }
    const response = {
      didDocument,
      didResolutionMetadata: { contentType: JSON_LD },
      didDocumentMetadata,
    };

    return c.json(response, 200);
  } catch (err) {
    if (err.code === "invalidDid") {
      return c.json(resolutionError("invalidDid", err.message), 400);
    }
    if (err.code === "upstreamTimeout") {
      // 504, not 500: the registry was slow, and this driver is not the thing
      // that failed. server.js answered the same way.
      return c.json(resolutionError("internalError", err.message), 504);
    }
    return c.json(resolutionError("internalError", err.message), 500);
  }
});

app.get("/health", (c) => c.json({
  status: "ok",
  driver: "did:moltrust",
  // The commit this image was built from. A maintained version string told us
  // 1.0.0 for two different codebases that answered a malformed identifier
  // differently; a commit cannot do that.
  commit: BUILD_COMMIT,
  version: require("./package.json").version,
}));

// Only listen when run directly, so the tests can drive app.fetch in-process.
if (require.main === module) {
  serve({ fetch: app.fetch, port: PORT }, () => {
    console.log(`did:moltrust driver running on port ${PORT}`);
  });
}

module.exports = { app, METHOD_SPECIFIC_ID };
