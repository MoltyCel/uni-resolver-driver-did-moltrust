// Run with: npm test  (node --test, so a failed assertion fails the process)
//
// The previous version of this file used console.assert, which only writes to
// stderr and leaves the exit status at 0 — "All tests passed." printed whether
// or not the assertions held. node:assert throws, and node --test reports it.
//
// Nothing here touches the network. The registry is a local stub on an ephemeral
// port, so the two cases below are tested, not described: a malformed
// identifier must not reach the network at all, and a 400 from the registry
// must arrive as invalidDid rather than internalError.
const assert = require("node:assert/strict");
const http = require("node:http");
const { test, before, after } = require("node:test");

let stub;
let stubCalls = [];
let stubStatus = 200;
let stubBody = JSON.stringify({
  "@context": ["https://www.w3.org/ns/did/v1"],
  id: "did:moltrust:d34ed796a4dc4698",
  metadata: { created: "2026-02-20T14:44:26Z" },
});

before(async () => {
  stub = http.createServer((req, res) => {
    stubCalls.push(req.url);
    res.writeHead(stubStatus, { "Content-Type": "application/json" });
    res.end(stubStatus === 404 ? "" : stubBody);
  });
  await new Promise((r) => stub.listen(0, "127.0.0.1", r));
  process.env.MOLTRUST_API = `http://127.0.0.1:${stub.address().port}`;
});

after(() => stub.close());

function load() {
  // Required after MOLTRUST_API is set, because the module reads it at load.
  delete require.cache[require.resolve("./index.js")];
  return require("./index.js");
}

test("a method-specific identifier outside [0-9a-f]{16} is invalidDid, with no network call", async () => {
  const { app } = load();
  stubCalls = [];
  for (const bad of [
    "did:moltrust:ambassador0001",      // letters outside a-f, the case from universal-resolver#541
    "did:moltrust:ABCDEF0123456789",    // uppercase
    "did:moltrust:0123456789abcde",     // 15 characters
    "did:moltrust:0123456789abcdef0",   // 17 characters
    "did:moltrust:ext_0123456789abcdef" // the ext_ prefix, which §2.2 does not define
  ]) {
    const res = await app.request(`/1.0/identifiers/${bad}`);
    assert.equal(res.status, 400, `${bad} should be 400`);
    const body = await res.json();
    assert.equal(body.didResolutionMetadata.error, "invalidDid", `${bad} should be invalidDid`);
    assert.equal(body.didDocument, null);
  }
  assert.deepEqual(stubCalls, [], "a malformed identifier must not reach the registry");
});

test("a 400 from the registry is invalidDid, not internalError", async () => {
  const { app } = load();
  stubStatus = 400;
  stubCalls = [];
  const res = await app.request("/1.0/identifiers/did:moltrust:0123456789abcdef");
  assert.equal(stubCalls.length, 1, "this identifier is well-formed, so the registry is called");
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.didResolutionMetadata.error, "invalidDid");
  assert.notEqual(body.didResolutionMetadata.error, "internalError");
  stubStatus = 200;
});

test("a well-formed identifier that resolves comes back as a DID document", async () => {
  const { app } = load();
  stubStatus = 200;
  const res = await app.request("/1.0/identifiers/did:moltrust:d34ed796a4dc4698");
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.didDocument.id, "did:moltrust:d34ed796a4dc4698");
  assert.equal(body.didResolutionMetadata.contentType, "application/did+ld+json");
  assert.equal(body.didDocumentMetadata.created, "2026-02-20T14:44:26Z");
});

test("404 from the registry stays notFound", async () => {
  const { app } = load();
  stubStatus = 404;
  const res = await app.request("/1.0/identifiers/did:moltrust:0000000000000000");
  assert.equal(res.status, 404);
  assert.equal((await res.json()).didResolutionMetadata.error, "notFound");
  stubStatus = 200;
});

test("any other registry status stays internalError", async () => {
  const { app } = load();
  stubStatus = 503;
  const res = await app.request("/1.0/identifiers/did:moltrust:0123456789abcdef");
  assert.equal(res.status, 500);
  assert.equal((await res.json()).didResolutionMetadata.error, "internalError");
  stubStatus = 200;
});

