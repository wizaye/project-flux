# Workbench Chrome Specification

## Target files
- `packages/shared-ui/src/components/design-system/workbench/title-bar.tsx`
- `packages/shared-ui/src/components/design-system/workbench/activity-bar.tsx`
- `packages/shared-ui/src/components/design-system/workbench/status-bar.tsx`

## Structure
- Title bar: 35px tall, command center centered, layout controls right.
- Activity bar: 48px wide, top navigation and bottom account/settings controls.
- Status bar: 32px tall, compact left/right status items.

## Exact styles
- Dark chrome: `#191a1b`; border `#2a2b2c`; foreground `#8c8c8c`; active `#bfbfbf`.
- Light chrome: `#fafafd`; border `#f0f1f2`; foreground `#606060`; active `#202020`.
- Command field: 22px high, 6px radius, 1px border.
- Icon buttons: 32–48px hit targets; selected surface is neutral, never blue.

## Behavior
- Pane buttons expose pressed state and toggle the matching region.
- Theme control switches Dark 2026 / Light 2026.
- Tooltips come from accessible labels; all controls are keyboard buttons.
