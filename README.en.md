# dsh-git-panel

[中文](README.md) · [Español](README.es.md)

A Git panel plugin for the DSH Web GUI: branch management (switch / pull / fetch / rename / delete / merge) plus a GitLens-style commit graph.

## Features

- **Branch panel** (right side of the chat):
  - **Two-row card layout**: branch names take the full top row without being truncated, while commit timestamps and messages sit on a dedicated second row
  - **Instant search & filter**: quick search box at the top of the branch list to filter branches and commit messages in real time
  - Local branches: current branch highlighted, `↑ahead / ↓behind` against upstream, **double-click to switch** (double-click the current branch to pull)
  - Remote branches: **double-click to check out** (creates a local tracking branch automatically)
  - Right-click menu: **pull updates / fetch all / copy branch name / rename / delete / merge into current branch** (remote branches get delete-remote instead)
  - One-click **pull** of the current branch, **fetch all** (`git fetch --all --prune`)
- **Branch chip** (above the input box): shows the current branch; click to open a local-branch list for quick switching
- **Git graph**: commit DAG lanes, three-column header (Lanes / Commit / Branch), the commit column is resizable from both sides (width persisted), click a node for commit details; virtualized rendering — only the visible viewport is drawn, so large repositories scroll smoothly
- **Write bar** (top of the panel, under the tabs):
  - **Commit**: type a message and press Enter → `git add -A && git commit -m`
  - **Generate commit message**: the generate button inside the right end of the message field (Lucide "sparkles" semantics, drawn from the plugin's single `icon()` set) reads the **staged** changes, hands them to your current default model together with the repository's recent commit subjects, and writes the generated message back into the field (an existing draft is replaced). With an empty staging area it reports that instead of generating; on failure it reports the failure and **leaves whatever you had typed untouched**
  - **Multi-line message**: the field is an auto-growing textarea, so a generated message (subject + body) wraps instead of scrolling sideways; `Enter` commits, `Shift+Enter` inserts a newline
  - **Push**: one-click `git push` of the current branch
  - **Stash / pop**: `git stash push` (optional message) / `git stash pop`
  - **Status**: shows the number of changed files (`git status --porcelain`)
- **Changes + syntax-colored Diff**: uncommitted changed files are listed under the write bar (status code + path); click any file to view its full diff against HEAD with line-by-line coloring (green + for additions, red - for deletions, blue @@ for hunks) — review changes clearly before committing
- **Batch staging**: each group header ("Staged Changes" / "Changes") carries a batch button (**Unstage all** / **Stage all**) that acts on every file in that group; it reuses the existing per-file API and runs serially to avoid contending for git's index lock, and reports how many files succeeded if one fails midway
- **File-tree change badges (VS Code look)**: in the right sidebar's "Files" tree, changed files carry a status letter right after the name and a tinted filename (`M` modified / `A` added / `U` untracked / `D` deleted / `R` renamed / `C` conflicted), and directories containing changes get a dot; badges refresh automatically with `git status`, no manual tree reload needed
- **Git diff view (VS Code-style side-by-side)**: click a changed file to open its diff in the right sidebar
  - HEAD on the left, working tree on the right, line numbers strictly aligned, with additions / deletions / modifications colored separately
  - **Split / unified** layouts, **collapse unchanged regions** (3 lines of context, click to expand), **word wrap** toggle, **font zoom**, and a **manual edit** mode
  - The header shows `+added / −removed` counts; "Source" returns to the official text preview, "Stage" runs `git add`, "Save" writes back to the workspace
  - Only files that **actually have changes** are claimed by this view; untouched files keep using the official preview, so the two never interfere
- **Full-Context Merge-Conflict Resolution**:
  - Immediately centers the conflict block on the first screen with 8 lines of clear surrounding code context; distant code collapses gracefully with line numbers preserved.
  - Automatically identifies `<<<<<<<` / `=======` / `>>>>>>>` markers with **Accept Current (HEAD)**, **Accept Incoming (branch)**, and **Accept Both** one-click actions.
  - Saving writes changes back and automatically resolves the conflicted state.
- **Zero-Terminal In-Place Credential Setup**:
  - Automatically detects missing credentials for private GitLab/GitHub instances and prompts with an elegant in-place modal to save username/tokens without touching the CLI.
- **VS Code-Grade Intelligent Sync**:
  - Pushes directly when ahead, pulls only when behind; completely eliminates forced `--rebase` and prevents artificial rebase conflicts.
  - Automatic `rebase --abort` recovery from interrupted rebase states.
- **Context-Aware Multilingual Prompt Injection**:
  - Dynamically changes to "💬 Send conflict analysis to chat" when conflicts are detected, composing targeted diagnostic prompts in English, Chinese, and Spanish.
  - Full compatibility with the latest DSH Lexical rich text composer.
- **Fast Actions & Reentrancy Guards**:
  - Clickable behind (`↓101`) badge for instant pulling.
  - Right-click menu with Pull & Fetch-all options, busy locks, and a **cancel** button that really kills the background git process.
- **Unified icon set + instant tooltips**: every icon comes from one in-plugin library (same 16x16 grid, same stroke width, same rounded caps), so nothing looks out of place; hovering any icon button shows its description **immediately** (not the browser's ~1s native `title` delay).
- **Graph commit actions**: click a commit node in the graph to **cherry-pick it onto the current branch** or **revert it** (`git revert --no-edit`)
- **Multilingual**: follows the DSH Web UI language (Chinese / English); Spanish browsers automatically get Spanish copy; defaults to Simplified Chinese
- **Native right-sidebar tab**: the Git panel is a first-class tab beside the built-in "Files" tab — expand, collapse, width dragging, and tab switching are all owned by the official sidebar, with no page-layout rewriting
- Follows the current session's working directory: re-binds automatically when switching project sessions
- Light / dark theme follows the DSH Web GUI

## Screenshots

**File-tree change badges** — changed files carry a status letter after the name and a tinted filename, and directories with changes get a dot, just like VS Code's Explorer:

![File tree change badges](docs/git-filetree-status.png?v=0.1.18)

**Git diff view** — full-width side-by-side diff with aligned line numbers, collapsible unchanged regions, and change statistics plus actions in the header:

![Git diff view](docs/git-diff-split.png?v=0.1.18)

**Merge-conflict resolution with full context** — the conflict and its surrounding code (8 lines either side, with line numbers) land on the first screen, while distant conflict-free regions stay folded; three one-click actions, and saving writes the result back:

![Merge conflict resolution](docs/git-conflict-resolve.png?v=0.1.18)

**Native tab in the right sidebar** — Git sits beside the built-in "Files" tab, and the sidebar owns expand/collapse, width drag, and tab switching:

![Git tab in the right sidebar](docs/sidebar-tab.png?v=0.1.18)

**Branch panel** (local/remote branches, ahead/behind, double-click to switch, right-click menu):

![Branch panel](docs/branches.png?v=0.1.18)

**Branch chip** (quick branch switching above the input box):

![Branch chip](docs/chip.png?v=0.1.18)

**Commit graph** (resizable three-column layout, virtualized scrolling):

![Commit graph](docs/graph.png?v=0.1.18)

## Installation

```sh
dsh plugin --profile web add dsh-git-panel
```

Restart `dsh web`, open a project session bound to a git repository, then open the right sidebar (top-right) and pick the **Git** tab.

> **Runtime requirements**: this needs the **current DSH Web** (`>=0.1.5-alpha.1`, `0.1.6-alpha.1` or newer recommended, i.e. the release that introduced the right-sidebar multi-tab framework `@deepseek-ai/dsh-client-ui-sidebar-right`).
> The file-tree change badges and the Git diff tab rely on the right sidebar's tab-type registry and the `dsh-resource://file` address model; the "switch to Git diff inside the official file preview" entry additionally relies on DSH's own `@deepseek-ai/dsh-client-ui-sidebar-documentpreview` (bundled by default since 0.1.5).
> On older DSH builds (for example `0.1.2-rc.1`) these features do nothing — those versions have no right-sidebar tab registry and no unified file-address model.

> For local development, install via a link instead: `dsh plugin --profile web add link:/path/to/dsh-git-panel`. After editing source, run `npm run build` and refresh the page to see changes.

## Feedback

Found a bug or have a feature request? Open an issue on [GitHub Issues](https://github.com/a792883583/dsh-git-panel/issues) — your feedback helps us make the plugin better.

## License

MIT
