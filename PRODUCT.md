# PESU Placement Tracker — product truth

## What it is

A placement-statistics app for PES University students, authenticated with their
own PESU Academy credentials. It replaces a set of student-maintained Google
Sheets that had become the de-facto record of who hired whom, for how much, and
what the process was like.

## The mechanism

Students self-report their own offers, and the aggregate picture builds itself
from those reports. Every figure the old spreadsheets buried — in a cell colour,
a merged range, or a note column — is a field a student fills in here, which is
what lets it stay true after the spreadsheets stop being maintained.

The imported sheets are a cold start, not a source. They seeded the company list
and they give each recruiter a previous-years section on its own profile. No
statistic about a batch is computed from them. A batch nobody has reported on
shows that plainly rather than borrowing a number from 2026.

## Who uses it

**Students in their third and fourth year**, during a placement season that runs
from roughly August to February. They are anxious, comparing themselves to peers,
and making real decisions (accept this offer or hold out for a better tier) on
incomplete information. A minority are juniors planning a year ahead.

**One admin** (the project owner) resolving reports of suspicious data, with room
for more moderators later.

## What the visitor is here to do

Understand the overall scene: how this batch is doing, how it compares with the
previous one, and where they stand in it. Headline statistics and distributions
lead. Individual drives and company profiles are the second layer, reached from
there.

## What is uniquely true here

- **Compensation is structured, not a single number.** The source data records
  Meesho at 60 LPA with a note that most of the excess is a retention bonus paid
  over four to five years, and SAP at 26 LPA of which 8 lakhs is free meals and
  transport. The app separates headline CTC, first-year cash, recurring cash, and
  an estimated take-home, and shows the gap between them.
- **One live source, one archive, never averaged together.** Every batch figure
  counts one row per person who filed. Imported history is aggregate — IBM placed
  88 students, but not who, and at a package it advertised rather than one anyone
  confirmed receiving. Mixing the two would answer "what did students get" with
  "what companies published", so the archive is shown beside live figures and
  labelled, never summed into them.
- **Anonymity is structural.** Offers are anonymous by default, exact CGPA is
  banded in public views, and no statistic is shown for a cohort below five
  records — including maximums, which are one person's package wearing a hat.
- **Everything is batch-scoped configuration.** Tier boundaries, submission
  quotas, tax slabs. The 2026 sheet's own guidelines already note a tier that
  applied "to 2025 batch only".

## Constraints

- Built to be maintained for decades by rotating student maintainers.
- Real student data: privacy failures are the highest-severity defect.
- The PESU password passes through the server once and is never stored.

## Anti-goals (stated by the owner)

- **Not a leaderboard.** Placement season is stressful; the app must not turn it
  into a scoreboard of who got the biggest number.
- **Not enterprise software.** Not grey, dense and joyless.
- **Never flattering.** Low tiers, companies that ghosted the campus, and drives
  that hired nobody are shown as plainly as the 60 LPA offers.
- **Not over-designed or slow.** Reading a number must never wait on an animation.

## Brand commitment

The owner chose the category standard over an invented visual world, and named
**Linear** as the craft bar. That is a standing commitment, not a one-off
decision: this app is a dense, fast, keyboard-reachable工具-register application in the tool register —
persistent sidebar, composable filters, sortable tables, URL-addressable views —
executed at full fidelity rather than as a safe compromise. No irony, no
smuggled quirk, no invented visual metaphor.

Concretely, the bar means: every list filters and sorts; every view is a URL you
can send someone; navigation is instant and never loses your place; density is
high but never crowded; colour is restrained and carries meaning only.

## Surfaces and modes

| Surface | Mode | Note |
|---|---|---|
| Dashboard | Operate | The default landing surface. Leads with the scene. |
| Company profile | Operate | Year-over-year history for one recruiter. |
| Offer detail | Read | Compensation breakdown and the process notes. |
| Submission wizard | Operate | Quota-bound, one offer at a time. |
| Admin console | Operate | Report queue and audit trail. |
| Login | Operate | Single purpose; already built. |

Phone and desktop are equally important and each is designed as a first-class
layout rather than one adapting to the other.
