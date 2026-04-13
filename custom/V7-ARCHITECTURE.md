# V7 Architecture: KaTeX-with-Markers Renderer

## Overview

V7 uses a single rendering path: render **all** LaTeX structures via KaTeX natively with `\htmlId` markers, then swap markers for MathQuill (MQ) input fields or custom dropdown (DN) elements. This replaces V5's 3-path approach and V6's HTML extraction approach.

The key template is `\htmlId{prefix-N}{\boxed{\strut\phantom{x}}}`. KaTeX renders this as a `<span id="prefix-N">` containing a boxed placeholder. After KaTeX renders, `_replaceMarkers()` finds each span by ID and swaps it for an MQ slot or DN dropdown.

## Files

- `rational-eq-question-v7.js` -- Main renderer (question side)
- `rational-eq-scorer-v7.js` -- Scorer (server side), same as V6
- `rational-eq-question-v7.css` -- Styles
- Published to activity **V7-Custom-Questions** with items 193--195

## Key Design Decisions

### 1. Single path for all LaTeX structures

Fractions, superscripts, subscripts, `\left/\right`, `\sqrt`, `\lim`, `\log`, nth roots -- all handled by KaTeX natively. No HTML extraction or brace-depth scanning needed.

### 2. `\strut` in placeholders

The placeholder `\boxed{\strut\phantom{x}}` uses `\strut` to force KaTeX to allocate full font height+depth. Without it, MQ fields (which inherit KaTeX font-size) overflow the vlist and cover the fraction bar.

### 3. `\frac` to `\dfrac` promotion

When a math block contains input markers, `\frac{` is promoted to `\dfrac{` (display-style) using regex. The pattern `(^|[^d])\\frac\{` replaced with `$1\\dfrac{` prevents corrupting existing `\dfrac` into `\ddfrac`. Display-style fractions have more vertical spacing so the fraction bar remains visible between MQ fields.

### 4. MQ font-size inheritance

MQ fields inside KaTeX inherit the computed font-size at their nesting level via `font-size: inherit`. This means base-level MQ matches base KaTeX text, fraction MQ matches fraction text, superscript MQ matches superscript text -- all automatically.

### 5. DN placeholders extracted from math zones

`_extractDNFromMath(tpl, inputs)` is a pre-pass that splits `$...$` blocks at DN placeholder positions. For example, `$x = {{0}}$` becomes `$x =$ {{0}}` when input 0 is a dropdown. This prevents dropdowns from being wrapped in KaTeX fixed-width spans (which caused dead space).

### 6. DN option rendering

`_renderDNOption()` handles three cases:

- **Options with `$...$` inline math**: splits on `$` boundaries, renders math parts as KaTeX, wraps prose in `\text{}`
- **Options with `\text{}` already present**: renders directly as KaTeX (no word-wrapping transformation)
- **Plain options with math symbols**: auto-detects math, wraps English words in `\text{}`, converts `a/b` to `\frac{a}{b}`

### 7. DN dropdown sizing

Trigger min-width is set to the widest option (measured off-screen via `requestAnimationFrame`). On selection, min-width is cleared so the trigger shrinks to fit. The arrow is hidden via CSS when the dropdown is in the `.correct` state.

### 8. Custom dropdown (not native `<select>`)

`_buildDropdown()` creates a custom HTML dropdown with `getValue()`, `setValue()`, and `setDisabled()` methods on the DOM element. Options are shuffled with Fisher-Yates. KaTeX renders math in both trigger display and menu items.

## Bug Fixes During Development

### 1. Denominator not clickable

KaTeX's `vlist` reset row overlaps denominators, blocking pointer events. Fixed with CSS: `pointer-events: none` on `.vlist-s`, `.pstrut`, `.vlist-r:last-child` and `position: relative; z-index: 1` on MQ fields.

### 2. DN teacher view not showing selected value

`_updateTeacherFromResponse` used `select.value = saved.value` (native `<select>` property) but the custom dropdown uses the `setValue()` method. Fixed to call `ddEl.setValue(saved.value)`.

### 3. Fraction bar not visible (text-style `\frac`)

`\frac` renders with tight vertical spacing. MQ fields cover the thin frac-line. Fixed by promoting `\frac` to `\dfrac` when the expression contains input markers.

### 4. Fraction bar not visible (all fractions after font-size inherit)

Making MQ fields inherit KaTeX font-size made them taller, overflowing vlist spacing even in `\dfrac`. Fixed by adding `\strut` to placeholders so KaTeX allocates full font height.

### 5. MQ text smaller than surrounding KaTeX

MQ fields had fixed font-size (13--14px) while KaTeX renders at ~1.21em (~19px). Fixed with `font-size: inherit`.

### 6. DN options with pre-formatted LaTeX

Options containing `\text{}` were double-wrapped by the word-wrapping regex. Fixed by detecting `\text{` and rendering directly.

### 7. DN options with `$...$` inline math

