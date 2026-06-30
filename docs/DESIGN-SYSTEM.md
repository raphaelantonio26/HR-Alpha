# HR OS design system (Atrium)

The brand is fixed (AMPAM standards): **navy `#004B87`**, **red `#EF3340`**,
**Arial**. So elevation here is not a new look - it is precision within that
identity. The standard is Apple-grade polish (restraint, spacing, type, motion)
on a Toyota-reliable base (responsive, keyboard-focusable, reduced-motion aware).
Everything below is defined once and consumed everywhere; the two files of record
are `src/index.css` (CSS custom properties + base) and `tailwind.config.ts` (the
Tailwind bridge).

## Color

Colors are stored as **channel triples** (e.g. `0 75 135`), never as `rgb(...)`,
so Tailwind can apply alpha via `rgb(var(--token) / <alpha-value>)`. Light is the
default; `.dark` is a warm, low-glare dark (not pure black). Brand hues lift
slightly on dark for contrast but remain navy/red in spirit.

| Token        | Role                                              |
|--------------|---------------------------------------------------|
| `bg`         | App background                                    |
| `surface`    | Card / panel background                           |
| `elevated`   | Overlay surfaces (palette, menus)                 |
| `ink`        | Primary text                                      |
| `muted`      | Secondary text, captions                          |
| `line`       | Borders, dividers                                 |
| `brand-navy` | **Primary accent** - actions, active nav, links   |
| `brand-red`  | Reserved for emphasis in brand contexts           |
| `good`       | Positive / success                                |
| `warn`       | Caution (e.g. the synthetic-data notice)          |
| `bad`        | **Destructive / critical only**                   |

Rule: **navy is the primary accent; red is reserved for destructive or critical
states.** Do not use red as a decorative accent. Use semantic tokens at low alpha
for tinted backgrounds (`bg-brand-navy/10`, `bg-warn/10`).

## Type

One family (Arial) carries the whole system, so hierarchy comes from a deliberate
size / weight / tracking ramp rather than from mixing faces. Display sizes get
negative tracking; labels get wide tracking and uppercase.

| Class      | Size  | Use                                  |
|------------|-------|--------------------------------------|
| `text-2xs` | 11px  | Eyebrows, kbd, group labels (caps)   |
| `text-xs`  | 12px  | Captions, meta, pills                |
| `text-sm`  | 14px  | **UI default** (body, controls, table)|
| `text-base`| 16px  | Prose                                |
| `text-lg`  | 18px  | Card / section titles                |
| `text-xl`  | 22px  | Page title                           |
| `text-2xl` | 28px  | Stat values                          |
| `text-3xl` | 36px  | Hero numerals                        |

Weights: 400 body, 600 semibold for labels/controls, 700 for titles and stat
values. Tracking: `tracking-tightish` (-0.01em) on titles; `tracking-wider` +
`uppercase` on eyebrow labels.

## Spacing & radius

An 8px rhythm (Tailwind's 2 / 3 / 4 / 6 / 8 = 8 / 12 / 16 / 24 / 32px) governs
padding and gaps. Cards pad `p-4`; page gutters are `p-5 sm:p-6`; the main content
is capped at `max-w-screen-2xl` and centered for line-length on wide displays.
Radius: `rounded-md` for controls, `rounded-card` (12px) for panels, `rounded-pill`
for pills and the active-nav rail.

## Elevation

Three theme-aware steps, defined as `--shadow-1/2/3` in `index.css` and exposed as
Tailwind utilities. Shadows are softer in light, deeper in dark.

| Utility            | Step      | Use                          |
|--------------------|-----------|------------------------------|
| `shadow-card`      | resting   | Cards, stats, inputs         |
| `shadow-card-hover`| raised    | Hover on interactive cards   |
| `shadow-overlay`   | overlay   | Command palette, dialogs     |

## Motion

A tight band (150 / 200 / 250ms) on a single brand easing curve
`cubic-bezier(0.16, 1, 0.3, 1)` - confident, never bouncy. Exposed as `ease-out`
plus `duration-fast|base|slow`, and as `--ease-out` / `--dur-*` in CSS.

- `.u-enter` - content fades up on mount (page and each route, keyed by module).
- `.u-lift` - hover raise for interactive cards only (opt-in).
- `.u-skeleton` - shimmer for loading placeholders.
- Hover/active color changes use `duration-fast`.

**Reduced motion is honored globally:** `prefers-reduced-motion: reduce` collapses
all animation and transition durations and disables the shimmer and lift. Nothing
relies on motion to convey meaning.

## Focus & accessibility floor

- `:focus-visible` paints a 2px navy outline with a 2px offset, everywhere.
- Decorative icons are `aria-hidden`; loading regions use `role="status"`; errors
  use `role="alert"`; the palette is a labeled `role="dialog"`.
- Verified by the axe suite (`src/__tests__/a11y.test.tsx`) across the populated
  People, Compensation, Leave, and Command Center surfaces - zero serious or
  critical violations.

## Components (`src/components/ui.tsx`)

One source of truth per pattern; modules compose these rather than restyling.

- **Card** - panel with optional `icon` and `title`; `interactive` opts into the
  hover-lift for clickable cards.
- **Stat** - KPI tile with optional directional `trend` (navy up / red down) and a
  `delta` label.
- **Pill** - status chip in semantic tones (`good|warn|bad|brand|muted`).
- **Button** - three intents: `primary` (navy fill), `secondary` (outline),
  `ghost`. Labels are verbs and keep the same word through a flow.
- **Skeleton / SkeletonTable** - shimmer placeholders shown while a surface
  fetches (wired through `Async`'s `loadingFallback`).
- **EmptyState / ErrorState** - icon-led states. Empty screens name the next
  action; errors say what happened and how to recover; 403 reads as a calm
  "not available for your role" because access is enforced at the data layer.
- **Async** - the render-helper that maps a fetch state to skeleton -> error+retry
  -> empty -> data, so every module handles those four cases identically.

## Shell

Sidebar groups modules (Work / People / Insight / Admin) with a lucide glyph per
module and a navy left-rail on the active item. The topbar is sticky and
translucent (backdrop blur) with search (Cmd/Ctrl-K), worksite and acting-role
selectors, and a theme toggle. In the demo profile a slim navy strip - "Demo:
every record is synthetic" - sits above the topbar at all times.

## Demo front door (Profile D)

When the SPA is built with `VITE_DEMO_MODE=true`, entry is gated by `DemoGate`: a
branded screen that states the synthetic-data notice up front and offers the five
demo roles (administrator, HRBP, comp analyst, people manager, legal/compliance),
each with a one-line scope. Choosing a role mints a tenant-pinned session via
`POST /demo/session` (the dev-token route is disabled in demo) and enters the app.
Outside demo, the gate never renders.
