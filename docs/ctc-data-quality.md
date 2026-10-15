# CTC data quality

Verified on 15 October 2026 using a fresh private production backup and the
original historical source audit. The source workbooks and backup remain outside Git.

| Batch | Outcomes | Awarded CTC known | Awarded CTC unknown | Recoverable source CTC quotes among unknowns |
| --- | ---: | ---: | ---: | ---: |
| 2022 | 1,826 | 1,286 | 540 | 217 |
| 2023 | 1,076 | 893 | 183 | 49 |
| 2024 | 1,165 | 713 | 452 | 208 |
| 2025 | 1,228 | 825 | 403 | 169 |
| 2026 | 1,243 | 874 | 369 | 125 |
| 2027 | 473 | 365 | 108 | 44 |
| Total | 7,011 | 4,956 | 2,055 | 812 |

The other 200 production outcomes are reserved synthetic fixtures, excluded
from public production analytics. They were preserved during verification.

Of 540 company/season/cycle groups with known awarded CTC, the old five-outcome
rule hid 263 groups covering 647 outcomes. The current policy exposes those
recorded amounts while retaining recipient anonymity.

## Interpretation and cleanup

A missing awarded CTC does not establish a missing source quote. Internship-only
records often advertise a possible FTE conversion package without confirming an
FTE award. Source quotes must remain separate from awarded CTC statistics,
rankings and filters. No amount is copied between companies, roles or years.

`historicalSourceQuote` normalizes only the exact structured summary at the
start of an anonymous historical archive package note, with archive ID and
source provenance checks. It rejects ranges, ambiguous decimal punctuation,
dates and arbitrary prose. Original notes and canonical compensation remain
unchanged. New imports with this same source-summary format work automatically;
ordinary student and admin submissions are not reinterpreted.

The current owner-directed policy shows known awarded CTC, source quotes and
stipends for every nonempty cohort, including a single outcome. The old
PRIVACY_MIN_COHORT_SIZE setting is ignored. “Not reported” means no awarded CTC is
recorded for the group. Recipient names and SRNs stay hidden, including on old
offers marked NAMED; new submissions always remain anonymous. Unknown values
stay unknown. Authenticated offer detail
shows the quoted base/CTC with the original explanation, including performance
conditions or conflicts.

The earlier source audit's 1,149 outcomes counted all outcomes in mixed source
groups where the first outcome lacked CTC. A fresh per-outcome check gives 812
unknown-awarded-CTC outcomes with preserved numeric quotes. Group counts must not
be reported as the count of missing individual compensation records.

Company profiles filter both trend rows and offer links by the selected batch.
All offer records can be reached through stable, ordered pagination. Absolute
INR grants/bonuses retain rupee units; annual lakh amounts retain LPA units.

## Verification

Lint, TypeScript, unit tests and production build passed. The fresh backup was
restored into a new, migrated localhost database. Queries confirmed the company
trend and directory recover the source quote independently from awarded CTC.
All 7,211 compensation records retained their original CTC, base, stipend and
notes. The 158 normalized source groups were compared with the original workbook
cells: 157 match plain numeric cells, and the remaining 8 LPA quote matches a
cell qualified “Non CS”; its eligibility qualifier remains in the source notes.
Unit tests cover source provenance, unknown/ambiguous amounts,
single-outcome visibility, name anonymity, CTC filtering and absolute/annual monetary units.
Rendered-page regression tests verify that legacy named offers do not fetch or
render recipient names/SRNs, while recorded CTC and exact CGPA remain visible.

This change needs no migration, imputation or overwrite of production records.
The normalization is applied when the live app reads existing source notes.
