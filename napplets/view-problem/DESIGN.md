---
name: View Problem
description: A focused civic issue record for reading, acting, and discussing one problem.
colors:
  action-blue: "#145cff"
  action-blue-deep: "#0846cf"
  ink: "#171a21"
  body-ink: "#3d414c"
  muted-ink: "#6d7280"
  rule: "#dfe1e7"
  paper: "#ffffff"
  quiet-surface: "#f7f7f9"
  open-green: "#08744d"
  open-wash: "#e0f3e9"
  warning-focus: "#ffbf47"
  avatar-orange: "#d37022"
  avatar-blue: "#2f8cdb"
typography:
  display:
    fontFamily: "Avenir Next, Avenir, Segoe UI, sans-serif"
    fontSize: "clamp(3rem, 7vw, 5.8rem)"
    fontWeight: 700
    lineHeight: 0.94
    letterSpacing: "-0.04em"
  headline:
    fontFamily: "Avenir Next, Avenir, Segoe UI, sans-serif"
    fontSize: "clamp(2.35rem, 5.4vw, 4.5rem)"
    fontWeight: 700
    lineHeight: 1.02
    letterSpacing: "-0.035em"
  body:
    fontFamily: "Avenir Next, Avenir, Segoe UI, sans-serif"
    fontSize: "clamp(1rem, 1.8vw, 1.22rem)"
    fontWeight: 400
    lineHeight: 1.65
  label:
    fontFamily: "Avenir Next, Avenir, Segoe UI, sans-serif"
    fontSize: "0.76rem"
    fontWeight: 750
    lineHeight: 1.2
    letterSpacing: "0.1em"
  code:
    fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace"
    fontSize: "0.78rem"
    fontWeight: 400
    lineHeight: 1.4
rounded:
  control: "10px"
  field: "12px"
  pill: "99px"
  circle: "50%"
spacing:
  xs: "8px"
  sm: "12px"
  md: "20px"
  lg: "28px"
  xl: "48px"
components:
  button-primary:
    backgroundColor: "{colors.action-blue}"
    textColor: "{colors.paper}"
    rounded: "{rounded.control}"
    padding: "0 24px"
    height: "52px"
  button-primary-hover:
    backgroundColor: "{colors.action-blue-deep}"
    textColor: "{colors.paper}"
    rounded: "{rounded.control}"
  status-open:
    backgroundColor: "{colors.open-wash}"
    textColor: "{colors.open-green}"
    rounded: "{rounded.pill}"
    padding: "7px 13px"
  comment-field:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.field}"
    padding: "15px 17px"
    height: "54px"
---

# Design System: View Problem

## Overview

**Creative North Star: "The Civic Ledger"**

View Problem is a focused civic issue record: factual, open, and built for action. A white reading surface gives problem truth room to lead, while electric blue marks available actions with unmistakable clarity. Compact semantic state and protocol identifiers remain visible without competing with the title and description.

Discussion and edit history share one chronological ledger rather than separate sections or floating cards. Thin rules, generous vertical rhythm, and restrained motion keep the surface calm and accountable. The setup view carries the same system through a sparse connection glyph and oversized, tightly set heading.

**Key Characteristics:**

- White, editorial reading surface with one electric action color.
- Large, tightly tracked headings paired with compact uppercase labels.
- Continuous ruled sections instead of detached cards or panels.
- Semantic status expressed through quiet tinted pills.
- Responsive, keyboard-visible controls with restrained GSAP entrance motion.

## Colors

Palette is civic and direct: neutral paper and ink carry reading, electric blue identifies agency, and small semantic washes communicate state.

### Primary

- **Electric Action Blue:** Sole high-energy action color for primary buttons, interactive text, carets, and text selection.
- **Deep Action Blue:** Hover response for filled primary actions.

### Secondary

- **Open Green:** Text and indicator color for open workflow state.
- **Open Wash:** Quiet background for open-state pills.

### Tertiary

- **Ledger Orange:** Alternating discussion avatar identity color.
- **Contributor Blue:** Alternating discussion avatar identity color, distinct from action blue.

### Neutral

- **Civic Ink:** Primary headings and default control text.
- **Body Ink:** Long-form problem description text.
- **Muted Ink:** Metadata, supporting instructions, counts, and live status.
- **Ledger Rule:** Section dividers and structural lines.
- **Paper:** Root canvas and field surface.
- **Quiet Surface:** Hover fill for full-width related-problem rows.

### Named Rules

**The One Action Color Rule.** Reserve electric blue for agency: actions, links, carets, and selection. Do not use it as decorative surface fill.

**The Edit Authority Rule.** Keep Edit problem visible in top bar. Use action
blue only for authorized owner, current maintainer, or direct parent owner; use muted disabled styling
for every other identity.

**The Semantic Wash Rule.** Workflow state uses dark semantic text on a pale tint; color never carries state without a text label.

## Typography

**Display Font:** Avenir Next (with Avenir and Segoe UI fallbacks)  
**Body Font:** Avenir Next (with Avenir and Segoe UI fallbacks)  
**Label/Mono Font:** UI monospace (with SFMono-Regular and Consolas fallbacks)

**Character:** One humanist sans-serif family creates a cohesive public-record voice. Scale, tracking, weight, and case provide hierarchy; monospace is reserved for protocol coordinates and identifiers.

### Hierarchy

