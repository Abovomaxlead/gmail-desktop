# A guided tour on first run

## The problem

Everything this app adds to Gmail is invisible until someone tells you it is there. The window
opens on a mailbox that looks like Gmail, and nothing on screen says that the strip of tabs is
one tab per mailbox, that right-clicking one reaches Calendar and Drive, that `+` can add a
mailbox somebody else shared with you, or — the big one — that dropping a folder of `.eml` files
onto the window files them into labels across several mailboxes at once. The mail drop is the
app's largest feature and its least discoverable: there is no button for it, because the gesture
*is* the button.

Settings has fifteen sections, one of them a What's New page, so a returning user has somewhere
to look. A first-time user has nowhere. This spec adds the one thing missing: a short scripted walk,
once, on the first run that has a mailbox to walk through.

## Scope

Two subjects, chosen deliberately over the alternatives:

- **The chrome essentials** — the tab strip, its context menu, `+`, the pinned Google-app
  buttons, the feedback bubble, the gear.
- **The mail drop** — one step, explaining the gesture.

Explicitly **not** in scope: a walk through the settings sections, and the system integration
(tray, badge, default-mail-client, toasts, auto-start). Both are real, both are findable once
someone knows the gear exists, and a fourteen-step tour is a tour nobody finishes. The closing
step points at the gear and stops there.

## What must not change

- **The tour runs once, unprompted, and never again.** No nagging, no re-offer on the next
  release. `whats-new` is the channel for "new in this version"; a tour that reappears would
  compete with it.
- **It is a walk, not a wizard.** No step performs an action, links an account, or asks for a
  decision. `canClickTarget: false` on every step, so the highlighted control cannot be clicked
  mid-tour into a panel that would draw over the tour itself.
- **Esc always ends it, and ending it is not a failure.** Skipping marks the tour seen. Someone
  who dismisses it has made a choice, and asking again would be overruling them.
- **No step depends on an element that might not be there.** A mailbox with no pinned apps, a
  provisional tab that has not resolved its address yet — the tour drops the step rather than
  pointing at nothing.
- **Nothing is hidden that the user cannot get back.** The Gmail views are hidden for the
  duration and restored on exit, using the same call the settings panel already makes.

## Design

### The library

`shepherd.js` 15.3.0, added to `renderer/package.json`. It brings two transitive dependencies,
`@floating-ui/dom` and `deepmerge-ts`, into a renderer that currently has only `next` and
`react`. It ships ESM and CJS with types, and `useModalOverlay: true` gives the SVG spotlight —
a dim layer with a rounded cut-out around the target — which is the effect this feature is
about.

Two facts about 15.3.0 shape the work below. Its stylesheet defines **no CSS custom properties**,
so theming means overriding the `.shepherd-*` classes directly. And it has `skipMissingElement`
and `waitForElement`, which is exactly the guard an absent anchor needs.

### Why the tour is DOM in the main renderer, not an overlay view

The window's chrome is the renderer page; Gmail is a `WebContentsView` painted over everything
below the topbar (`electron/windows/layout.ts`). So a dim layer drawn in the page sits *behind*
Gmail unless the views are hidden.

The obvious alternative — a transparent `OverlayView` above Gmail, keeping the mail visible
behind the spotlight — fails on the anchors. `overlay-view.ts` is explicit that an overlay must
not cover the titlebar, or the window stops being draggable; and the titlebar is where six of
this tour's eight steps point. It would also put the tour in a process that cannot see the
topbar's DOM, so every anchor rect would have to be measured in the renderer and shipped
renderer to main to overlay, re-synced on resize, zoom and profile change, with step actions
flowing back the other way.

So the tour is React inside the page, anchoring to the real `Topbar` elements, and the Gmail
views are hidden while it runs. The cost is that the mail list is not visible as scenery. For
the six topbar steps that costs nothing — tabs and buttons are renderer DOM and stay on
screen. For the mail-drop step an empty canvas is arguably the better backdrop.

### State

One new pref field, in the per-area shape the store already uses:

```ts
tour: { seen: boolean }   // default false
```

Four touches in `electron/core/prefs-store.ts`: the interface beside `advanced` (line 143), the
`DEFAULTS` entry (line 194), a normalising entry in the reader that rebuilds prefs from disk
(`bool(raw.tour?.seen, false)`, beside line 350 — without it a `prefs.json` written by an older
build has no `tour` key and the field arrives `undefined`), and a `setTour` setter following
`setAdvanced` (line 415).

