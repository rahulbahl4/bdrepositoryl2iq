# bdrepositoryl2iq

## Baseline — team resource scheduler (`scheduler/`)

A lightweight resource-planning app in the style of tools like Float: see who is working on what, when, and how booked everyone is.

**Sample data:** fictional OT jobs (water treatment SCADA, substation automation, packaging line PLC and others) with Design, Integration, FAT, IFAT, Commissioning and SAT phases, and disciplines such as Controls Engineering, SCADA & Software and Commissioning.

**Run it:** open `scheduler/index.html` in a browser for the homepage, or `scheduler/app.html` to go straight to the app. There's no build step and no dependencies. You can also serve the folder, e.g. `npx serve scheduler`.

- `index.html`, `home.css`, `home.js`: the animated homepage, aimed at OT and automation teams. It has a live schedule preview of OT jobs, an animated project lifecycle (Design → Integration → FAT → IFAT → Install & commission → SAT → Handover), a feature grid, and a team wall showing utilization rings.
- `app.html`, `styles.css`, `app.js`: the scheduler app. Its logo links back to the homepage.

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
- **Time off, in bulk** (**+ Time off** on the Schedule or People page):
  - **Leave types:** Annual leave, Personal/carer's leave, Sick leave, Long service leave, RDO, Training, Conference, Site induction, Other. The Report breaks time off down by type.
  - **Choose people:** tick people one by one, or pick a whole discipline, a state, or everyone, then set the dates, a part day if needed, and the leave type.
  - **Paste a list** from Excel or an HR export (*name, first day, last day, type, hours*). Names are matched even when spelt slightly differently ("N. Patel"), and the preview flags anything it couldn't read.
  - **Repeating time off** for RDOs, 9-day fortnights and part-time days (e.g. every 2nd Friday). Public holidays are skipped. "Delete series from here" removes the rest of a series.
  - **Clash review** before saving: for each booking the leave overlaps, choose **Keep**, **Hand over** (those days become an unfilled slot to fill from the suggestions) or **Push back** (the work resumes after the leave).
- **Tentative** allocations appear as striped bars.
- **Projects**: client, color, billable or non-billable, archived.
  - **Start/end dates and budgeted hours.** You see budget used against remaining. Bookings outside the project dates get a dashed amber outline, and the booking form warns when a booking would go over budget or outside the dates. These are warnings only; nothing is blocked.
  - **Phases**, each with a name and start/end dates (e.g. Discovery, Design, Build), shown as bands on the schedule when grouped by project.
  - "View schedule" filters the timeline to a project.
- **Pipeline (potential wins)**: model bids before they land, without touching anyone's real workload.
  - Any project can be Confirmed or Pipeline, with a win chance, an expected decision date and a stage (Bidding or Shortlisted).
  - **Unfilled slots** set out the people a job needs before anyone is named (e.g. 2 × Controls Engineering, 8h/day). They show as dashed bars on the schedule.
  - Click a slot to see **who could fill it**: people ranked by discipline and free time, with warnings about overbooking, leave and holidays. Click **Assign**, or drag the slot onto a person.
  - A **Show** switch on the Schedule, People and Report pages chooses between *Confirmed only* (the default), *Confirmed + pipeline* and *Weighted by win chance*.
  - The **Pipeline page** lists every bid with its win chance, decision date, hours needed by discipline, how much is filled and who would be overbooked. Buttons mark a bid **Won** (optionally moving its dates; bookings become firm and unfilled slots stay flagged) or **Lost** (kept for the record, hidden from the schedule, can be reopened).
  - New projects can **copy phases and staffing from an existing job**. Its bookings become unfilled slots by discipline, moved to the new start date.
- **Capacity vs demand** (Capacity tab): week-by-week charts for the whole team and for each discipline.
  - Stacked bars show confirmed work, pipeline work by named people, and unfilled slots. A step line shows capacity after leave, public holidays and shutdowns. Weeks that are short are marked ▲ with the hours missing.
  - Each chart has a plain-English summary (e.g. *"166h short over 6 weeks between Nov 2 and Jan 3. Bids adding to it: …"*), a hover tooltip breaking down each week by bid, and a data table.
  - Use **Show** (confirmed / + pipeline / weighted) and the **bid buttons** to test what happens if particular bids win. The range can be 12, 26 or 52 weeks, and it exports to CSV.
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
