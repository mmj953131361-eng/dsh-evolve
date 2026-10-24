# Security

## Reporting

Please use the repository's **Security → Report a vulnerability** flow for vulnerabilities, exposed credentials, filesystem escape, or adoption/approval bypass:

https://github.com/mmj953131361-eng/dsh-evolve/security/advisories/new

Do not post working exploits, secrets or private task snapshots in public issues. If private reporting is unavailable, open an issue requesting a private reporting channel without including sensitive details. Maintainers will assess reports on a best-effort basis; there is no guaranteed response SLA.

## Supported versions

The latest preview on `master` receives security fixes. Historical tags are immutable and are not maintained production releases. Install the latest reviewed preview and follow DSH's own security guidance.

## Runtime boundaries

Evo performs additional calls to your configured model provider and captures task inputs locally. Review what is in the workspace before using it with sensitive material. Exclusion rules reduce credential capture but do not make arbitrary project content safe to disclose.

Candidate probes use restricted local file tools; this is not a general-purpose sandbox for untrusted generated code. Session text/native-skill changes may apply automatically with undo. Project changes require concrete review, and Profile changes require explicit target confirmation. Generated code, plugins and Loop changes are not automatically adopted. Report any path that bypasses these boundaries.

Credentials belong in the runtime environment or the model provider's credential store, never in task prompts, harnesses, reports or this repository. `.dsh-evolve/`, `.env` and raw evaluation runtimes must remain untracked. If a real key is exposed, revoke/rotate it promptly; removing the latest file does not erase Git history.

Uninstalling the plugin does not itself reverse reviewed project/Profile changes or erase task history. Use the specific undo flow first and preserve evidence needed to understand conflicts.
