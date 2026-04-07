# Website docs

The docs in this folder are **symlinked from the root `docs/` folder**.

When running locally:
```bash
# From /website
npm run start
```

The build process copies root docs. In CI:
```bash
cp -r ../docs/* docs/
cp ../MIGRATION.md docs/migration.md
cp ../CHANGELOG.md docs/changelog.md
```

Do NOT edit files in `/website/docs/` directly.
Edit the source files in `/docs/` and they will be reflected here.
