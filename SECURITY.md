# Security Policy

## Scope & threat model

SP Downloader is meant to run **locally**, bound to `localhost`, for a single
user. It intentionally has no authentication. If you expose it on a network or
the internet you must put your own auth / TLS termination in front of it — doing
so without that is out of scope for this project.

The server spawns `yt-dlp` with a URL you provide. Treat the machine running it
as able to reach whatever that URL points at (respecting your proxy setting).

## Reporting a vulnerability

Please **do not** open a public issue for a security problem.

Instead, use GitHub's private
[**"Report a vulnerability"**](https://github.com/AmirHaddadi/SP-Downloader/security/advisories/new)
workflow, or email the maintainer listed on the GitHub profile.

You can expect an initial response within a few days. Please include:

- affected version / commit
- reproduction steps
- impact assessment

Thanks for helping keep the project safe.