`IPC.SET_TOUR_SEEN` carries it, and `setTourSeen(v: boolean)` joins the bridge next to
`setAdvanced` (`page.tsx:195`). The `Prefs` interface in `page.tsx:86` gains the same field —
copied rather than imported, for the reason that file's own header comment gives.

No version counter. A tour that re-runs when its steps change is a second What's New.

### Trigger

An effect in `page.tsx` watching `profiles` and `prefs`, behind a ref so it fires at most once
per session. It starts when all four hold:

- `prefs` has arrived from main, and `prefs.tour.seen === false`
- the settings panel is closed
- `profiles.some((p) => !p.provisional)`

The last condition is the reason the tour waits. On a genuinely fresh install the tab strip is
empty, and a provisional tab is one remembered from the bar before detection has recovered its
address (`page.tsx` header). Starting before a real mailbox lands would point the tab steps at
nothing. Waiting costs the user only the seconds their first account takes to resolve, and buys
every step a real target.

### The steps, as a pure module

`renderer/app/tour-steps.ts` imports neither React nor shepherd. It emits a plain description
that the component translates into shepherd's `StepOptions`. This is the pattern `plus-menu.ts`,
`mailbox-rail.ts` and `job-panel.ts` already follow, and it is what makes the step list testable
under vitest's node environment, which has no DOM.

```ts
export type TourAnchor = 'tabs' | 'add' | 'pinned' | 'feedback' | 'gear' | null;

export interface TourStep {
  id: string;
  anchor: TourAnchor;                            // null = centered card, no spotlight target
  on: 'bottom' | 'bottom-start' | 'bottom-end';  // ignored when anchor is null
  titleKey: keyof UiStrings;
  bodyKey: keyof UiStrings;
}

export function planTour(input: { hasPinned: boolean }): TourStep[];
```

`hasPinned` is not a new computation. `Topbar.tsx:94` already derives the pinned list as
`pinnedSurfacesFor(prefs?.googleApps.pinned ?? [], openableSurfaces(activeProfile))`; the trigger
in `page.tsx` computes the same thing and passes whether it is non-empty.

Eight steps, in order:

| id | anchor | what it says |
|----|--------|--------------|
| `welcome` | none | What this app is, and that the tour takes a minute |
| `tabs` | `tabs` | One tab per mailbox; click to switch; the number is unread mail |
| `tab-menu` | `tabs` | Right-click a tab for Calendar, Drive and Contacts; drag to reorder |
| `add` | `add` | `+` adds another Google account, or a mailbox someone shared with you |
| `pinned` | `pinned` | These open the active mailbox's Google apps; pin them under Settings |
| `maildrop` | none | Drag `.eml` files onto the window to file mail into labels, across mailboxes at once |
| `feedback` | `feedback` | The bubble reports a problem straight to the developer |
| `gear` | `gear` | Everything else lives here, including how to see this tour again |

`planTour` drops `pinned` when the active mailbox has nothing pinned, so shepherd never sees a
step it cannot place. Shepherd's `skipMissingElement` and `waitForElement` are set on
`defaultStepOptions` as the second line of defence, for anchors that vanish mid-tour.

### Anchoring

`data-tour` attributes on elements that already exist in `Topbar.tsx`: the tab-strip container
(line 126), the `+` button (163), the feedback button (202), the gear (211).

The pinned Google-app buttons get `data-tour="pinned"` on the **first** button of the
`pinned.map` (line 183) rather than a wrapper around the group. The file computes its right-hand
reserve from `PINNED_BUTTON = ICON_BUTTON + GAP` (line 49) on the assumption that the buttons
are flat siblings under one `gap-1` flex; a wrapper moves that gap and quietly breaks the
`maxWidth` arithmetic the file's own header warns about — reserve too little and the gear slides
under the native window overlay. Highlighting one icon of several is less tidy than highlighting
the group, and that is the trade accepted here.

### Hiding Gmail while the tour runs

`setTourActive(active: boolean)` on the bridge, carried by `IPC.TOUR_ACTIVE`. Its handler
mirrors `SETTINGS_TOGGLE` (`ipc-handlers.ts:124`) exactly:

```ts
ipcMain.on(IPC.TOUR_ACTIVE, (_e, arg: { active: boolean }) => {
  if (arg.active) manager?.hideAll();
  else if (!settingsPanelOpen) manager?.showActive();
});
```

The `settingsPanelOpen` guard reads `runtime.ts:88`. Without it, a tour ending while the panel
happens to be open would paint Gmail over the settings panel.

### Lifecycle, in one place

