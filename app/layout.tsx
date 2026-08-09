import type { Metadata } from "next";
import "./globals.css";

/**
 * The design direction this app was built to, kept where the built artifact
 * carries it. See DESIGN.md for the system it produced.
 */
const DIRECTION_CONTRACT = `<!--
THESIS: This surface is a list of the questions students actually ask in
placement season, each answered with one number and its honest caveat. It
refuses the KPI-tile grid over a wall of charts, which shows what is measurable
rather than what is asked, and has nowhere to put an answer's conditions.
OWN-WORLD: Near-neutral ink scale, one blue accent used only for data marks.
Hairline rules instead of card borders; the question set quieter than its
answer. No card inside another card.
STORY: A student learns how their batch is really doing, sees where headline
packages overstate the money, and can tell which figures the data cannot support.
FIRST VIEWPORT: Batch name and batch switcher, one line on how to read the page,
then the first question at reading scale with its answer beneath it. No stat-tile
row above the fold.
FORM: Question-led index; candidate 5 of 7 on the resonance-ordered list.
Seed key 4b3f57ea.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md
-->`;

export const metadata: Metadata = {
  title: "PESU Placement Tracker",
  description:
    "Placement statistics for PES University — tracked across batches, branches, tiers and companies.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        {/* The direction contract is emitted as a real HTML comment, not a JSX
            one: JSX comments are compiled away and never reach the markup, so a
            contract written that way cannot be audited in a built artifact. */}
        <div
          hidden
          dangerouslySetInnerHTML={{
            __html: DIRECTION_CONTRACT,
          }}
        />
        {children}
      </body>
    </html>
  );
}
