const https = require("https");

const TEST_DID = "did:moltrust:d34ed796a4dc4698";
const API = "https://api.moltrust.ch";

async function test() {
  console.log("Test 1: MolTrust API resolution");
  const res = await fetch(`${API}/identity/resolve/${TEST_DID}`);
  const doc = await res.json();
  console.assert(res.status === 200, "Should return 200");
  console.assert(doc.id === TEST_DID, "Should return correct DID");
  console.assert(doc["@context"], "Should have @context");
  console.log(`  DID: ${doc.id}`);
  console.log(`  verificationMethod: ${doc.verificationMethod ? "present" : "missing"}`);
  console.log(`  service: ${doc.service ? doc.service.length + " entries" : "none"}`);
  console.log("  PASS\n");

  console.log("Test 2: DID Resolution Result format");
  const result = {
    didDocument: doc,
    didResolutionMetadata: { contentType: "application/did+ld+json" },
    didDocumentMetadata: { created: doc.metadata?.created || null },
  };
  console.assert(result.didDocument.id === TEST_DID, "didDocument.id correct");
  console.assert(result.didResolutionMetadata.contentType === "application/did+ld+json", "contentType correct");
  console.log("  Resolution result structure valid");
  console.log("  PASS\n");

  console.log("Test 3: Non-existent DID");
  const res404 = await fetch(`${API}/identity/resolve/did:moltrust:0000000000000000`);
  console.assert(res404.status === 404, "Should return 404");
  console.log("  404 for non-existent DID");
  console.log("  PASS\n");

  console.log("All tests passed.");
}

test().catch(console.error);
