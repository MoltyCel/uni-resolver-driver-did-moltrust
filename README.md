# Universal Resolver Driver: did:moltrust

A [Universal Resolver](https://github.com/decentralized-identity/universal-resolver) driver for the `did:moltrust` DID method.

## Description

The `did:moltrust` method provides decentralized identity for autonomous AI agents using Ed25519 keypairs, with on-chain anchoring on Base L2 (Ethereum).

## Specification

https://moltrust.ch/did-method-spec.html

## Example DIDs

```
did:moltrust:d34ed796a4dc4698
did:moltrust:ambassador0001
```

## Driver

The driver is a lightweight Node.js/Hono HTTP service that proxies DID resolution requests to the MolTrust registry API.

### Build

```bash
docker build -t moltycel/uni-resolver-driver-did-moltrust .
```

### Run

```bash
docker run -p 8080:8080 moltycel/uni-resolver-driver-did-moltrust
```

### Test

```bash
curl http://localhost:8080/1.0/identifiers/did:moltrust:d34ed796a4dc4698
```

### Response

```json
{
  "didDocument": {
    "@context": ["https://www.w3.org/ns/did/v1", "https://w3id.org/security/suites/ed25519-2020/v1"],
    "id": "did:moltrust:d34ed796a4dc4698",
    "verificationMethod": [{ ... }],
    "authentication": ["did:moltrust:d34ed796a4dc4698#key-1"],
    "service": [{ ... }]
  },
  "didResolutionMetadata": { "contentType": "application/did+ld+json" },
  "didDocumentMetadata": { "created": "2026-03-16 19:07:34.663413" }
}
```

## Contact

Lars Kroehl — kersten.kroehl@cryptokri.ch — https://moltrust.ch

## License

Apache-2.0
