# Prompt Snippets for DSH

[简体中文](README.zh-CN.md)

[![CI](https://github.com/dadazhangn/dsh-prompt-snippets/actions/workflows/ci.yml/badge.svg)](https://github.com/dadazhangn/dsh-prompt-snippets/actions/workflows/ci.yml) [![npm version](https://img.shields.io/npm/v/dsh-prompt-snippets)](https://www.npmjs.com/package/dsh-prompt-snippets) [![npm downloads](https://img.shields.io/npm/dm/dsh-prompt-snippets)](https://www.npmjs.com/package/dsh-prompt-snippets) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Stop retyping the prompts you use every day.** Save them once, fill in the changing details, and insert them into the DSH composer in a click. If it saves you time, [star the repository](https://github.com/dadazhangn/dsh-prompt-snippets) or share it with another DSH user.

Prompt Snippets is a local-first prompt library for [DeepSeek Harness (DSH)](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin). Organize reusable prompts with categories, tags, and favorites; use `{{placeholders}}` for project-specific details; and find the right snippet from a searchable panel or keyboard shortcut.

> **Your prompts stay on your device.** Snippets are stored in your local DSH data directory. Nothing is sent to a server unless you choose **AI Optimize**, which sends the selected snippet to the model service configured in DSH.

## See how it works

1. Save a prompt such as `Review this code for {{language}} bugs: {{code}}`.
2. Search your library and click the snippet you need.
3. Fill in its variables; the completed prompt goes straight into the composer.

The panel supports browsing, editing, and organizing your snippets without leaving the conversation. For a quick lookup, press **Ctrl+Shift+K** and search from anywhere.

Use **↑/↓** to choose a snippet and **Enter** to open its placeholder form. In the form, **Tab / Shift+Tab** moves between fields, **Ctrl+Enter** inserts and sends, and **Esc** closes it. If a required field is empty, **Ctrl+Enter** focuses the first missing field instead.

## Install

### From the DSH plugin store

Find **Prompt Snippets** in the [awesome-dsh-plugin catalog](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin). The catalog entry points to this GitHub repository, so it installs the repository version.

### With DSH

Install the published npm package:

```bash
dsh plugin --profile web add dsh-prompt-snippets
```

Replace `web` with the profile you use. After installation, restart DSH and reload the page. The **📋 Snippets** button appears in the composer toolbar.

### From GitHub

To install the latest repository code directly:

```bash
dsh plugin --profile web add github:dadazhangn/dsh-prompt-snippets
```

GitHub installs follow the repository; npm installs follow the published package version. For local development, install a checkout with `dsh plugin --profile web add link:C:/path/to/dsh-prompt-snippets`.

**Requirements:** DSH `>=0.2.1-rc.3`.

## Try it

Create a reusable code-review prompt. `/snippet add` uses the first word as the name, so use a hyphen between words:

```text
/snippet add Review-code Review this {{language}} code for bugs and security issues: {{code}} --cat=Development
```

Then click **📋 Snippets** beside the composer, choose **Review-code**, fill in `language` and `code`, and insert the finished prompt. You can also create and edit snippets directly in the panel, where names may contain spaces.

Useful commands:

| Command | What it does |
|---|---|
| `/snippet list` | List saved snippets |
| `/snippet add <name> <content>` | Create or update a snippet |
| `/snippet show <name>` | View a snippet and its revision |
| `/snippet pin <name-or-id>` | Pin a favorite to the top |
| `/snippet tag <name-or-id> <tags>` | Add searchable tags |
| `/snippet optimize <name>` | Open an AI-assisted rewrite for review |
| `/snippet export [file]` | Export snippets to JSON |
| `/snippet import <file>` | Import snippets from JSON |

Commands that treat the remaining input as a name accept spaces. `/snippet add` and `/snippet tag` use the first word as the name; use a hyphen or underscore for multiword names in those commands, or create them in the panel. If a name collides, commands report candidates so you can select the intended snippet.

## Why use it?

- **Get to the prompt quickly.** Search by name, category, tag, or content. Use the floating library or the global keyboard palette; favorites appear first.
- **Reuse a template without editing it every time.** Add `{{variables}}` and fill them in when inserting. Optional defaults, required fields, dropdown choices, and `{{date}}`, `{{time}}`, and `{{datetime}}` are supported.
- **Keep useful prompts organized.** Add categories and tags, pin favorites, sort by recent use, and revisit earlier versions.
- **Create variations and portable subsets.** Duplicate a snippet with its variables and tags, or export only the snippets in the current search or view.
- **Stay in control of AI rewrites.** Compare the original with the generated draft, edit the draft, then choose whether to insert it or replace the saved snippet. Rewrites never overwrite a snippet automatically.
- **Keep your library portable.** Import and export JSON backups. Data is stored locally, with atomic writes and recoverable backups.

## AI Optimize

AI Optimize is optional and uses the default model configured in DSH. It streams a proposed rewrite into a comparison view; the original stays intact until you choose an action.

- **Insert optimized** puts the reviewed draft into the composer and leaves the library unchanged.
- **Replace snippet content** saves the reviewed draft. The action is disabled if the result is incomplete, over the size limit, or missing an original placeholder.
- **Retry** requests a fresh rewrite. You can edit the generated draft before using it.

The selected snippet is sent to your configured model service only when you start this action. Other library operations do not send snippet content to an external service.

## Data and recovery

The library is stored at `<DSH_HOME>/data/prompt-snippets/snippets.json`. If `DSH_HOME` is unset, DSH uses `~/.dsh`.

Writes use a temporary file and atomic replacement. Rotating `.bak` files can be viewed and restored from **Backups** in the panel; the current library is saved to the rotation before a restore. Malformed data is preserved as a recovery copy. Deletion is reversible, and each snippet keeps up to 20 prior versions.

Import first previews the number of items to add, update, skip, or move to trash, and lists name conflicts. Nothing is written until you confirm. If the source file changes after preview, preview it again.

## Contributing

Bug reports, feature ideas, and pull requests are welcome. Please include your DSH version and steps to reproduce when reporting a problem.

Run the checks locally:

```bash
npm ci
npm test
npm run lint
```

The test suite uses a temporary `DSH_HOME`; it does not read or modify your real snippet library.

If Prompt Snippets saves you time, [star the repository](https://github.com/dadazhangn/dsh-prompt-snippets) or share it with another DSH user.

## License

MIT. See [LICENSE](LICENSE).