- **Display:** Heavy, oversized, tightly tracked type for the setup title; keep it narrow enough to break into a compact vertical statement.
- **Headline:** Large, balanced problem title with tight tracking and a readable maximum width of 22 characters.
- **Body:** Relaxed long-form problem description with a maximum width of 72 characters.
- **Label:** Small, weighty uppercase text with generous tracking for field labels and section counts.
- **Code:** Compact monospace text for coordinates and shortened identifiers only.

### Named Rules

**The Protocol Type Rule.** Use monospace only where content is protocol-shaped; never let identifiers set the tone of ordinary prose.

## Layout

Main record uses a centered fluid container capped at 1060px, with responsive inline padding from 20px to 72px. Content follows one vertical reading axis: top bar, problem copy, related ledger, discussion ledger, then live status. Horizontal rules define transitions without enclosing content.

Setup uses a two-column grid capped at 1040px. A sparse glyph occupies the first column; explanation and coordinate entry occupy the second. Fluid page padding and a wide clamp-based gap preserve deliberate whitespace.

At 680px and below, both surfaces collapse to one column. Actions stack and stretch, related rows move metadata below titles, comment controls stack, and discussion avatars shrink from 42px to 36px. Minimum supported width is 280px.

**The Continuous Record Rule.** Keep major regions on one reading surface. Use spacing and rules, not card grids, to establish hierarchy.

## Elevation & Depth

No shadows. Depth comes from typographic scale, tonal status washes, dividers, and whitespace. Hover states remain planar: filled actions deepen in color and ledger rows gain a quiet neutral wash.

**The Flat-by-Record Rule.** Public-record content stays on one plane; do not introduce floating cards, drop shadows, glass, or layered panels.

## Shapes

Structural content is square and ruled. Rounded geometry belongs to interactive fields and compact semantic markers: filled actions use gently curved 10px corners, text areas use 12px corners, status chips use a full pill, and avatars use circles. Setup coordinate controls remain square to reinforce their technical character.

**The Meaningful Curve Rule.** Curves signal action, editable input, state, or identity. Reading regions and ledger rows remain unboxed.

## Components

### Buttons

- **Shape:** Primary record actions use gently curved corners; setup submission stays square. Link actions are unboxed and underlined.
- **Primary:** White text on electric action blue, bold weight, 52px minimum height, and generous horizontal padding.
- **Closed Problem:** Replace unavailable claim control with Request merits. Keep same primary treatment and open composer beside this record without replacing it.
- **Hover / Focus:** Hover deepens the blue. Keyboard focus uses a high-contrast amber 3px outline with 3px offset.
- **Disabled:** Muted text on a cool gray fill; cursor communicates unavailability.
- **Link Action:** Electric-blue text, transparent background, underline offset for legibility.

### Chips

- **Style:** Compact pill, bold label, pale semantic fill, and a 7px current-color dot.
- **State:** Open, claimed, patched, and closed each use a distinct text-and-wash pair; every state remains readable without color alone.

### Cards / Containers

- **Corner Style:** None; sections and rows are continuous ledger structures.
- **Background:** Paper at rest; quiet neutral wash only on interactive-row hover.
- **Shadow Strategy:** None.
- **Border:** Single-pixel ledger rules separate regions and repeated rows.
- **Internal Padding:** Section rhythm ranges from 28px to 48px; discussion entries use 20px vertically.

### Inputs / Fields

- **Style:** Paper surface, one-pixel neutral border, comfortable 52–54px minimum height. Coordinate input is square and monospace; comment field is softly rounded and uses body type.
- **Focus:** Global amber focus outline remains outside control edge; text caret uses electric blue.
- **Error / Disabled:** Setup error text uses muted red and `aria-invalid`; publishing fields use cool gray disabled treatment.

### Navigation

Top bar is a 72px-high horizontal rule with an underlined change action at left and subdued short coordinate at right. It becomes no heavier on narrow screens.

### Discussion Ledger

Each comment aligns its author avatar and pubkey with date and body. Problem edits
appear inline by timestamp only when their predecessor revision is also loaded,
using the same author treatment plus status, revision identifier, and expandable
field diff. Initial publication never appears as edit history. Entries stay
separated by ledger rules and never become cards.

### Problem Author

Place compact owner signature directly below problem title: circular avatar,
small uppercase `Problem author` label, and resolved profile name. Keep pubkey
available as title text and use generated initials when profile data is absent.

### Motion

Setup elements enter with a short staggered rise; record sections use a smaller, faster rise. Both use GSAP `expo.out`. Reduced-motion preference removes these entrances entirely.

## Do's and Don'ts

### Do:

- **Do** preserve one clear vertical reading order from problem truth to action to related context to discussion.
- **Do** reserve electric blue for interactive agency and use pale semantic washes for status.
- **Do** keep protocol coordinates available in compact monospace without letting them dominate.
- **Do** retain visible amber keyboard focus and pointer-plus-Enter activation.
- **Do** use GSAP for purposeful motion and honor reduced-motion preference.

### Don't:

- **Don't** wrap record sections or individual comments in floating cards.
- **Don't** add shadows, gradients, glass effects, or decorative blue surface blocks.
- **Don't** use native form submission inside the sandboxed napplet.
- **Don't** replace restrained ledger separators with dense borders around every element.
- **Don't** animate content when reduced motion is requested.
