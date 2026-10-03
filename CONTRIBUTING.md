# Contributing to Zync

Thank you for your interest in contributing to Zync. This document provides guidelines and instructions for contributing.

## Licensing contributions

The desktop application is distributed under [FSL-1.1-ALv2](LICENSE), with
Apache 2.0 rights for each version after two years. By submitting a desktop
contribution, you confirm you have the right to license it for inclusion under
those terms and that it does not contain incompatible third-party code. You
retain copyright in your contribution. The separately licensed plugin SDK and
plugin UI packages remain MIT in their [SDK](https://github.com/zync-sh/plugin-sdk)
and [UI](https://github.com/zync-sh/plugin-ui) repositories.

Do not submit code you cannot license under the applicable terms. If your
employer may own your work, obtain its permission before contributing. Any
separate commercial licensing of contributed code would require additional
rights from its copyright holder; a pull request alone does not grant them.

## Getting Started

1. **Fork** the [repository](https://github.com/zync-sh/zync) on GitHub.

2. **Clone your fork** and add the upstream remote:
   ```bash
   git clone https://github.com/YOUR_USERNAME/zync.git
   cd zync
   git remote add upstream https://github.com/zync-sh/zync.git
   ```

3. Ensure you have the [prerequisites](./README.md#prerequisites) installed (Node.js, Rust, and platform-specific dependencies).

4. Run `npm install` and `npm run tauri dev` to start the development environment.

**Public URLs / analytics hosts:** do not hardcode production API URLs in source. Debug builds may talk to local `zync-share` / `zync-analytics`. Release builds must bake `ZYNC_SHARE_API_BASE`, `ZYNC_SHARE_RELAY_URL`, and `VITE_ANALYTICS_API_URL` from GitHub Actions secrets.

**Staying in sync:** Before starting new work, pull the latest from upstream:
   ```bash
   git fetch upstream
   git checkout main
   git merge upstream/main
   ```

## Development Workflow

1. Create a new branch from `main` for your changes:
   ```bash
   git checkout -b fix/your-fix-name
   # or
   git checkout -b feature/your-feature-name
   ```

2. Make your changes. Follow existing code style and conventions.

3. Run the type checker and ensure the app builds:
   ```bash
   npm run type-check
   npm run tauri build
   ```
   Release Rust uses thin LTO (`src-tauri/Cargo.toml` `[profile.release]`). `tauri dev` is unchanged.

4. Commit with clear, descriptive messages:
   ```bash
   git commit -m "fix: resolve SSH connection timeout on slow networks"
   ```

5. Push to your fork and open a Pull Request against the main repository.

## Code Conventions

- **Frontend**: TypeScript, React functional components, Zustand for state.
- **Backend**: Rust, async/await where appropriate.
- **Naming**: Use descriptive names; prefer `snake_case` in Rust and `camelCase` in TypeScript.

## Pull Request Guidelines

- Keep PRs focused and reasonably sized.
- Add a clear title and description.
- Reference any related issues.
- Ensure CI passes (if applicable).

## Questions or Ideas?

Open an [Issue](https://github.com/zync-sh/zync/issues) to report bugs, request features, or ask questions.
