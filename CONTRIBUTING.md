# Contributing to shapeguard

Thanks for taking the time to contribute! Every bug report, suggestion, and PR is appreciated.

---

## Getting started

```bash
# 1. Fork the repo on GitHub, then clone your fork
git clone https://github.com/YOUR_USERNAME/shapeguard-.git
cd shapeguard-

# 2. Install dependencies
npm install

# 3. Run tests — make sure everything passes before you start
npm test

# 4. Build
npm run build
```

---

## Making changes

```bash
# Create a new branch for your change
git checkout -b fix/your-bug-description
# or
git checkout -b feat/your-feature-name
```

Make your changes, then:

```bash
# Run tests again — all must pass
npm test

# Build to make sure it compiles cleanly
npm run build
```

---

## Submitting a pull request

1. Push your branch to your fork
2. Open a Pull Request against the `main` branch
3. Describe what you changed and why
4. Wait for review — usually responded to within a few days

---

## Reporting bugs

Open an issue and include:
- Node.js version (`node -v`)
- shapeguard version (`npm list shapeguard`)
- Minimal code that reproduces the problem
- What you expected vs what happened

---

## Suggesting features

Open an issue with:
- The problem you're trying to solve
- Your proposed solution
- Any alternatives you considered

---

## Code style

- TypeScript only — no plain `.js` in `src/`
- All new features need tests in `src/__tests__/`
- Keep commits small and focused — one thing per commit
- Commit message format: `fix: description` / `feat: description` / `docs: description`

---

## License

By contributing, you agree your changes will be licensed under the same [MIT License](./LICENSE) as this project.