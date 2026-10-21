# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [0.2.0] - 2026-10-20

### Added

- The session's project directory, after the host: where Claude started, or where `/cd` moved
  it, with your home directory shortened to `~`. If it can't be read, it's left out and the
  rest of the row still shows.

### Documentation

- README: installing on the remote host, with the Claude Code copy the desktop app puts there
  (`~/.claude/remote/ccd-cli/`), is now the recommended way for remote hosts, with matching
  update and uninstall steps. Don't also install it on the desktop computer: installed in both
  places, the band doesn't show in SSH sessions.

## [0.1.0] - 2026-10-09

First public release.

### Added

- A row above the prompt with the host (`SSH <hostname> (<server ip>)` over SSH, the hostname
  otherwise), a RAM-in-use bar, and 5-hour and 7-day usage-limit bars with the time to reset.
- Green, yellow, orange and red at 70, 80 and 90 % used; the RAM bar at 30, 20 and 10 % free.
- Stale-reading markers: a window past its reset dims to `reset`, and a dim `<age> ago` follows
  the bars once the session's last reading is 5 minutes old.
- The repository is its own plugin marketplace.

[0.2.0]: https://github.com/RedRoosterKey/claude-code-ssh-usage-band/releases/tag/v0.2.0
[0.1.0]: https://github.com/RedRoosterKey/claude-code-ssh-usage-band/releases/tag/v0.1.0
