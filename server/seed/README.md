# `server/seed/` — local offline fallbacks

The application can use point-in-time JSON snapshots as a last-resort fallback
when a live provider is unreachable. Snapshot payloads are local runtime data,
not source code: every `server/seed/*.json` file is git-ignored and excluded
from the public distribution.

Generate snapshots for a local installation with:

```sh
node server/tools/make-seeds.mjs
node server/tools/make-macro-seeds.mjs
node server/tools/retry-seeds.mjs
```

The tools write the provider and capture time into each payload. Anyone who
generates, stores, or redistributes a snapshot is responsible for following the
relevant provider terms. A fresh clone runs against live sources without these
optional files; forced offline mode requires locally generated snapshots.