// ---------------------------------------------------------------------------
// The three behaviours carried over from server.js, which has been serving
// uresolver.moltrust.ch since 2026-09-20 while this driver was the published
// image. Without these, switching the service to the image would have dropped a
// field the live endpoint had been returning for six months and removed the only
// upstream timeout.
// ---------------------------------------------------------------------------

test("keyAnchor is passed through to didDocumentMetadata", async () => {
  stubStatus = 200;
  stubBody = JSON.stringify({
    "@context": ["https://www.w3.org/ns/did/v1"],
    id: "did:moltrust:d34ed796a4dc4698",
    metadata: {
      created: "2026-03-16T19:07:34Z",
      keyAnchor: { chain: "base", tx: "0xde579d2c", block: 43992036 },
    },
  });
  const { app } = load();
  const res = await app.request("/1.0/identifiers/did:moltrust:d34ed796a4dc4698");
  assert.equal(res.status, 200);
  const m = (await res.json()).didDocumentMetadata;
  assert.deepEqual(m.keyAnchor, { chain: "base", tx: "0xde579d2c", block: 43992036 },
    "the on-chain anchoring proof must survive resolution");
  assert.equal(m.created, "2026-03-16T19:07:34Z");
});

test("a document without keyAnchor does not grow an empty one", async () => {
  stubStatus = 200;
  stubBody = JSON.stringify({
    "@context": ["https://www.w3.org/ns/did/v1"],
    id: "did:moltrust:d34ed796a4dc4698",
    metadata: { created: "2026-03-16T19:07:34Z" },
  });
  const { app } = load();
  const res = await app.request("/1.0/identifiers/did:moltrust:d34ed796a4dc4698");
  const m = (await res.json()).didDocumentMetadata;
  assert.ok(!("keyAnchor" in m), "an absent anchor must not appear as null");
});

test("updated follows the registry when it carries one", async () => {
  stubStatus = 200;
  stubBody = JSON.stringify({
    "@context": ["https://www.w3.org/ns/did/v1"],
    id: "did:moltrust:d34ed796a4dc4698",
    metadata: { created: "2026-03-16T19:07:34Z", updated: "2026-09-01T10:00:00Z" },
  });
  const { app } = load();
  const res = await app.request("/1.0/identifiers/did:moltrust:d34ed796a4dc4698");
  const m = (await res.json()).didDocumentMetadata;
  assert.equal(m.updated, "2026-09-01T10:00:00Z");
  assert.equal(m.created, "2026-03-16T19:07:34Z");
});

test("a registry that never answers gives 504, not a request held open", async () => {
  // A second stub that accepts the connection and says nothing at all.
  const silent = http.createServer(() => {});
  await new Promise((r) => silent.listen(0, "127.0.0.1", r));
  const before = process.env.MOLTRUST_API;
  process.env.MOLTRUST_API = `http://127.0.0.1:${silent.address().port}`;
  process.env.UPSTREAM_TIMEOUT_MS = "300";
  try {
    const { app } = load();
    const started = Date.now();
    const res = await app.request("/1.0/identifiers/did:moltrust:0123456789abcdef");
    const took = Date.now() - started;
    assert.equal(res.status, 504, "a slow registry is a gateway timeout");
    const body = await res.json();
    assert.equal(body.didResolutionMetadata.error, "internalError");
    assert.match(body.didResolutionMetadata.message, /did not answer within/);
    assert.ok(took < 5000, `the request must not hang; it took ${took} ms`);
  } finally {
    silent.close();
    process.env.MOLTRUST_API = before;
    delete process.env.UPSTREAM_TIMEOUT_MS;
  }
});

test("/health reports the build commit, not only a version string", async () => {
  process.env.BUILD_COMMIT = "0757d3dcdd99aabbccddeeff00112233445566aa";
  try {
    const { app } = load();
    const res = await app.request("/health");
    assert.equal(res.status, 200);
    const b = await res.json();
    assert.equal(b.commit, "0757d3dcdd99aabbccddeeff00112233445566aa",
      "what runs must be checkable against the repository");
    assert.equal(b.status, "ok");
    assert.equal(b.driver, "did:moltrust");
  } finally {
    delete process.env.BUILD_COMMIT;
  }
});

test("/health says unknown rather than inventing a commit", async () => {
  delete process.env.BUILD_COMMIT;
  const { app } = load();
  const b = await (await app.request("/health")).json();
  assert.equal(b.commit, "unknown");
});
