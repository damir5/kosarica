# Installation

## Summary

This document describes how to install and configure the oh-my-opencode plugin for OpenCode.

If you prefer the interactive installer, run:

```bash
bunx oh-my-opencode install    # recommended
# or
npx oh-my-opencode install     # alternative
```

Note: After installation you will typically run `opencode auth login` to connect provider accounts.

Supported platforms: macOS (ARM64, x64), Linux (x64, ARM64, Alpine/musl), Windows (x64)

After installation, see the [overview guide](./overview.md) for feature information.

## Purpose and scope
This guide is user-facing: step-by-step install and verification instructions. It does not contain roleplay or advertising. (Developer notes and promotional material belong in README/CONTRIBUTING.)

## Prerequisites
- opencode CLI installed (recommended version 1.0.150 or higher). Verify with:

```bash
opencode --version
```

- bunx (or Node.js/npm) available to run the installer (optional — the installer runs via bunx/npx).
- gh CLI (GitHub CLI) is optional and only needed for explicit "star the repo" actions — the installation flow does not require it. If the doc references `gh`, we will clearly mark it as optional and requiring authentication.

If OpenCode (opencode) is not installed:

```bash
# See OpenCode installation docs
https://opencode.ai/docs
```

## Interactive installer

Run the interactive installer and follow prompts:

```bash
bunx oh-my-opencode install --no-tui
```

You can also run non-interactively using flags described below (example):

```bash
bunx oh-my-opencode install --no-tui --claude=yes --openai=no --gemini=no --copilot=no
```

Follow the prompts to configure your subscriptions and authentication. After installer finishes, you should see files added/updated in your opencode config (examples below).

After installation, read [overview.md](./overview.md) to understand agent behaviors, or proceed to "Verify Setup" to confirm everything is correct.

### Installer notes
- The CLI installer registers the plugin in the user/global opencode configuration (usually at ~/.config/opencode/opencode.json) and writes plugin configuration to a file under ~/.config/opencode/ (e.g., oh-my-opencode.json). See "Config locations" below.

## Choosing installer flags (quick guide)

Answer the installer prompts or run non-interactively using these flags:

- `--claude=<no|yes|max20>`
- `--openai=<no|yes>`
- `--gemini=<no|yes>`
- `--copilot=<no|yes>`
- `--opencode-zen=<no|yes>`
- `--zai-coding-plan=<no|yes>`

Provider priority used by the installer is:
Native (anthropic/, openai/, google/) > GitHub Copilot > OpenCode Zen > Z.ai Coding Plan

Note: If you do not have any provider subscriptions configured, the installer will configure the plugin but OpenCode will fall back to a default provider (for example, opencode/glm-4.7-free). If you want fully-featured behavior, authenticate at least one provider using `opencode auth login`.

### Step 1: Install OpenCode (if not installed)

```bash
if command -v opencode &> /dev/null; then
    echo "OpenCode $(opencode --version) is installed"
else
    echo "OpenCode is not installed. Please install it first."
    echo "Ref: https://opencode.ai/docs"
fi
```

If OpenCode isn't installed, check the OpenCode Installation Guide: https://opencode.ai/docs

### Step 2: Run the installer (examples)

Run the installer with flags appropriate to your subscriptions. Examples:

- All native subscriptions:
  ```bash
  bunx oh-my-opencode install --no-tui --claude=max20 --openai=yes --gemini=yes --copilot=no
  ```
- Only Claude:
  ```bash
  bunx oh-my-opencode install --no-tui --claude=yes --gemini=no --copilot=no
  ```
- Only GitHub Copilot:
  ```bash
  bunx oh-my-opencode install --no-tui --claude=no --gemini=no --copilot=yes
  ```

What the CLI does:
- Register the plugin in the OpenCode configuration (e.g., add "oh-my-opencode" to the `plugin` array in opencode config)
- Write plugin-specific config (e.g., oh-my-opencode.json)
- Display which provider auth steps are recommended/required

### Step 3: Verify Setup

```bash
opencode --version  # Recommended: 1.0.150 or higher
cat ~/.config/opencode/opencode.json  # Should contain "oh-my-opencode" in plugin array
cat ~/.config/opencode/oh-my-opencode.json # Plugin configuration written here
```

### Step 4: Configure Authentication

After installation, authenticate providers using the OpenCode CLI:

