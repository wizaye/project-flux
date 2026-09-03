# Workbench Shell Specification

## Target files
- `packages/shared-ui/src/components/design-system/workbench/workbench.tsx`
- `packages/shared-ui/src/components/design-system/workbench.tsx`

## Assembly
- Viewport-sized CSS grid: 35px title, flexible workbench, 32px status.
- Workbench body: fixed activity rail plus resizable primary/editor/secondary panels.
- Exact Default Dark 2026 and Default Light 2026 CSS custom properties live on the shell.
- Desktop and web use the same component tree.

## Responsive behavior
- Desktop: both sidebars visible.
- Below 900px: secondary sidebar starts closed.
- Below 680px: primary sidebar starts closed; activity rail remains visible.

## Constraints
- No legacy workspace imports.
- No backend behavior or mock service layer.
- Components receive small explicit props and remain independently replaceable.
