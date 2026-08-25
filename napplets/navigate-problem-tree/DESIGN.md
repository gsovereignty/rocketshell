---
name: Navigate Problem Tree
description: A quiet operations index for moving through a problem DAG.
colors:
  electric-blue: "#145cff"
  electric-blue-deep: "#0846cf"
  ink: "#181b22"
  muted-ink: "#6d7280"
  line: "#dfe1e7"
  panel: "#f4f4f6"
  surface: "#ffffff"
  open: "#08744d"
  open-soft: "#e0f3e9"
  claimed: "#8a5a00"
  claimed-soft: "#fff0ce"
  patched: "#5e3fa3"
  patched-soft: "#ede5ff"
typography:
  display:
    fontFamily: "Avenir Next, Avenir, Segoe UI, sans-serif"
    fontSize: "clamp(2.8rem, 7vw, 5.8rem)"
    fontWeight: 700
    lineHeight: 0.94
    letterSpacing: "-0.04em"
  body:
    fontFamily: "Avenir Next, Avenir, Segoe UI, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "Avenir Next, Avenir, Segoe UI, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 750
    letterSpacing: "0.1em"
rounded:
  control: "9px"
  group: "12px"
  status: "99px"
spacing:
  compact: "8px"
  standard: "16px"
  pane: "28px"
components:
  button-primary:
    backgroundColor: "{colors.electric-blue}"
    textColor: "{colors.surface}"
    rounded: "0"
    padding: "0 20px"
  tree-current:
    backgroundColor: "{colors.electric-blue}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: "9px 12px"
---

# Design System: Navigate Problem Tree

## Overview

**Creative North Star: "The Operations Index"**

Dense, calm navigation borrows from working indexes and issue browsers. Structure
does most visual work: a pale outline surface, a white action surface, quiet
vertical indentation guides, and one electric-blue current position. Setup uses same geometry
at larger scale so missing configuration feels like first step, not dead end.

**Key Characteristics:**

- Split structural outline and direct-child list.
- Electric blue appears only for selection and primary action.
- Flat surfaces separated by tone and one-pixel rules.
- Compact labels, generous row targets, explicit state chips.

## Colors

Restrained neutral palette with one high-energy navigation accent. Semantic state
colors always pair dark text with a pale tonal background.

**The Current Position Rule.** Electric blue identifies current position or next
decisive action; it does not decorate passive regions.

## Typography

**Display and Body Font:** Avenir Next with Avenir and Segoe UI fallbacks.

Display type is dense and decisive on root setup. Working views use compact body
type and uppercase labels, letting problem titles carry hierarchy.

- **Display:** 700 weight, responsive 2.8–5.8rem, .94 line-height.
- **Body:** 1rem with 1.6 line-height for explanatory copy.
- **Title:** 1rem medium weight inside navigation rows.
- **Label:** .75rem heavy uppercase with .1em tracking for pane headings.

## Layout

Desktop uses 42/58 split: scrollable DAG outline left, direct children right.
Pane padding is 22–28px and row targets are at least 46px. Below 760px panes
stack; outline receives at most 44vh so child navigation remains reachable.
Setup uses asymmetric two-column composition and collapses to one column.

## Elevation & Depth

System stays flat. Tonal surfaces and one-pixel dividers establish depth. Only
selected filter uses a small ambient shadow to clarify control state.

## Shapes

Rows and controls use 8–12px corners. Status and fork labels use pill shapes
because they are compact state tokens. Main pane boundaries stay square.

## Components

### Buttons

Primary buttons use electric blue, white text, and no radius in setup. Hover
deepens blue. Focus always uses visible amber three-pixel outline.

### Chips

Filter controls sit in one shared gray group. Selected filter lifts onto white.
Status chips use semantic foreground/background pairs and tabular counts.
A full-width title search sits directly above status filters. Text and status
filters intersect; search remains visible and usable at every pane width.

### Inputs / Fields

Coordinates use square white fields, one-pixel neutral stroke, and monospace only
for protocol data. Leaf search uses body type, a compact rounded field, and a
visible label. Input and action stack below 760px.

### Navigation

Tree nodes show title, unique descendant count, and fork state. Current node uses
solid blue. Activating any tree node or child row opens that problem in the
visible default problem viewer without replacing the DAG. A full-width action
above the tree opens a composer for a new problem directly under the hidden root.

## Do's and Don'ts

### Do:

- **Do** reserve electric blue for current position and primary actions.
- **Do** keep DAG hierarchy visible through indentation and thin continuous
  vertical guides. Guides stay neutral so current-position emphasis belongs to
  tree nodes.
- **Do** keep child rows dense while preserving keyboard-sized targets.
- **Do** reflow panes vertically on narrow screens.

### Don't:

- **Don't** render problem descriptions in this navigation surface.
- **Don't** turn each problem into an elevated card.
- **Don't** use monospace beyond coordinates, IDs, and measurements.
- **Don't** hide missing root or missing viewer states.
