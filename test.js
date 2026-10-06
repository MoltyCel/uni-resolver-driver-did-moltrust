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