```bash
opencode auth login
```

Follow the interactive prompts selecting provider(s) you want to configure (Anthropic, OpenAI, Google, GitHub, etc.). For each provider, follow the provider-specific OAuth or token flow shown by the CLI.

#### Anthropic (Claude)

Use `opencode auth login` and select Anthropic when prompted, then follow the Claude-specific authentication steps shown by the CLI.

#### Google Gemini (Antigravity OAuth)

If you use the opencode-antigravity-auth plugin for Google Gemini, add the plugin to your OpenCode config and follow the plugin README for model naming and provider setup:

Example plugin entry for global config:

```json
{
  "plugin": [
    "oh-my-opencode",
    "opencode-antigravity-auth@1.2.8"
  ]
}
```

Model names used by antigravity auth differ from built-in Google names; follow the plugin docs and the plugin's README for exact model-id strings. If you need to override agent model names, update your oh-my-opencode config (global or project-scoped).

The plugin supports multiple Google accounts for load balancing; see the plugin README for details.

#### GitHub Copilot (Fallback Provider)

GitHub Copilot can be used as a fallback provider when native providers are not available. Provider priority remains:
Native (anthropic/, openai/, google/) > GitHub Copilot > OpenCode Zen > Z.ai Coding Plan

When Copilot is used, the installer may recommend Copilot-prefixed model ids for particular agents. Verify exact model strings if you copy them into configuration files.

#### Z.ai Coding Plan

If enabled, Z.ai provides GLM models (e.g., zai-coding-plan/glm-4.7). If Z.ai is the chosen provider, verify the mappings the installer writes to your oh-my-opencode configuration file.

#### OpenCode Zen

OpenCode Zen provides `opencode/`-prefixed models (examples: opencode/claude-opus-4-5, opencode/gpt-5.2, opencode/grok-code, opencode/glm-4.7-free). If you want to use OpenCode Zen models, enable the appropriate installer flag (`--opencode-zen=yes`) or authenticate per the provider instructions.

If no native providers are configured during install, the installer may set plugin model entries to opencode/glm-4.7-free as a fallback. To enable full provider-based operation, authenticate a provider (Anthropic, OpenAI, Google) using `opencode auth login` after installation.

### Config locations — project vs global

- Global (user) config: `~/.config/opencode/opencode.json` — the installer will register plugin names here.
- Plugin config (user global): `~/.config/opencode/oh-my-opencode.json` — plugin-specific settings are usually written here.
- Project-scoped config: `./.opencode/oh-my-opencode.json` — use this to override settings for a single project.

Be explicit which config you edit. Examples:

```bash
# View global opencode config
cat ~/.config/opencode/opencode.json
# View plugin config
cat ~/.config/opencode/oh-my-opencode.json
# View project-scoped plugin config (if present)
cat ./.opencode/oh-my-opencode.json
```

### Caution
Do not change model strings in your configs unless you understand provider availability and quota. The installer writes reasonable defaults based on your flags; use `opencode auth login` to add provider accounts.

## Troubleshooting (common issues)

- Problem: "No model providers configured. Using opencode/glm-4.7-free as fallback."
  - Cause: No provider authenticated and installer was run without provider flags.
  - Fix:
    1. Run `opencode auth login` and authenticate at least one provider, or
    2. Re-run installer with appropriate flags (e.g., `--openai=yes` or `--claude=yes`).
  - Verify by inspecting `~/.config/opencode/oh-my-opencode.json` and `~/.config/opencode/opencode.json`.

- Problem: Installer wrote config but behavior isn't as expected.
  - Fix: Confirm opencode version `opencode --version` and inspect config files:
    ```bash
    cat ~/.config/opencode/opencode.json
    cat ~/.config/opencode/oh-my-opencode.json
    ```

- Problem: `gh repo star` or other gh commands fail
  - Cause: gh CLI not installed or not authenticated
  - Fix: Install GitHub CLI and run `gh auth login` if you intend to use those features (star/publish). This is optional and outside of the core install flow.

If these steps don't resolve the issue, collect CLI output and relevant config files and open an issue or contact support.

## Where to put promotional or contributing information

Promotional material, "ask for a star", or advertising instructions should live in the repository README or CONTRIBUTING file. Installation docs should remain focused on installation and verification steps.

Relevant repository link (reference): https://github.com/code-yeongyu/oh-my-opencode
