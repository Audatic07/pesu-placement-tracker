"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Plus, X } from "lucide-react";
import { submitOffer, type SubmitState } from "./actions";
import {
  Checkbox,
  Field,
  FormSection,
  Select,
  TextArea,
  TextInput,
} from "@/components/forms/fields";
import type { QuotaState } from "@/lib/policy/quota";

/**
 * The submission form.
 *
 * One page with labelled sections rather than a step-by-step wizard: a student
 * fills this in once, usually with the offer letter open beside them, and steps
 * would hide the fields they are copying from each other. Everything optional
 * is visibly optional, and the only truly required answers are the company, the
 * role and which kind of offer it was.
 */

const CYCLES = [
  { value: "FULL_TIME", label: "Full-time offer" },
  { value: "SIX_MONTH_INTERNSHIP", label: "Six-month internship" },
  { value: "SUMMER_INTERNSHIP", label: "Summer internship" },
];

const NATURES = [
  { value: "FTE_ONLY", label: "Full-time only" },
  { value: "INTERNSHIP_ONLY", label: "Internship only" },
  { value: "INTERNSHIP_PLUS_FTE", label: "Internship converting to full-time" },
  { value: "PPO_CONVERTED", label: "Summer internship that became a PPO" },
];

const ROLE_FAMILIES = [
  { value: "SDE", label: "Software engineering" },
  { value: "DATA_SCIENCE", label: "Data science / ML" },
  { value: "DATA_ENGINEERING", label: "Data engineering" },
  { value: "ANALYST", label: "Analyst" },
  { value: "QA_SDET", label: "QA / SDET" },
  { value: "DEVOPS_SRE", label: "DevOps / SRE" },
  { value: "EMBEDDED_HARDWARE", label: "Embedded / hardware" },
  { value: "CYBERSECURITY", label: "Cybersecurity" },
  { value: "PRODUCT", label: "Product / programme" },
  { value: "CONSULTING", label: "Consulting" },
  { value: "RESEARCH", label: "Research" },
  { value: "NON_TECH", label: "Non-technical" },
  { value: "OTHER", label: "Something else" },
];

const COMPONENT_KINDS = [
  { value: "", label: "—" },
  { value: "FIXED_BASE", label: "Fixed base" },
  { value: "VARIABLE_PAY", label: "Variable / performance pay" },
  { value: "JOINING_BONUS", label: "Joining bonus" },
  { value: "RETENTION_BONUS", label: "Retention bonus" },
  { value: "RELOCATION", label: "Relocation" },
  { value: "ESOP", label: "ESOPs" },
  { value: "RSU", label: "RSUs" },
  { value: "INSURANCE", label: "Insurance" },
  { value: "PERKS", label: "Perks (meals, transport)" },
  { value: "GRATUITY", label: "Gratuity" },
  { value: "PROVIDENT_FUND", label: "Provident fund" },
  { value: "OTHER", label: "Something else" },
];

const ROUND_KINDS = [
  // A blank default matters: the form offers two round rows, and without an
  // empty option an untouched row submits its default and creates a phantom
  // round on the offer. The action drops rows whose kind is blank.
  { value: "", label: "—" },
  { value: "ONLINE_ASSESSMENT", label: "Online assessment" },
  { value: "RESUME_SHORTLIST", label: "Resume shortlist" },
  { value: "GROUP_DISCUSSION", label: "Group discussion" },
  { value: "TAKE_HOME_ASSIGNMENT", label: "Take-home assignment" },
  { value: "HACKATHON", label: "Hackathon" },
  { value: "TECHNICAL_INTERVIEW", label: "Technical interview" },
  { value: "SYSTEM_DESIGN", label: "System design" },
  { value: "MANAGERIAL", label: "Managerial round" },
  { value: "HIRING_MANAGER", label: "Hiring manager" },
  { value: "HR", label: "HR round" },
  { value: "OTHER", label: "Other" },
];

