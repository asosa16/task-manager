# Verification Notes

## Preview check: Home

The signed-in home view now reads as a **narrow utility workspace** rather than a dashboard. The page uses a compact monochrome shell with a small header, centered Today table, and a lightweight right-side shortcut cheat sheet. The previously bloated framing is gone. The most visible remaining deviation from the extension is that the selected-row inline editor still appears somewhat web-app-like because it expands within the row.

## Preview check: Done

The done archive now matches the simplified language of the home page: plain heading, compact rows, minimal metadata, and a small right rail. It no longer feels like a separate editorial page.

## Preview check: Due

The due screen now works through the keyboard flow from the Today list and lands on a much cleaner intervention screen. The page shows a dark title bar, one main textarea for the smaller next step, one resnooze input, and only the necessary actions. This is much closer to the original Hero philosophy than the previous multi-card treatment.

## Production check

Immediately after pushing commit `aea98ac`, the public Vercel URL was still serving the previous authentication screen and shortcut card layout rather than the new compact shell. This suggests deployment propagation is still in progress or the production alias has not yet updated. A follow-up live check is still required before final delivery.
