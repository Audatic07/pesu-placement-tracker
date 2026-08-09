# Design system

Recorded from the built application. Every value is in `app/globals.css` or a
component under `components/`.

## The commitment

The owner chose **the category standard over an invented visual world**, and
named **Linear** as the craft bar. That is a standing decision recorded in
PRODUCT.md, not a one-off. This is a dense, fast, keyboard-reachable tool:
persistent sidebar, composable filters, sortable tables, URL-addressable views —
executed at full fidelity, with no irony and no smuggled visual metaphor.

The bar means, concretely:

- Every list filters and sorts.
- Every view is a URL you can send someone; the back button undoes a filter.
- Navigation is instant and never loses your place.
- Density is high, never crowded.
- Colour is restrained and carries meaning only.

## Architecture

```
app/(app)/layout.tsx      persistent shell — sidebar + content
  overview                the batch at a glance, links into everything
  companies               searchable, filterable, sortable index of every drive
  companies/[slug]        one company across every batch it has appeared in
  calendar                the season in order, grouped by month
  analysis                distributions, tiers, branches, headline-vs-cash
  me                      your profile, your quota, your submissions
  submit                  the submission wizard
```

The shell holds the batch selector, because batch scopes every screen: a student
picks a year once and keeps it while moving around. It rides in the query string
so a shared link carries the whole view.

## State lives in the URL

Search, filters, sort key, sort direction and page are all query parameters.
Nothing about a view is held in component state. This is the difference between
an application and a report: `/companies?tier=TIER_1&branch=ECE&sort=ctc&dir=desc`
is a complete, shareable answer to a real question, and it survives a refresh,
a back button, and a paste into a group chat.

Consequently `DataTable` and `Pagination` are **server components** — sorting and
paging are links, so they ship no JavaScript. Only `FilterBar` (debounced input,
dropdown menus) and `Sidebar` (drawer, batch menu) are client components, and
both take only serialisable props.

## Type

System sans throughout. Base 14px, tight steps, no display face — an Operate
surface is well served by a workhorse UI stack.

| Role | Size | Weight |
|---|---|---|
| Page title | 15px | 600 |
| Panel title | 13px | 500 |
| Body, table cell | 13px | 400 |
| Table header, label | 11px | 500, uppercase, 0.05em tracking |
| Stat value | 22px | 600 |

`.tnum` (tabular figures) on every column of numbers so packages align down the
column. Large standalone numerals keep proportional figures.

## Colour

Neutral scale plus one accent. Colour never decorates.

| Token | Light | Dark |
|---|---|---|
| `--bg` | `#ffffff` | `#0a0b0d` |
| `--bg-subtle` (sidebar) | `#fafafa` | `#0d0e11` |
| `--panel` | `#ffffff` | `#131519` |
| `--line` | `rgba(9,9,11,.09)` | `rgba(255,255,255,.08)` |
| `--text` | `#101113` | `#f2f3f5` |
| `--text-secondary` | `#5a5f68` | `#9ba1ab` |
| `--text-tertiary` | `#6b7280` | `#8a919c` |
| `--accent` | `#4b5ce0` | `#6272ea` |
| `--accent-solid` | `#4b5ce0` | `#4f5ed6` |

Two accent steps, one job each. `--accent` is bright enough to read *on* the
background for links, icons and active nav; `--accent-solid` is dark enough to
carry white text at 4.5:1 inside a filled control. A single step cannot do both —
the first version measured 4.11:1 on primary buttons in dark mode.

`--text-tertiary` carries real text (column headers, stat labels, hints), so it
is held to 4.5:1 rather than merely looking recessive. Measured: 6.2:1 on the
page, 6.1:1 on the sidebar, 5.8:1 on a panel.

Status is a **6px dot plus a word**, never colour alone: hired, ditched, hired
nobody, in progress.

### Chart ramp

Validated with the dataviz validator against these exact surfaces. Do not
substitute by eye.

- Single series: `--viz-1` (`#2a78d6` light, `#3987e5` dark).
- Tiers use an **ordinal** ramp — one hue stepped by magnitude, because rank is
  the information — `#184f95 / #2a78d6 / #86b6ef`, reversed in dark so magnitude
  still reads as prominence.
- Every bar carries a value and a percentage as text, so no chart depends on
  colour to be read.

## Tables

Compact 38px rows, hairline separation, sticky header, no zebra striping, no
card wrapper. Columns declare `hideBelow` so a phone shows the columns that
matter and drops the rest rather than scrolling everything.

Whole-row navigation is an anchor stretched over the row by `.row-link::after`,
not an onClick handler. It therefore works without JavaScript, supports
middle-click and open-in-new-tab, and lands in the tab order once per row.

## Facets

Each filter's counts are computed with **its own filter removed**, so choosing
"Tier 1" does not collapse the tier list to one option. Zero-count options stay
visible but disabled — hiding them makes the list jump as you use it.

## What this system refuses

- State that is not in the URL.
- Client components where a link would do.
- Cards as page structure; nested cards anywhere.
- Kickers or eyebrows above headings.
- Gradient text, decorative glass, coloured left borders above 1px.
- Emoji or Unicode glyphs standing in for icons (icons are lucide, one weight).
- Colour as the only carrier of status.
- Any statistic without its cohort size behind it.
