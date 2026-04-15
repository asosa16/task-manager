# Hero Web Simplification Plan

## What the original extension actually felt like

The original Hero UI was not a dashboard. It was a **centered list workspace** with a tiny header, a narrow main column, and a modest cheat sheet on the right. Most of the interface was plain white or light gray with black text, thin borders, compact rows, and almost no ornamental framing. The visual emphasis belonged to the list itself, not to surrounding panels or marketing copy.

The keyboard model was equally opinionated. The core loop was: move selection, mark done, delete, edit time, open link, undo. The interface existed mainly to support that loop.

## Current web-app elements that feel bloated

| Current pattern | Why it feels wrong |
| --- | --- |
| Large editorial landing/auth hero | Reads like a product page instead of a utilitarian tool |
| Multiple oversized cards and side panels | Competes with the list instead of supporting it |
| Large serif headlines repeated across sections | Makes the product feel theatrical rather than fast |
| Metrics and explanatory copy in the main workflow | Adds noise to a tool that should feel immediate |
| Separate “selected item” panel and “wake-up mode” framing on home | Duplicates information that should live inline or in the due flow |
| Project pills and actions styled as heavy dashboard controls | The extension felt lighter and more table-like |
| Extra signposting and brand copy around auth | Slower than a compact sign-in gate |

## Minimal target for the next refactor

1. The signed-in home page should become a **single centered upcoming/today table** with the right-side shortcut cheat sheet.
2. The header should be reduced to a small Hero mark, the wordmark, and only the most necessary navigation/actions.
3. The main list should use compact rows with due time, item title, and minimal action affordances.
4. The selected-row experience should be expressed primarily by row focus styling and lightweight inline editing, not by large side panels.
5. The auth screen should be compact and quiet, not a marketing page.
6. The done page and due page should also be reduced to the same monochrome utility language.

## Shortcut model to preserve closely

| Key | Target behavior |
| --- | --- |
| `j` / `k` or arrows | Move selection |
| `d` | Mark selected item done |
| `Delete` / `Backspace` | Delete selected item |
| `e` | Edit selected item time inline |
| `Enter` / `o` | Open selected link |
| `z` | Undo last delete/done |
| `n` | Open quick add |
| `Tab` | Move between Upcoming and Done where appropriate |

## Web-specific compromises that should remain minimal

The app still needs authentication and mobile access, but those should feel like a thin wrapper around the original Hero behavior, not a new product category. Supabase sync stays, projects stay, and responsive behavior stays, but the UI should look and behave much closer to the extension.
