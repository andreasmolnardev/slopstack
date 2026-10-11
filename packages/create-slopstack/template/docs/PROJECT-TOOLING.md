# Create And Upgrade Projects

## Create

After the `create-slopstack` package is published or available from your
configured package registry, create a project with:

```sh
pnpm create slopstack my-app
cd my-app
pnpm install
pnpm dev
```

The project name must use lowercase letters, numbers, and hyphens. The generator
uses it for the app title, Go module path (`github.com/your-org/<name>`), web
package name, CLI name, Docker data volume, and environment prefix. For example,
`my-app` uses `MY_APP_*`. Change the Go module path to your own hosting
organization before publishing your code.

The generator claims a new destination directory exclusively and refuses an
existing path. If a file write fails, it leaves the partial directory in place
for inspection; it never recursively removes the destination. Create the
destination's parent directory first. It includes a
`.slopstack/template-lock.json` and the `.slopstack/template-base/` snapshot
used by the upgrade tool. The lock stores a SHA-256 checksum for every saved
base file, and upgrade stops before planning if a checksum or snapshot file
does not match. PocketBase data directories are not copied or migrated.

When working from this repository before publishing the package, use:

```sh
node packages/create-slopstack/bin/create.js my-app
node packages/create-slopstack/bin/slopstack.js upgrade --dry-run
```

## Upgrade

Install the CLI package once, then preview and apply safe changes:

```sh
pnpm add --global create-slopstack
pnpm slopstack upgrade --dry-run
pnpm slopstack upgrade
```

The tool compares each file with its saved template base. It updates or removes
files only when the current file still matches that base. It adds new template
files only when the target path is free. Locally edited files and new-file
collisions are reported and left as they are. Safe changes can still apply when
other files conflict. The template version advances only after every conflict
is clear. If you keep a custom version of a conflicted file, the conflict stays
visible on later runs; review and merge that file yourself.

The packaged template version follows the `create-slopstack` package version.
Projects created from one version keep a per-file base snapshot, so an upgrade
does not need to rewrite that snapshot before showing a preview.

## Roll Back

Commit or stash current work before upgrading, then inspect the generated diff
and commit the upgrade separately. To undo a committed upgrade, use
`git revert <upgrade-commit>`. For an uncommitted upgrade, restore only the
paths listed by the preview after checking that those paths contain no later
work. Do not use `git reset --hard` as an upgrade rollback.

The upgrader is a file-level three-way comparison. It does not merge source
code, modify PocketBase data, run migrations, install dependencies, or resolve
conflicts in custom files.

For the `slopstack.yaml` schema and dry-run deploy/release commands, see
[`DEPLOYMENT.md`](DEPLOYMENT.md).