const MODES = [
  { value: "UNKNOWN", label: "—" },
  { value: "ONLINE", label: "Online" },
  { value: "IN_PERSON", label: "In person" },
  { value: "HYBRID", label: "Hybrid" },
];

const WORK_MODES = [
  { value: "UNKNOWN", label: "—" },
  { value: "ONSITE", label: "In office" },
  { value: "HYBRID", label: "Hybrid" },
  { value: "REMOTE", label: "Fully remote" },
];

export function OfferForm({
  quota,
  companySuggestions,
  branches,
}: {
  quota: QuotaState;
  companySuggestions: string[];
  branches: Array<{ code: string; name: string }>;
}) {
  const [state, formAction] = useActionState<SubmitState, FormData>(submitOffer, {});
  const [componentRows, setComponentRows] = useState<number[]>([0]);
  const [roundRows, setRoundRows] = useState<number[]>([0, 1]);

  const available = quota.slots.filter((slot) => slot.remaining > 0);
  const exhausted = quota.slots.filter((slot) => slot.remaining === 0);

  if (available.length === 0) {
    return (
      <div
        className="rounded-[var(--radius-panel)] border px-4 py-6 text-[13px]"
        style={{ borderColor: "var(--line)", background: "var(--panel)" }}
      >
        You have recorded everything the policy for the batch of {quota.batchYear} allows. Editing an
        existing entry is the way to correct something.
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="batchYear" value={quota.batchYear} />

      {state.error ? (
        <p
          role="alert"
          className="rounded-[var(--radius-control)] px-3 py-2 text-[13px]"
          style={{
            background: "color-mix(in srgb, var(--critical) 12%, transparent)",
            color: "var(--critical)",
          }}
        >
          {state.error}
        </p>
      ) : null}

      <FormSection
        title="The offer"
        description="Only these three are required. Everything after this makes the shared picture better, but partial is far more useful than nothing."
      >
        <TextInput
          label="Company"
          name="companyName"
          required
          list="company-suggestions"
          placeholder="Start typing…"
          autoComplete="off"
          error={state.field === "companyName" ? state.error : undefined}
          hint="Pick an existing name where one matches, so this joins up with previous years."
        />
        <datalist id="company-suggestions">
          {companySuggestions.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>

        <TextInput label="Role title" name="roleTitle" required placeholder="e.g. SDE 1" />

        <Select
          label="Kind of offer"
          name="cycle"
          required
          options={quota.slots.map((slot) => ({
            value: slot.cycle,
            label:
              slot.remaining > 0
                ? `${slot.label} (${slot.remaining} left)`
                : `${slot.label} — none left`,
            disabled: slot.remaining === 0,
          }))}
          defaultValue={available[0]?.cycle}
          error={state.field === "cycle" ? state.error : undefined}
        />

        <Select label="What it grants" name="nature" options={NATURES} />
        <Select label="Kind of work" name="roleFamily" options={ROLE_FAMILIES} defaultValue="SDE" />
        <Select
          label="Did you take it?"
          name="acceptanceStatus"
          options={[
            { value: "PENDING", label: "Not decided yet" },
            { value: "ACCEPTED", label: "Accepted" },
            { value: "DECLINED", label: "Declined" },
            { value: "REVOKED", label: "The company withdrew it" },
          ]}
        />
      </FormSection>

      <FormSection
        title="The money"
        description="The headline number on its own hides a lot. Breaking it down is what lets everyone see how much of a package is actually cash — and your tier is worked out from the CTC, not chosen."
        columns={3}
      >
        <TextInput
          label="CTC (LPA)"
          name="ctcLpa"
          type="number"
          step="0.01"
          min="0"
          placeholder="e.g. 18.5"
          hint="The headline figure."
        />
        <TextInput
          label="Fixed base (LPA)"
          name="baseLpa"
          type="number"
          step="0.01"
          min="0"
          hint="What lands every month, before variable pay."
        />
        <TextInput
          label="Stipend (₹ per month)"
          name="stipendPerMonthInr"
          type="number"
          step="1000"
          min="0"
          hint="For internships."
        />
      </FormSection>

      <FormSection
        title="What makes up the package"
        description="Optional, and the most valuable thing you can add. A 40 LPA offer with 20 in unvested stock is a very different offer from 40 in cash, and nobody can tell them apart without this."
        columns={1}
      >
        <div className="flex flex-col gap-2">
          {componentRows.map((row) => (
            <div key={row} className="flex items-end gap-2">
              <div className="flex-1">
                <Select label="Component" name="componentKind" options={COMPONENT_KINDS} />
              </div>
              <div className="w-32">
                <TextInput label="LPA" name="componentAmount" type="number" step="0.01" min="0" />
              </div>
              <label
                className="flex h-[30px] items-center gap-1.5 whitespace-nowrap text-[12px]"
                style={{ color: "var(--text-secondary)" }}
              >
                <input type="checkbox" name="componentOneTime" value="true" className="size-[14px] accent-[var(--accent-solid)]" />
                One-time
              </label>
              {componentRows.length > 1 ? (
                <button
                  type="button"
                  aria-label="Remove component"
                  onClick={() => setComponentRows((rows) => rows.filter((value) => value !== row))}
                  className="grid h-[30px] w-7 place-items-center rounded-[var(--radius-control)]"
                  style={{ color: "var(--text-tertiary)" }}
                >
                  <X size={14} />
                </button>
              ) : null}
            </div>
          ))}
          <button
            type="button"
            onClick={() => setComponentRows((rows) => [...rows, (rows.at(-1) ?? 0) + 1])}
            className="inline-flex h-7 w-fit items-center gap-1.5 rounded-[var(--radius-control)] px-2 text-[12px]"
            style={{ color: "var(--accent)" }}
          >
            <Plus size={13} />
            Add a component
          </button>
        </div>
      </FormSection>

      <FormSection
        title="You, at the time"
        description="Shown in bands, never exactly, and never next to your name unless you choose to be named. This is what makes 'does CGPA actually matter' answerable."
        columns={3}
      >
        <TextInput label="CGPA" name="cgpa" type="number" step="0.01" min="0" max="10" />
        <TextInput label="Active backlogs" name="backlogsAtOffer" type="number" min="0" step="1" />
        <TextInput
          label="Internships before this"
          name="priorInternshipCount"
          type="number"
          min="0"
          step="1"
        />
      </FormSection>

      <FormSection
        title="The process"
        description="The part juniors will read most. Add the rounds you actually went through, in order."
        columns={1}
      >
        <div className="flex flex-col gap-2">
          {roundRows.map((row, index) => (
            <div key={row} className="flex items-end gap-2">
              <span
                className="tnum flex h-[30px] w-5 items-center text-[12px]"
                style={{ color: "var(--text-tertiary)" }}
              >
                {index + 1}
              </span>
              <div className="flex-1">
                <Select label="Round" name="roundKind" options={ROUND_KINDS} />
              </div>
              <div className="w-36">
                {/* The only place a season date is now recorded. Without it the
                    calendar has nothing to draw for any batch after 2026. */}
                <TextInput label="Date" name="roundHeldOn" type="date" />
              </div>
              <div className="w-28">
                <Select label="Mode" name="roundMode" options={MODES} />
              </div>
              <div className="w-20">
                <Select
                  label="Difficulty"
                  name="roundDifficulty"
                  options={[
                    { value: "", label: "—" },
                    ...[1, 2, 3, 4, 5].map((value) => ({
                      value: String(value),
                      label: String(value),
                    })),
                  ]}
                />
              </div>
              <div className="flex-1">
                <TextInput label="Topics" name="roundTopics" placeholder="DP, graphs, OS" />
              </div>
              {roundRows.length > 1 ? (
                <button
                  type="button"
                  aria-label="Remove round"
                  onClick={() => setRoundRows((rows) => rows.filter((value) => value !== row))}
                  className="grid h-[30px] w-7 place-items-center rounded-[var(--radius-control)]"
                  style={{ color: "var(--text-tertiary)" }}
                >
                  <X size={14} />
                </button>
              ) : null}
            </div>
          ))}
          <button
            type="button"
            onClick={() => setRoundRows((rows) => [...rows, (rows.at(-1) ?? 0) + 1])}
            className="inline-flex h-7 w-fit items-center gap-1.5 rounded-[var(--radius-control)] px-2 text-[12px]"
            style={{ color: "var(--accent)" }}
          >
            <Plus size={13} />
            Add a round
          </button>
        </div>

        <TextArea
          label="Notes on the process"
          name="processNotes"
          rows={6}
          placeholder="What they asked, what caught you out, how long between rounds, anything you wish you had known."
        />
        <TextArea
          label="What you prepared with"
          name="preparationResources"
          rows={3}
          placeholder="Sheets, books, courses, past questions."
        />
      </FormSection>

      <FormSection
        title="What the company asked for"
        description="The bar they announced, not what you had. This is the only way anyone can answer 'am I even eligible' for a batch — nobody publishes it, and last year's spreadsheet cannot know it."
        columns={1}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <TextInput
            label="CGPA cutoff they announced"
            name="announcedCgpaCutoff"
            type="number"
            step="0.01"
            min="0"
            max="10"
            placeholder="e.g. 8.5"
            hint="Leave blank if it was resume-based or never stated."
          />
          <Select
            label="Overall difficulty"
            name="difficultyRating"
            options={[
              { value: "", label: "—" },
              { value: "1", label: "1 — straightforward" },
              { value: "2", label: "2" },
              { value: "3", label: "3 — about average" },
              { value: "4", label: "4" },
              { value: "5", label: "5 — brutal" },
            ]}
          />
        </div>

        <fieldset className="flex flex-col gap-1.5">
          <legend className="text-[12px] font-medium">Branches they called for</legend>
          <p className="text-[12px] leading-snug" style={{ color: "var(--text-tertiary)" }}>
            Everyone who was eligible, not just yours.
          </p>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-2">
            {branches.map((branch) => (
              <label
                key={branch.code}
                title={branch.name}
                className="flex items-center gap-1.5 text-[13px]"
              >
                <input
                  type="checkbox"
                  name="eligibleBranches"
                  value={branch.code}
                  className="size-[14px] accent-[var(--accent-solid)]"
                />
                {branch.code}
              </label>
            ))}
          </div>
        </fieldset>
      </FormSection>

      <FormSection title="Terms" columns={3}>
        <TextInput label="Job location(s)" name="locations" placeholder="Bangalore, Hyderabad" />
        <Select label="Work mode" name="workMode" options={WORK_MODES} />
        <TextInput label="Date of the offer" name="offerDate" type="date" />
        <TextInput
          label="Bond / service agreement"
          name="bondMonths"
          type="number"
          min="0"
          step="1"
          hint="In months. 0 or blank if there is none."
        />
        <TextInput
          label="Internship length"
          name="internshipDurationMonths"
          type="number"
          min="0"
          step="1"
          hint="In months, where the offer includes one."
        />
      </FormSection>

      <FormSection title="Your name" columns={1}>
        <Checkbox
          name="showName"
          label="Show my name on this offer"
          hint="Off by default. Left off, this appears as an anonymous offer — your branch and a CGPA band are shown, never your name or SRN. You can change this later."
        />
      </FormSection>

      {exhausted.length > 0 ? (
        <p className="text-[12px]" style={{ color: "var(--text-tertiary)" }}>
          Already used up: {exhausted.map((slot) => slot.label.toLowerCase()).join(", ")}.
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <Submit />
        <span className="text-[12px]" style={{ color: "var(--text-tertiary)" }}>
          You can edit or remove this afterwards.
        </span>
      </div>
    </form>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex h-8 items-center rounded-[var(--radius-control)] px-3.5 text-[13px] font-medium disabled:opacity-60"
      style={{ background: "var(--accent-solid)", color: "var(--accent-fg)" }}
    >
      {pending ? "Recording…" : "Record this offer"}
    </button>
  );
}
