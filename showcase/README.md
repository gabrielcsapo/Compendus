# Compendus showcase sandbox

The showcase is a disposable, deterministic Compendus installation used to make the product tour.
It never reads from or writes to the normal `data/` directory.

```bash
pnpm showcase:seed
pnpm showcase:capture:web
pnpm showcase:capture:ios
pnpm showcase:capture
```

`showcase/scenes.ts` is the single scene manifest used by the capture scripts and documentation.
Generated masters live under `.showcase/` and optimized site assets are written to
`docs/public/showcase/`.

The iOS capture command creates and reuses dedicated `Compendus Showcase` iPhone and iPad
simulators, then shuts them down when capture is complete. Set `SHOWCASE_IPHONE_UDID` or
`SHOWCASE_IPAD_UDID` only when you intentionally want to use a specific simulator instead.
