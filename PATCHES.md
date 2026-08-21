# Our tweaks to Immich Picker

This is a **fork** of [eikowagenknecht/obsidian-immich-picker](https://github.com/eikowagenknecht/obsidian-immich-picker).
Upstream is a good, actively maintained plugin — it tracks Immich's API changes, and we
want its updates. We just carry two additions on top that upstream doesn't have.

This file exists so that when upstream releases a new version, the tweaks can be
replayed onto it without anyone re-deriving them from scratch.

**Current state:** rebased onto upstream **1.2.1**, branch `tweaks-on-1.2.1`.

---

## The two tweaks

### 1. OCR search + date labels on thumbnails

**Commit:** `Add OCR search and thumbnail date labels`

Two things bundled together:

- An **OCR button** in the picker toolbar. Immich runs OCR over your photos and indexes
  any text it finds; this searches that index. Handy for finding a photo by a sign,
  a label, a handwritten note, a plant tag.
- A **date caption** under every thumbnail in the grid (`YYYY-MM-DD`), so you can tell
  photos apart at a glance without opening them.

**Touches:**

| File | What |
|---|---|
| `src/immichApi.ts` | adds `searchOcr()` |
| `src/photoModal.ts` | OCR button, `triggerOcrSearch()`, `'ocr'` added to the mode union, pagination branch |
| `src/renderer.ts` | wraps each thumbnail in a div and appends the date label |
| `styles.css` | `.immich-picker-thumbnail-wrap`, `.immich-date-label` |

**Upstream status:** offered as a PR, not accepted. We carry it ourselves.

**Conflict risk: low.** It mostly *adds* things rather than changing existing code.
The one line it does change is in `renderer.ts` (see gotchas below).

---

### 2. Empty album view against Immich 3.x

**Commit:** `Fix empty album view against Immich 3.x`

Immich 3.0 stopped inlining the asset list in `GET /api/albums/{id}`. Upstream still
uses that endpoint and reads `response.json.assets`, which on Immich 3.x comes back
empty — so **every album shows as empty**, even though the album card reports the
right photo count.

The fix fetches album contents via `POST /api/search/metadata` with `albumIds`
instead, and:

- **paginates** until the server reports no `nextPage` (page size 1000, capped at
  100 pages). Upstream does no pagination on albums at all, which matters for
  large albums.
- honors the album's own **sort order**.
- filters out the two kinds of entry the album view folds away: the **companion
  video of a live photo**, and assets **hidden from the timeline** — so the photo
  count matches the count on the album card.

**Touches:** `src/immichApi.ts` (`getAlbumAssets`, plus `visibility`,
`livePhotoVideoId`, `nextPage`, `order` added to the type definitions),
`src/photoModal.ts` (one call site passes the album's order).

**Upstream status:** As of 1.2.1, upstream's `getAlbumAssets` is **completely
untouched** — still the old `GET /api/albums/{id}`. They reworked the *timeline and
search* paths in 1.2.0/1.2.1 (archived photos, visibility, better pagination) but
albums got none of it.

**Conflict risk: low-ish.** It replaces a whole upstream method, which sounds risky,
but it's a method upstream has left alone for many releases.

**Watch for:** if upstream ever fixes albums themselves, check whether their version
paginates and handles live photos. If it does, **drop this tweak** — carrying fewer
patches is always the better outcome.

---

## Reapplying after an upstream update

The tweaks live as two clean commits on top of an upstream release tag. Replaying
them onto a newer tag is a cherry-pick, not an archaeology dig. Roughly:

```
git fetch upstream --tags
git checkout -b tweaks-on-<NEW> <NEW>
git cherry-pick <ocr-commit> <album-commit>
# resolve any conflicts, then:
npm ci          # NOT just npm install — see gotchas
npm run build
npm run lint    # should be zero warnings
```

Then **read the merged result**, don't just trust a clean auto-merge. That's where
the real work is — see the gotchas.

Keep the branch to exactly these two code commits (plus this document, which rides
along harmlessly since upstream has no file by this name). Every extra commit is
future rebase cost, so README edits and lockfile churn should not live here.

A `backup-pre-1.2.1` branch holds the old pre-rebase state, in case anything needs
to be compared against it.

---

## Gotchas learned the hard way

**A clean auto-merge is not a correct merge.** When the tweaks were replayed onto
1.2.1, git merged `searchOcr` without complaint — but upstream had meanwhile
introduced `search()` and `searchVisible()` helpers, and added an "include archived
photos" setting. Our `searchOcr` predated all that and called `requestUrl` directly,
so it silently **ignored the new setting** and returned archived photos regardless.
It's now rewritten to go through `searchVisible()`, which is both correct and much
shorter. Expect this kind of thing every time upstream refactors: check whether our
code should be adopting new upstream plumbing.

**The `renderer.ts` conflict is expected and trivial.** Both sides edit the line that
appends the thumbnail to the DOM. Ours is a superset — it appends a wrapper
containing the thumbnail *and* the date label. Take ours.

**Use Obsidian's DOM helpers.** `el.createDiv({ cls, text })` rather than
`document.createElement` + `.className =`. Upstream's linter enforces this and their
codebase uses it throughout. Matching their idiom means fewer conflicts and clean
lint.

**Run `npm ci`, not `npm install`.** `node_modules` goes stale across upstream
versions — 1.2.1 upgraded the linter, and against the old tree `npm run lint`
crashes with a flat-config error that has nothing to do with our code.

---

## Installing the build into the vault

The build produces `main.js` in the repo root (it's gitignored — build artifact,
not source). Three files go into
`soulbits vault/.obsidian/plugins/immich-picker/`:

- `main.js` (the freshly built one)
- `manifest.json`
- `styles.css`

Leave `data.json` alone — that's your settings.

Then **fully restart Obsidian**. Toggling the plugin off and on is usually enough,
but a restart is the reliable way to be sure the new `main.js` is loaded.

> **Never keep a backup copy inside `.obsidian/plugins/`.** A backup folder still
> contains a `manifest.json` declaring the id `immich-picker`, so Obsidian sees two
> folders claiming the same plugin and loads the wrong one — the symptom is a patched
> build that behaves exactly as if it never installed. Keep backups outside the vault.

**Note:** the plugin still uses upstream's plugin id (`immich-picker`), which means
**Obsidian's community-plugin auto-update will overwrite it** whenever upstream
releases. That's exactly how these tweaks got wiped before. Options, if that gets
annoying: turn off auto-update for this plugin, or rename the fork to its own plugin
id so Obsidian stops managing it. Not done yet — deliberately.
