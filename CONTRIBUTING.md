# Building DSH Evo

直接使用插件请看 [Quickstart](docs/quickstart.md)。欢迎提交问题、文档修正和运行源码 PR。

## Build from source

Requirements: Node `^22.19.0 || >=24`, `pnpm@11.28.5`, Git and Python 3 for publication checks.

```sh
git clone https://github.com/mmj953131361-eng/dsh-evolve.git
cd dsh-evolve/dsh-evolve
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
mkdir -p dist
pnpm --filter @dsh-evolve/bundle pack --pack-destination "$PWD/dist"
python3 ../scripts/check-publication.py dist/dsh-evolve-bundle-0.2.2-dev.10.tgz
```

No live model or credential is needed for these checks. Install the generated bundle only in a separate DSH Profile.

## Public content boundary

This repository distributes runtime source, installable packages, licenses and user/build documentation. Unit tests, fixtures, task cases, evaluation scripts, datasets, reports and raw runs are maintained privately and must not be added to public commits, PRs, issues or release assets. Build and publication checks do not establish model quality. Maintainers run applicable private regression checks before accepting behavioral changes.

## Changes

Fork and branch from `master`, describe the user-visible problem and resulting behavior, and report the checks run and their limits. Preserve DSH native loading semantics, scope-specific confirmation, version checks, concurrent user edits and exact-change undo. A queued job is not a completed improvement. Keeping the baseline is valid.

Do not upload credentials, `.env`, personal project materials, `.dsh-evolve/` state or provider traces. Never merge private development history into the public repository: export reviewed runtime changes onto public `master`. Keep release tags immutable. See [AGENTS.md](AGENTS.md) and [SECURITY.md](SECURITY.md).

## License

Original contributions use this project's MIT license; retain upstream copyright, license and modification notices where applicable. Only contribute material you have the right to distribute. No separate CLA is required.
