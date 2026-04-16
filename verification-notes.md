# Verification Notes

## Preview check: Home

The signed-in home view now reads as a **narrow utility workspace** rather than a dashboard. The page uses a compact monochrome shell with a small header, centered Today table, and a lightweight right-side shortcut cheat sheet. The previously bloated framing is gone. The most visible remaining deviation from the extension is that the selected-row inline editor still appears somewhat web-app-like because it expands within the row.

## Preview check: Done

The done archive now matches the simplified language of the home page: plain heading, compact rows, minimal metadata, and a small right rail. It no longer feels like a separate editorial page.

## Preview check: Due

The due screen now works through the keyboard flow from the Today list and lands on a much cleaner intervention screen. The page shows a dark title bar, one main textarea for the smaller next step, one resnooze input, and only the necessary actions. This is much closer to the original Hero philosophy than the previous multi-card treatment.

## Production check

Immediately after pushing commit `aea98ac`, the public Vercel URL was still serving the previous authentication screen and shortcut card layout rather than the new compact shell. This suggests deployment propagation is still in progress or the production alias has not yet updated. A follow-up live check is still required before final delivery.

## Preview check: Updated composer and save flow

After the new refactor, the quick-add surface is visibly closer to the original extension. It now opens as a dark, compact task-entry block with a **Task** label, a separate **Remind me** field, and a parsed reminder preview panel directly underneath. The project selector and recurring option are still available, but they no longer dominate the interaction. The visual hierarchy now favors the original extension rhythm: title first, wake-up time second, submit by keyboard.

- In the local preview, the revised quick-add composer accepts a task title in the first field and exposes the wake-up-time input directly underneath, preserving the intended task-first then reminder-second order.
- A manual Tab-key check was started in the browser session while the composer was focused so the add flow could be exercised in the same sequence as the extension.

A direct keyboard test in the local preview succeeded: after typing a task title and entering a natural-language wake-up time, pressing **Enter** in the reminder field saved the task immediately and inserted it into the Today list with the expected due label. This confirms the restored keyboard-first save flow in demo mode.

## Production check: signed-in state and live composer

On the live site after sign-in, the Today screen loads in the reduced monochrome shell with the user email at top, an empty-state message, and the right-side shortcut rail. Opening **New** reveals the dark inline composer on production as expected, with a title field, task/link toggle, recurring control, wake-up-time input, project selector, and explicit Save button. This confirms the latest UI refinements are deployed live and available in the authenticated environment.

I began live UUID-path verification by trying to create a temporary project named **QA UUID Project** on production. The input accepted the value, but the first click on **Add** did not visibly change the page state, so I am continuing with a second interaction path rather than assuming the project was created.

The first production project-creation retry before the latest patch surfaced the same backend failure in a toast: `invalid input syntax for type uuid`, with a nanoid-like identifier. After pushing commit `69de134` and waiting for deployment, production refreshed back to the signed-in empty Today state without the prior error visible, which indicates the new build is ready for a clean re-test of project and task creation.

On the refreshed production build, creating **QA UUID Project** by pressing Enter in the project input succeeded and rendered the new project chip in the Today view. I then opened the quick-add composer and confirmed the live form now exposes the task field, reminder field, recurring toggle, and project selector, with the new project available as a selectable UUID-backed option.

I entered **QA keyboard save flow** into the production task field and then pressed **Tab**. The composer remained open with the task text preserved and no unexpected submit or dismissal, which is consistent with the intended keyboard-first flow, but I still need to confirm the newly focused control explicitly before finalizing the verification.

I confirmed the production keyboard flow explicitly: after pressing **Tab**, the focused element was the reminder input with placeholder `Try: 8 am, in 2 hours, aug 7, today 12:30pm`. I then entered **today 11:45pm** and pressed **Enter**, which successfully saved the task and showed the confirmation toast **Saved for Today · 11:45 PM.** The new row appeared immediately in the Today list under **QA UUID Project**, confirming both the live task save path and the project-linked UUID path are now working in production.

## Local check: responsive usability pass

The refreshed Today screen now uses a single main panel with the shortcut reference demoted to a collapsible block on narrower layouts, which is a materially better baseline for phone use than the earlier three-column shell. The quick-add composer is visibly more touch-friendly, with stacked fields, clearer section labels, and a dedicated save button in addition to the preserved keyboard flow. Each task row now exposes an explicit **Open** action alongside done/delete controls, so reaching the due-flow on a phone no longer depends on keyboard shortcuts alone. The desktop preview still keeps the restrained monochrome extension language rather than slipping back into a dashboard treatment.

## Local check: responsive secondary routes

The updated Done route now presents as the same restrained shell with a stacked archive row instead of the old table-heavy treatment, which should translate more cleanly to phone widths. Returning from Done to Today in the local preview works without layout breakage, so the simplified cross-route shell is internally consistent after the responsive refactor.

## Local check: responsive due flow

Opening a task from Today now lands on a simplified due screen with one clear textarea, one resnooze field, and large action buttons, which is a better fit for phone use than the previous denser layout. Returning from the due route back to Today works cleanly, so the main mobile-oriented workflow remains connected end to end.

