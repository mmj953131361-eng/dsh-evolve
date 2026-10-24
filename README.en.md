# DSH Evo

**Our vision: let DSH evolve its harness as it works, and hot-load validated improvements into the agent.**

[中文](README.md) · [User Quickstart (中文)](docs/quickstart.md) · [Downloads](https://github.com/mmj953131361-eng/dsh-evolve/releases)

Evo observes grounded requirements and delivery evidence, proposes candidate harnesses, executes them against frozen inputs, composes a new harness from their evidence, and independently reruns it before selection. Keeping the baseline is a valid outcome.

## Use the plugin

You do not need to build this repository to try Evo.

1. Prepare DSH **`0.2.1-rc.2`** with a working model route. See the [DSH project](https://github.com/deepseek-ai/deepseek-harness).
2. Download `dsh-evolve-bundle-0.2.2-dev.10.tgz` from [Releases](https://github.com/mmj953131361-eng/dsh-evolve/releases).
3. Install it into the Profile you actually use (for example, `desktop`):

   ```sh
   dsh plugin --profile desktop add /absolute/download/path/dsh-evolve-bundle-0.2.2-dev.10.tgz
   ```

4. Restart that Profile, open a local project and a fresh conversation, then work normally. The Evo entry shows learning status, changes and undo. A queued job has not executed yet; KEEP_BASE means no challenger was adopted.

For a separate Web instance, use `dsh --profile evo-demo --from-default-profile web` once to initialize it, stop that instance, install the tarball with `--profile evo-demo`, then restart using `dsh --profile evo-demo`. Do not repeat the template-reset flag on an existing Profile.

On macOS, if `dsh` is not on PATH, the desktop installation provides `/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh`.

## How evolution works and takes effect

Evo observes task requirements and delivery evidence, proposes candidates, executes them against frozen inputs, composes a new strategy and independently reruns it. The selected result may replace the current strategy, or keep the baseline. Validated changes then follow the scope-specific rules below.

| Scope | Adoption | Loading |
|---|---|---|
| Session | Supported text/native skills can apply automatically, with exact-change undo; review mode is optional | Next request; skill bodies load on demand |
| Project | Concrete diff review and confirmation required | Managed instructions/skill files; verify in a new session |
| Profile | Explicit target and scope confirmation required | Native configuration; restart may be required |

Dismissing a review never approves it. User-owned content and concurrent edits are preserved. Supported components currently cover instructions, task context, memory text and native skills. Arbitrary tools, plugins, MCP, permissions and Loop code are not automatically evolved.

Pause using the panel's advanced menu or `/evolve off`; `/evolve on` resumes learning without reviving cancelled experiments. Undo is available for specific adopted changes. Uninstall with `dsh plugin --profile desktop remove @dsh-evolve/bundle` and restart. Review/undo adopted project or Profile changes separately before uninstalling.

## Documentation

See the [user Quickstart](docs/quickstart.md), [advanced installation guide](dsh-evolve/docs/install.md), [build instructions](CONTRIBUTING.md) and [security policy](SECURITY.md).

## License and acknowledgements

Original Evo work is [MIT licensed](LICENSE). Third-party material retains its respective terms; see [NOTICE](NOTICE), [third-party notices](THIRD_PARTY_NOTICES.md) and [licenses/](licenses/).

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) provides the host and the MIT-licensed Agent Loop code adapted here. [Google Research Harness²](https://github.com/google-research/harness2) informs the Propose–Probe–Compose and experience methodology; adapted selector instructions retain Apache-2.0 terms. Pinned sources are recorded in [references.lock.json](references.lock.json).

This is an independent community project, without affiliation or endorsement from DeepSeek or Google.
