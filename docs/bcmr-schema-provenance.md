# BCMR schema provenance

`src/bcmr-v2.schema.json` is the upstream generated Bitcoin Cash Metadata Registry
JSON Schema from https://github.com/bitjson/chip-bcmr/blob/master/bcmr-v2.schema.json,
retrieved 2026-11-15. This follows the upstream v2 schema including draft v2.1
`locales` support; it is not a newly invented metadata format.

The upstream specification's Copyright section states: “This document is placed
in the public domain.” See https://github.com/bitjson/chip-bcmr#copyright.

The bundled bytes, not a moving remote URL, are validated at runtime. Their digest
is recorded below; update deliberately with compatibility tests if upstream changes.
c8e2938bd6063dd2f51dedca710788775afdcddc48474d964e60ee840b9cd2e3  src/bcmr-v2.schema.json
