# Workbench Sidebars Specification

## Target files
- `packages/shared-ui/src/components/design-system/workbench/primary-sidebar.tsx`
- `packages/shared-ui/src/components/design-system/workbench/secondary-sidebar.tsx`

## Primary sidebar
- Default width 296px; minimum 170px.
- Header 35px, uppercase 11px title, toolbar actions.
- Explorer tree rows 22px high with 8px nested indentation.
- Selected row uses `rgba(255,255,255,.13)` dark / `rgba(0,0,0,.14)` light.

## Secondary sidebar
- Default width 300px; minimum 220px.
- Header uses `Chat` tab and compact actions.
- Session rows, centered empty content, composer anchored at bottom.
- Composer uses sidebar background, 6px border radius, and exact input border.

## Behavior
- Both panels are independently resizable and closable.
- Secondary panel supports maximize/restore.
- Overflow scrolls inside panel bodies, never the workbench viewport.
