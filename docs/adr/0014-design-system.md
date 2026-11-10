# ADR-14: Design system

- Status: Accepted (design pass before Sprint 4)

## Source

The look follows a travel CRM case study the product owner chose as the reference (screens supplied as
screenshots). We follow its visual language; we do not reuse its brand name, logo, photographs or artwork.
Our mark (a dotted route between two stops) and wordmark are our own.

## Tokens (`frontend/app/globals.css`)

| Token         | Value   | Use                                                                 |
| ------------- | ------- | ------------------------------------------------------------------- |
| accent        | #1E8BFF | Brand blue: fills, charts, icons, map, large numbers                |
| accent-strong | #1472D6 | Text-bearing blue: primary buttons and links (white on it is 4.8:1) |
| surface       | #FFFFFF | Cards                                                               |
| canvas        | #F4F4F4 | Page background, inputs and rows inside cards                       |
| ink           | #333333 | Text, active tabs, dark pills                                       |
| muted         | #6E6E6E | Secondary text (4.6:1 on canvas, 5.1:1 on white)                    |

White text on #1E8BFF is only 3.4:1, below WCAG 2.1 AA for normal-size text (NFR-13), hence the separate
`accent-strong` for anything carrying text. Radii: cards 28px, rows 20px, tiles 14-18px, buttons and tabs
fully rounded. Almost no shadows (popovers only).

## Type and icons

Urbanist (variable, OFL, self-hosted via @fontsource), light weights for headings and large numbers.
Lucide line icons (ISC) at 1.5 stroke, inside round white or dark buttons.

## Components (`frontend/components`)

- `ui.tsx`: Card, PageHeader, Button / ButtonLink (primary, secondary, dark, danger, ghost), IconButton,
  ArrowLink, Field, Select, TextArea, Segmented, Alert, StatusBadge, StatCard, ListRow (icon tile, title,
  subtitle, chevron; `tone="canvas"` inside white cards), Avatar, Flag, Detail, Empty.
- `shell.tsx`: AppShell (logo, pill tabs, left rail of round icon links, account menu), AuthFrame, Logo.
- `date-range.tsx`: range picker with the dark-capsule selection and dark confirm/cancel pill; keyboard
  navigable.
- `filter-bar.tsx`: round search and filter buttons; filters open as pill chips with a dark confirm/clear pill.
- `charts.tsx`: hatched bar chart (latest value highlighted), hatched area chart, ranked list with bars.
  Plain SVG with text alternatives.
- `world-map.tsx`: Natural Earth countries (world-atlas, ISC) with destination countries in blue and zoom.

## Accessibility

axe-core (WCAG 2.0/2.1 A and AA rules) reports zero violations on dashboard, trips, trip detail, new trip,
clients, client detail, community, learn, account, sign-in, sign-up, home and the traveler proposal page.
Flags render from Unicode regional indicators with an accessible label; the account button's spoken name
contains its visible text (WCAG 2.5.3).

## Data honesty

The dashboard shows only figures we have: trips, proposals sent per day, clients, pipeline and approved
value, destinations. Bookings, revenue and commission join it when booking ships; nothing is mocked.
