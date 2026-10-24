# Third-party notices

Original Evo material is licensed under MIT (see LICENSE). The following material retains its upstream terms; the root MIT license does not replace them. Full license texts are shipped in `licenses/` (or `LICENSES/` inside the installable bundle).

## DeepSeek Harness — MIT

Source: https://github.com/deepseek-ai/deepseek-harness
Pinned reference: 687f282e8625c6b8d11ff58211a90524be2e4317
Copyright (c) 2026 DeepSeek

`dsh-evolve/packages/loop/` contains a modified copy of the Agent Loop. Modifications include its package name, import specifiers, pinned published dependencies and controlled variation markers.

The installed bundle inlines this material in its emitted JavaScript. Preserve the upstream MIT copyright and permission notice. Full license: `licenses/MIT-DeepSeek.txt` in this repository, `LICENSES/MIT-DeepSeek.txt` in the bundle. The standalone loop package carries the upstream text as LICENSE.

## Google Research Harness² — Apache-2.0

Source: https://github.com/google-research/harness2
Pinned reference: 1cfe254e8d25b15f37048c3730134686abe60335
Copyright 2026 Google LLC

Propose–Probe–Compose, the HarnessTree/SurfaceSpec model, evidence traces and Library experience shapes inform the implementation. The ordered selection criteria and the instruction not to equate length/polish with quality in `dsh-evolve/packages/core/src/selection.ts` are adapted from `core/prompts.py` (`select()` and `CONFORMANCE_BLOCK`). They are modified for JSON output, computed artifact evidence, quote verification and abstention. The source file retains a modification notice; the bundle includes the compiled selector.

No complete Harness² source file is vendored. Adapted material retains Apache-2.0 terms. Full license: `licenses/Apache-2.0.txt` in this repository, `LICENSES/Apache-2.0.txt` in the bundle. No upstream NOTICE file is present in the pinned reference root.

## Dependencies and attribution

Runtime dependencies retain their own licenses and are declared in package manifests and the lockfile. External reference checkouts, datasets, test suites, fixtures and evaluation materials are not part of this distribution.

This is an independent community project. References to DeepSeek and Google describe provenance and compatibility, not affiliation or endorsement.
