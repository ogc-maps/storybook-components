---
"@ogc-maps/storybook-components": minor
---

Add category-based grouping and bulk filtering capabilities.

- New `CategoryMatchRuleSchema` and `CategoryGroupSchema` Zod schemas for defining named groups with rule-based matching (values list, pattern operators, or catch-all)
- New `CategorySearchFieldSchema` search field type that surfaces group names in the SearchPanel dropdown and compiles to CQL2 on selection
- New `categoryGroupToCql2` and `categoryGroupsToMaplibreExpression` utility functions for compiling groups to CQL2 filters and MapLibre `case` expressions
- New `CategoryGroupEditor` React component for admin UIs to configure groups (values picker, pattern operators, reorder)
- `LayerConfig` gains an optional `categoryGroups` field for reusable group definitions
- `fromStructuredFilters` now resolves category field selections to their CQL2 expressions automatically
