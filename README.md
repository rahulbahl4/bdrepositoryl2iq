# bdrepositoryl2iq

## Crewplan — team resource scheduler (`scheduler/`)

A lightweight resource-planning app in the style of tools like Float: see who is working on what, when, and how booked everyone is.

**Run it:** open `scheduler/index.html` in a browser (no build step or dependencies). Or serve the folder, e.g. `npx serve scheduler`.

### Features
- **Schedule timeline**: people as rows, days as columns, with Days / Weeks / Months zoom, Today and prev/next navigation.
  - Drag across empty cells to schedule work or time off.
  - Drag a bar to move it, including to another person. Hold **Alt** while dropping to copy it instead.
  - Drag a bar's edges to resize it. Click a bar to edit, duplicate or delete it.
- **Capacity and utilization**: each person has hours/day. A per-day load strip turns red (with a tinted cell) when someone is over-allocated, and each row shows utilization for the visible range.
- **Time off**: blocks capacity and appears as hatched bars.
- **Public holidays by state/region and shutdowns** (Holidays tab):
  - Give each person a state or territory from a dropdown that always lists NSW, VIC, QLD, SA, WA, TAS, NT and ACT. Use "Other…" for anywhere else. A holiday with a region applies only to people in that region; one with no region applies to everyone. Fixed-date holidays can repeat every year.
  - Add holidays one at a time, or paste a list (`date, name, region` per line).
  - Shutdowns are date ranges, such as an end-of-year closure, for everyone or for one region.
  - These days are removed from capacity, but they **don't block scheduling**. Work placed on them is still allowed and still counted, and it gets an amber marker instead of an over-capacity warning. The Report shows the capacity removed and the hours worked on those days.
- **Tentative** allocations appear as striped bars.
- **Projects**: client, color, billable or non-billable, archived.
  - **Start/end dates and budgeted hours.** You see budget used against remaining. Bookings outside the project dates get a dashed amber outline, and the booking form warns when a booking would go over budget or outside the dates. These are warnings only; nothing is blocked.
  - **Phases**, each with a name and start/end dates (e.g. Discovery, Design, Build), shown as bands on the schedule when grouped by project.
  - "View schedule" filters the timeline to a project.
- **People**: role, discipline, state/region, capacity; utilization this week and for the next 4 weeks; free hours.
- **Report**: capacity, scheduled, billable and non-billable hours, time off and utilization by person and by project, for any date range or preset.
- **Group by** None, Discipline or Project.
  - Project grouping shows a heading row per project (dates, phases, budget used), then each person booked on it. A final group lists people with no project in view.
  - Drag a booking onto a person's row under another project to move it to that project.
- **Disciplines**: a managed list (add, rename, delete on the People page), picked from a dropdown on each person. Older free-text departments are converted automatically.
- Search and filter by project.
- Undo/redo (Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z).
- Data is saved in the browser (localStorage). You can export/import JSON, export the schedule as CSV, or load sample data.
- Light and dark mode; works at phone width.