Starting the tour sends `setTourActive(true)` and calls `tour.start()`. Shepherd's `complete` and
`cancel` events both do the same two things — `setTourSeen(true)` and `setTourActive(false)` —
because finishing and skipping differ in what the user learned, not in what the app should
remember. `exitOnEsc` and `keyboardNavigation` stay at their defaults, so Esc cancels and the
arrow keys walk the steps. The tour object is built in an effect and torn down with
`tour.complete()` on unmount, so a window closed mid-tour still leaves the views restored.

Buttons per step: the first step gets Skip and Next, the middle steps Back and Next, the last
step Back and Done. Skip fires `cancel`; Done fires `complete`.

### Two consequences, accepted

**The titlebar cannot be dragged while the tour is on screen.** Shepherd appends its overlay to
`document.body`, outside the topbar's `-webkit-app-region: drag` region (`Topbar.tsx:38`), and
an element that does not opt into the drag region is not draggable. The native window buttons
are a Chromium overlay drawn above page content, so minimise, maximise and close keep working.
For a modal tour that is correct behaviour rather than a defect.

**A mail drop landing mid-tour wins.** The drop preview is a separate `WebContentsView` that
raises itself above the renderer page (`overlay-view.ts`), so its panel draws over the tour,
which waits behind it. Arbitrating between the two would mean teaching main which of two modal
things outranks the other, and a drop during the first-run tour of a just-linked account is not
worth that plumbing. Named here rather than pretended away.

### Styling

`import 'shepherd.js/dist/css/shepherd.css'` at the top of the client component, not through
`@import` in `globals.css`: the PostCSS chain here is `tailwindcss` plus `autoprefixer` with no
`postcss-import`, so a bare package specifier in an `@import` would not resolve.

`globals.css` — three Tailwind directives and a reset today — gains a banner-sectioned block
overriding `.shepherd-element`, `-content`, `-header`, `-title`, `-text`, `-footer`, `-button`,
`-button-secondary`, `-arrow`, `-cancel-icon` and `-modal-overlay-container`, against the same
neutral palette as `settings/tokens.ts`, with `.dark` variants matching how the theme is applied
(`page.tsx` toggles `dark`/`light` on `documentElement`). This is the real cost of the library
choice: roughly sixty lines of CSS that a hand-rolled overlay would not have needed.

### Text

Eight titles and eight bodies, plus four button labels (Back, Next, Done, Skip), in `UiStrings`
— about twenty keys in each of the three sets. `tests/strings-sets.test.ts` already enforces
that the three sets carry identical keys, that no value is empty, and that **no Dutch value is
still identical to its English one**. The Dutch and Rene-mode copy therefore has to be genuinely
written; a stub fails the suite. Rene mode's register is simple Dutch, which suits a tour better
than it suits most of the app.

### Seeing it again

A row in `Settings → General` — "Show the tour again" with a button, in a `SettingsGroup` after
Startup. Pressing it closes the panel and starts the tour, because the panel and the tour cannot
both be visible: one needs the Gmail views hidden and the other *is* what fills that space.
`GeneralSection.tsx` takes one more callback, threaded up to `page.tsx` the way
`onRequestDefaultMail` already is.

This row is not something the user asked for. It is here because a tour that can only ever be
seen once is a tour nobody dares to skip, and the whole design rests on skipping being safe.

### Tests

`tests/tour-steps.test.ts`:

- `planTour` drops `pinned` when `hasPinned` is false, and keeps it when true
- step ids are unique, and the order is the order in the table above
- the only steps with `anchor: null` are `welcome` and `maildrop`
- every `titleKey` and `bodyKey` resolves against `STRINGS_NORMAL` — so a step naming a key
  nobody wrote fails the suite rather than rendering blank

The three-locale copy needs no new test; `strings-sets.test.ts` covers it.

## Files

**New**
- `renderer/app/tour-steps.ts`
- `renderer/app/TourGuide.tsx`
- `tests/tour-steps.test.ts`

**Edited**
- `renderer/app/Topbar.tsx` — five `data-tour` attributes, no layout change
- `renderer/app/page.tsx` — trigger effect, `Prefs.tour`, two bridge members, tour mount
- `renderer/app/strings.ts` — about 20 keys in each of 3 sets
- `renderer/app/globals.css` — shepherd overrides
- `renderer/app/settings/GeneralSection.tsx` — the replay row
- `renderer/app/SettingsPanel.tsx` — thread the replay callback
- `electron/core/ipc.ts` — `TOUR_ACTIVE`, `SET_TOUR_SEEN`
- `electron/core/ipc-handlers.ts` — both handlers
- `electron/core/prefs-store.ts` — interface, default, reader, setter
- `electron/sidebar-preload.ts` — both bridge methods
- `renderer/package.json` — `shepherd.js`
