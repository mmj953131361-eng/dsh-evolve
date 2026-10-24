# Public repository workflow

- This repository distributes DSH Evo runtime source, installable packages, licenses and user/build documentation only.
- Never publish unit tests, fixtures, task cases, evaluation scripts, datasets, reports, raw runs, credentials or private project material. Do not merge private development history into this repository. Export reviewed runtime changes onto public master without importing private Git objects, branches or tags.
- Preserve DSH native component loading, session/project/Profile scope boundaries, concrete confirmation for shared changes, concurrent edits and exact-change undo. Arbitrary generated executable code is not automatically adopted.
- Run pnpm typecheck and pnpm build in dsh-evolve, then pack the bundle and run scripts/check-publication.py. Maintainers perform regression testing privately. No live model call is needed for build or publication checks.
- Keep source, manifests, installation instructions, release versions and third-party notices consistent. Never move or overwrite a release tag. Do not add automated coauthor trailers.