Options like `either $p$ or $q$ is undefined` had `$` characters that caused KaTeX parse errors. Fixed by splitting on `$` boundaries and rendering math/prose parts separately.

### 8. Dead space after DN dropdowns

Initially caused by KaTeX fixed-width wrappers (fixed by extracting DN from math zones), then by dropdown `min-width: 120px/100px` (removed). Final sizing uses measured widest option.

### 9. KaTeX scaling in DN options

KaTeX inside dropdown items rendered 1.21x larger than surrounding text. Fixed with `font-size: 1em` on `.req-dd-trigger .katex` and `.req-dd-item .katex`.

## CSS Architecture (key rules)

| Selector | Rule | Purpose |
|---|---|---|
| `.req-widget .mq-slot` | `min-width: 48px` | Base MQ slot width |
| `.req-widget .katex .mfrac .mq-slot` | `min-width: 30px !important` | Fraction MQ slots |
| `.req-widget .katex .msupsub .mq-slot` | `min-width: 20px !important` | Superscript/subscript slots |
| `.req-widget .katex .mq-editable-field` | `font-size: inherit; font-family: inherit; position: relative; z-index: 1` | MQ sizing and clickability |
| `.vlist-s`, `.pstrut`, `.vlist-r:last-child` | `pointer-events: none` | Denominator clickability |
| `.req-dropdown-wrap.correct .req-dd-arrow` | `display: none` | Hide arrow on correct |
| `.req-dd-trigger .katex`, `.req-dd-item .katex` | `font-size: 1em` | Prevent KaTeX 1.21x scaling in dropdowns |

## Styling Spec (font sizes, colors, weights)

All styling is **self-contained** in `rational-eq-question-v7.css` and inline styles in `rational-eq-question-v7.js`. No Learnosity base styles are required — the renderer works identically standalone.

### Font Sizes

| Element | Size | Weight | Source |
|---|---|---|---|
| Question stem (stimulus) | 15px, line-height 1.7 | normal | JS inline (`$w.append(...)` line ~130) |
| Scaffold block paragraphs | 16px, line-height 1.7 | normal | CSS `.req-scaffold-block p` |
| MathQuill input fields | 16px (inherit from KaTeX) | normal | CSS `.req-mq-field` |
| Equation table annotations | 14px | normal | CSS `.req-tl-annot` |
| DN dropdown trigger | 16px | normal | CSS `.req-dd-trigger` |
| DN dropdown items | 15px | normal | CSS `.req-dd-item` |
| DN arrow | 12px | normal | CSS `.req-dd-arrow` |
| Feedback messages | 13px | 500 | CSS `.req-fb`, `.req-ca-feedback` |
| Next button | 16px | 600 | CSS `.req-next-btn` |
| Keypad buttons | 14px (button), 16px (KaTeX inside) | normal | CSS `.req-keypad-btn` |
| Hint label ("Hint:") | inherit | 700, normal style | CSS `.req-hint-label` |
| Hint body | 14px, line-height 1.7 | 400, normal style | CSS `.req-hint-body` |

### MQ Slot Sizes

| Context | Min-width |
|---|---|
| Base level | 48px |
| Inside fractions (`\mfrac`) | 30px |
| Superscript/subscript (`\msupsub`) | 20px |

### Colors

| Element | Color |
|---|---|
| Hint label | `#c0632a` (orange) |
| Hint body text | `#1a2a3a` |
| Hint box background | `#fff8f0` |
| Hint box border | `#f0c8a0` |
| Annotation text | `#b45309` |
| Correct feedback | `#16a34a` (green) |
| Incorrect feedback | `#dc2626` (red) |
| Next button | `#1565C0` (blue) |
| Scaffold blue bar | `#1565C0` |

### Hint Rendering

`_renderHint(hintText)` returns `{ html, modeClass }`:

- **Single-line** (`req-hint-inline`): "Hint:" label and body render inline on the same line
- **Multi-line** (`req-hint-multiline`): "Hint:" label is block, body is block below it
- Detection: multi-line if text contains `\n`, `<br>`, `<div>`, `<p>`, `<ul>`, `<ol>`, or rendered output contains `katex-display`
- Math in hints: `$$...$$` renders as display math, `$...$` renders as inline math (both via KaTeX)
- Teacher side: hint shown for active sub-step only, hidden on completion

### Teacher-Side Container UX

Containers group multiple MQ input boxes into a single validation unit. Two formats: `row.containers` (plural, V7/V5+) and `row.container` (singular, legacy).

**Teacher side:**
- Inputs in a container are wrapped in a `req-container-wrap` span (gray `#bdbdbd` border, `border-radius: 5px`)
- ONE badge number per container (not per individual box)
- Correct answers panel shows assembled answer per container (e.g., `(x-4)(x+4)`)
- Container wrap border turns green (`req-cwrap-correct`, `#3a9447`) or orange (`req-cwrap-incorrect`, `#e8883a`) with ✓/✗ inside the wrap
- Individual boxes inside containers do NOT show per-box red/green borders
- Row-level ✓/✗ feedback still appears at right edge as usual

