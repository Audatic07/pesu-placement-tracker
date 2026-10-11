import { RoleFamily } from "@/generated/prisma/enums";
import { TextArea, TextInput, Select } from "@/components/forms/fields";
import { AdminForm } from "../admin-form";
import { saveOffer } from "../actions";
import { CYCLE_LABELS, WORK_MODE_LABELS } from "@/lib/offers/labels";
import type { AdminOfferValues } from "@/lib/admin/input";

export function OfferEditor({
  batches,
  branches,
  initial,
  edit,
}: {
  batches: number[];
  branches: string[];
  initial?: Partial<AdminOfferValues>;
  edit?: { id: string; updatedAt: string };
}) {
  const value = initial ?? {};
  return (
    <AdminForm
      key={edit ? `${edit.id}:${edit.updatedAt}` : "new"}
      action={saveOffer}
      label={edit ? "Save outcome" : "Add outcomes"}
    >
      {edit ? (
        <>
          <input type="hidden" name="id" value={edit.id} />
          <input type="hidden" name="updatedAt" value={edit.updatedAt} />
        </>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Select
          label="Graduating batch"
          name="batchYear"
          defaultValue={String(value.batchYear ?? batches[0])}
          options={batches.map((year) => ({
            value: String(year),
            label: String(year),
          }))}
          required
        />
        {edit ? (
          <input type="hidden" name="headcount" value="1" />
        ) : (
          <TextInput
            label="Number of anonymous outcomes"
            name="headcount"
            type="number"
            defaultValue={1}
            min={1}
            max={100}
            required
            hint="Creates one outcome for each stated hire. This is not a count of distinct students across employers."
          />
        )}
        <TextInput
          label="Company"
          name="companyName"
          defaultValue={value.companyName}
          maxLength={160}
          required
        />
        <TextInput
          label="Role title"
          name="roleTitle"
          defaultValue={value.roleTitle}
          maxLength={160}
          required
        />
        <Select
          label="Cycle"
          name="cycle"
          defaultValue={value.cycle ?? "FULL_TIME"}
          options={Object.entries(CYCLE_LABELS).map(([option, label]) => ({
            value: option,
            label,
          }))}
        />
        <Select
          label="Outcome type"
          name="nature"
          defaultValue={value.nature ?? "FTE_ONLY"}
          options={[
            { value: "FTE_ONLY", label: "Full time" },
            { value: "INTERNSHIP_ONLY", label: "Internship only" },
            {
              value: "INTERNSHIP_PLUS_FTE",
              label: "Internship and confirmed FTE",
            },
            { value: "PPO_CONVERTED", label: "Converted PPO" },
          ]}
        />
        <Select
          label="Role family"
          name="roleFamily"
          defaultValue={value.roleFamily ?? "OTHER"}
          options={Object.values(RoleFamily).map((family) => ({
            value: family,
            label: family.replaceAll("_", " "),
          }))}
        />
        <Select
          label="Branch, if known"
          name="branchCode"
          defaultValue={value.branchCode ?? ""}
          options={[
            { value: "", label: "Unknown" },
            ...branches.map((code) => ({ value: code, label: code })),
          ]}
        />
        <TextInput
          label="CTC (LPA)"
          name="ctcLpa"
          type="number"
          step="0.001"
          min={0}
          max={1000}
          defaultValue={value.ctcLpa}
          hint="Leave unknown or conditional FTE compensation blank."
        />
        <TextInput
          label="Fixed base (LPA)"
          name="baseLpa"
          type="number"
          step="0.001"
          min={0}
          max={1000}
          defaultValue={value.baseLpa}
        />
        <TextInput
          label="Monthly stipend (INR)"
          name="stipendPerMonthInr"
          type="number"
          step="0.01"
          min={0}
          max={1_000_000}
          defaultValue={value.stipendPerMonthInr}
        />
        <TextInput
          label="Offer date, if known"
          name="offerDate"
          type="date"
          defaultValue={value.offerDate}
        />
        <Select
          label="Acceptance"
          name="acceptanceStatus"
          defaultValue={value.acceptanceStatus ?? "UNKNOWN"}
          options={[
            { value: "UNKNOWN", label: "Unknown" },
            { value: "PENDING", label: "Pending" },
            { value: "ACCEPTED", label: "Accepted" },
            { value: "DECLINED", label: "Declined" },
            { value: "REVOKED", label: "Revoked" },
          ]}
        />
        <Select
          label="Work arrangement"
          name="workMode"
          defaultValue={value.workMode ?? "UNKNOWN"}
          options={Object.entries(WORK_MODE_LABELS).map(([option, label]) => ({
            value: option,
            label,
          }))}
        />
        <TextInput
          label="Locations"
          name="locations"
          defaultValue={value.locations?.join(", ")}
          hint="Separate locations with commas."
        />
        <TextInput
          label="Announced CGPA cutoff"
          name="announcedCgpaCutoff"
          type="number"
          min={0}
          max={10}
          step="0.01"
          defaultValue={value.announcedCgpaCutoff}
        />
        <TextInput
          label="Bond (months)"
          name="bondMonths"
          type="number"
          min={0}
          max={120}
          defaultValue={value.bondMonths}
        />
        <TextInput
          label="Internship (months)"
          name="internshipDurationMonths"
          type="number"
          min={0}
          max={36}
          defaultValue={value.internshipDurationMonths}
        />
        <TextInput
          label="Eligible branches"
          name="eligibleBranches"
          defaultValue={value.eligibleBranches?.join(", ")}
          hint="Comma-separated branch codes. Leave unknown eligibility blank."
        />
      </div>
      <TextArea
        label="Process and source notes"
        name="processNotes"
        defaultValue={value.processNotes}
        rows={5}
      />
      <details className="text-[13px]">
        <summary className="cursor-pointer">Compensation components</summary>
        <div className="pt-3">
          <TextArea
            label="Components (JSON array)"
            name="componentsJson"
            rows={5}
            hint={
              'Optional. Example: [{"kind":"JOINING_BONUS","amountLpa":2,"isOneTime":true}]. On edit, blank preserves all existing components; [] clears them.'
            }
          />
        </div>
      </details>
      <TextInput
        label={edit ? "Reason for this edit" : "Source / provenance"}
        name="reason"
        minLength={5}
        maxLength={500}
        required
        hint="Recorded in the audit trail. Include the sheet, announcement or correction source."
      />
    </AdminForm>
  );
}