Production recheck after reconnecting GitHub: the live site now reflects the minimalist redesign commit. The default route is Today, the single one-line input is present with the prompt `follow up with Katherine tomorrow 9am`, shortcuts are not exposed in the main shell, and navigation shows Today, All, Analytics, and Done in a minimal top bar. The current production list shows the reduced monochrome rows and sparse action buttons, confirming the new design is deployed.

Additional production verification: clicking the corner `?` opens a compact help panel instead of exposing shortcuts inline by default, matching the requested hidden-help behavior. The live app also routes to `/all` from the top navigation, confirming that All is now a first-class view distinct from the default Today route, even though the open help panel visually overlapped part of the list during this check.

Final production route verification: the Analytics page is live and shows the new daily-completions summary shell, and returning to Today restores the minimal single-field list view cleanly. This confirms the redesigned navigation works across Today, All, and Analytics on production, with Today remaining the default landing view.

## Local check: post-fix Today shell

The Today view now shows a clearer **Done** control in each row (`✓ DONE`) instead of a lone glyph, which better communicates the action without breaking the spare monochrome language.

The one-line composer and minimal shell are still intact after the latest patch, so the additional affordance did not visibly bloat the list layout.

Next browser checks queued:

1. Press `E` on a selected row and confirm the rename input receives focus immediately.
2. Press `Escape` while an input is focused and confirm the field blurs cleanly.
3. Mark a task done and confirm both the green completion flash and the `Press Z to undo.` toast appear.
4. Verify local-time parsing behavior for `tomorrow morning` in the live preview.

## Local check: keyboard edit focus

Using the `E` shortcut on the selected task opens the inline rename panel and the browser reports that the active element is the rename **input** with the selected task title already loaded. This confirms the requested **auto-focus into the task name field** is now working from the keyboard path.

## Local check: Escape unfocus

After opening inline rename with `E`, pressing `Escape` closes the editor and the browser reports that the active element becomes `BODY`. This confirms the focused input is being **blurred/unfocused** instead of remaining trapped.

## Local check: mark done flow (initial pass)

Clicking the visible **Done** control successfully removed the task from Today and incremented the completion count from **1 done today** to **2 done today**, confirming the action path still works after the affordance update.

The first visual pass did not capture the green flash or toast because they appear briefly, so I am continuing with a more targeted DOM-level inspection for those transient states.

## Local check: natural-language time preview

Entering `call mom tomorrow morning` into the one-line composer now renders the preview text **Wake up tomorrow at 9:00 AM.** and the parsed title becomes **call mom**. This confirms the ambiguous `morning` phrase is being normalized to a more reasonable morning hour and is resolving to the **next day**, not the current day.

## Local check: default focus and Tab route cycling

After the latest interaction pass, the browser reports that the composer is still the active element on load. The main input is focused immediately, which satisfies the requested keyboard-first default state.

Pressing **Tab** from the composer now changes the route from **Today** to **All** instead of moving browser focus through the header controls. A follow-up DOM check confirmed the path becomes `/all` and the composer remains the active input on that route, so the app stays ready for immediate typing after the view switch.

## Local check: forward Tab cycle regression

The first **Tab** from Today works correctly and lands on **All** while keeping the composer focused. However, a second **Tab** from that focused composer returns to **Today** instead of advancing to **Done**. A DOM check confirmed the path had reverted to `/` while the composer remained focused, so the forward Tab cycle still needs one more fix before final delivery.

## Local check: forward Tab cycle fixed

After the follow-up patch, opening **All** directly and pressing **Tab** now lands on **Done** as intended. The previous bounce back to Today is gone, so the forward cycle across **Today → All → Done** is now behaving correctly.

## Local check: reverse Tab cycle resumed

After resuming the stalled browser session, a direct DOM check confirmed that the earlier **Shift+Tab** interaction from **Done** had landed on **All** and kept the composer focused. This means the reverse cycle is now working at least for **Done → All**.

## Local check: reverse cycle to Today and arrow-test setup

Continuing after the stalled run, **Shift+Tab** from **All** successfully returned the app to **Today**, and the composer remained focused there. I also confirmed that the Today view currently shows only one visible task row, so meaningful up/down selection movement needs to be validated on **All**, where multiple rows are present.

On **All**, the selected row before the arrow-key test is the first visible task, **Test keyboard save flow**.

## Local check: ArrowDown selection movement

On the **All** route, pressing **ArrowDown** moves the selected row from **Test keyboard save flow** to **Read that essay on quiet software tools**. The DOM inspection shows the selection highlight transferring from the first article to the second, so downward keyboard navigation through the list is working.

## Local check: completed reverse cycle and ArrowUp movement

The resumed reverse route cycle now works end to end: **Done → All** was confirmed earlier, and **All → Today** also succeeds with **Shift+Tab**, while the composer remains focused and ready for input after each route change.

The list-navigation check is also complete on **All**. After **ArrowDown** moved the selection from the first task to the second, pressing **ArrowUp** moved the highlight back to **Test keyboard save flow**. This confirms both upward and downward keyboard movement through the visible task rows.