**Student side:**
- No container wrapper visible — boxes render normally
- On check: all boxes in a container turn red or green together (container-level validation)
- Row-level ✓/✗ at right edge as usual

**Reference**: V5 item 9 (`V5-RationalEq-Extran-Q1`) in `POC-Custom-Questions` activity has the canonical container teacher UX.

## Learnosity Publishing

### Item References (current)

| Item | v1 Reference | v2 Reference | Q Prefix (v2) |
|---|---|---|---|
| 193 (Simplify) | `V7-SimplifyRational-Item193-v1` | `V7-SimplifyRational-Item193-v2` | `V7-simplify-rational-v2` |
| 194 (Multiply) | `V7-MultiplyRational-Item194-v1` | `V7-MultiplyRational-Item194-v2` | `V7-multiply-rational-v2` |
| 195 (Divide) | `V7-DivideRational-Item195-v1` | `V7-DivideRational-Item195-v2` | `V7-divide-rational-v2` |
| 200 (Add/Sub Like) | `V7-AddSubLikeDenom-Item200-v1` | — | `V7-addsub-like-v1` |
| 201 (Add/Sub Unlike) | `V7-AddSubUnlikeDenom-Item201-v1` | — | `V7-addsub-unlike-v1` |

**Activity**: `V7-Custom-Questions` — v2 items first, then v1 items, then 200-201.

### Widget → Question Reference Pattern

Each widget in an item becomes a Learnosity question: `{q_prefix}-W{i}` (e.g., `V7-simplify-rational-v2-W0`, `V7-simplify-rational-v2-W1`, ...).

### Question Types

- **Intro widgets** (W0): `clozetext` type with `instructor_stimulus: "concept-intro"`, empty template
- **Instruction widgets**: `custom` type with `instructor_stimulus: "instruction"`
- **Task widgets**: `custom` type with `instructor_stimulus: "task"`

### Custom Question Data Shape

```json
{
  "type": "custom",
  "custom_type": "rational_equation",
  "js": {
    "question": "https://curriculumhigh.github.io/leap-assets/custom/rational-eq-question-v7.js",
    "scorer": "https://curriculumhigh.github.io/leap-assets/custom/rational-eq-scorer-v7.js"
  },
  "css": "https://curriculumhigh.github.io/leap-assets/custom/rational-eq-question-v7.css",
  "stimulus": "Simplify $\\dfrac{x^2 + 3x - 10}{x^2 - 25}$.",
  "sections": [ ... ],
  "score": 13,
  "instant_feedback": true,
  "validation": { "scoring_type": "custom", "valid_response": { "score": 13, "value": "custom" } },
  "metadata": { "solution": ["<p>...</p>"], "sample_answer": "<p>...</p>" }
}
```

### Section Normalization (publish-time)

Consecutive `equation-row` sections are grouped into `equation-table` sections with a `rows[]` array. The V7 renderer expects this grouped format. Text sections with inputs are promoted to `text-with-input`. HTML tags in annotations are stripped. `[answer]` tokens in content are converted to `{{N}}` placeholders.

### Scoring

`score = max(count_inputs(sections), 1)` — one point per input field across all sections.

### Publishing Scripts

| Script | Items |
|---|---|
| `publish_custom_items_muldiv_v7.py` | 193-195 v1 |
| `publish_custom_items_addsub_v7.py` | 200-201 v1 |
| `publish_custom_items_193_195_v2.py` | 193-195 v2 |

## Standalone Preview (no Learnosity)

The V7 renderer runs fully standalone without Learnosity via a minimal shim in HighCurricStudio.

### Files

- `templates/preview_widget.html` — self-contained preview page
- `app.py` route: `/preview-widget`
- Preview button in editor opens a popup window

### How It Works

1. **Learnosity AMD shim**: `window.LearnosityAmd = { define: function(deps, factory) { window._v7Module = factory(jQuery); } }` — the V7 JS calls `LearnosityAmd.define(...)` on load, and the shim captures the module
2. **MockEvents**: minimal `on(name, fn)` / `trigger(name, data)` emitter satisfying the Learnosity events API
3. **Data flow**: opener sends widget JSON via `postMessage` → JS normalizes sections (equation-row → equation-table grouping, container shorthand, HTML stripping) → `new _v7Module.Question(init, {})`
4. **Dependencies**: jQuery 1.10.2, V7 JS/CSS from GitHub Pages CDN. The V7 JS loads its own sub-dependencies (KaTeX, MathQuill, nerdamer).

### Preview Styling

- LEAP-like: 767px max-width card, `#f5f0e8` beige background, white card with subtle shadow
- All font sizes, MQ inputs, keypad, hints, validation, sequential unlocking work identically to Learnosity deployment
