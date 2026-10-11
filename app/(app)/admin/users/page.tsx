import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth/rbac";
import { PageHeader, EmptyState, Panel } from "@/components/ui/primitives";
import { TextInput, Select, Checkbox } from "@/components/forms/fields";
import { FilterBar } from "@/components/data/filter-bar";
import { Pagination } from "@/components/data/table";
import {
  positiveInteger,
  singleParams,
  type SearchParams,
} from "@/lib/query-params";
import { AdminForm } from "../admin-form";
import { changeUser } from "../actions";

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireRole("SUPER_ADMIN");
  const params = singleParams(await searchParams),
    q = (params.q ?? "").slice(0, 100),
    page = Math.min(positiveInteger(params.page), 10000);
  const where = q
    ? {
        OR: [
          { srn: { contains: q, mode: "insensitive" as const } },
          { name: { contains: q, mode: "insensitive" as const } },
        ],
      }
    : {};
  const [users, count] = await Promise.all([
    prisma.student.findMany({
      where,
      orderBy: [{ role: "desc" }, { srn: "asc" }],
      take: 20,
      skip: (page - 1) * 20,
      select: {
        id: true,
        srn: true,
        name: true,
        role: true,
        isSuspended: true,
        updatedAt: true,
      },
    }),
    prisma.student.count({ where }),
  ]);
  return (
    <>
      <PageHeader
        title="Account access"
        description="Owners manage access. Accounts appear after a verified PESU login; no separate admin password exists."
      />
      <FilterBar facets={[]} searchPlaceholder="Search SRN or name…" />
      <div className="max-w-4xl space-y-3 p-6">
        {users.length ? (
          users.map((user) => (
            <Panel key={user.id} title={`${user.srn} · ${user.name}`}>
              <details className="p-4 text-[13px]">
                <summary className="cursor-pointer">
                  {user.role === "SUPER_ADMIN"
                    ? "Owner"
                    : user.role === "ADMIN"
                      ? "Admin"
                      : user.role === "VERIFIER"
                        ? "Verifier"
                        : "Student"}
                  {user.isSuspended ? " · suspended" : ""} — manage access
                </summary>
                <div className="pt-4">
                  <AdminForm
                    key={user.updatedAt.toISOString()}
                    action={changeUser}
                  >
                    <input type="hidden" name="id" value={user.id} />
                    <input
                      type="hidden"
                      name="updatedAt"
                      value={user.updatedAt.toISOString()}
                    />
                    <Select
                      label="Role"
                      name="role"
                      defaultValue={user.role}
                      options={[
                        {
                          value: "STUDENT",
                          label: "Student — own submissions",
                        },
                        {
                          value: "VERIFIER",
                          label: "Verifier — student access (reserved)",
                        },
                        {
                          value: "ADMIN",
                          label: "Admin — data, imports, policies and reports",
                        },
                        {
                          value: "SUPER_ADMIN",
                          label: "Owner — admin access plus account management",
                        },
                      ]}
                    />
                    <Checkbox
                      name="suspended"
                      label="Suspend this account"
                      defaultChecked={user.isSuspended}
                      hint="Blocks login and existing sessions; contributions remain."
                    />
                    <TextInput
                      label="Reason"
                      name="reason"
                      minLength={5}
                      maxLength={500}
                      required
                    />
                  </AdminForm>
                </div>
              </details>
            </Panel>
          ))
        ) : (
          <EmptyState title="No matching accounts" />
        )}
      </div>
      <Pagination
        page={page}
        pageSize={20}
        pageCount={Math.ceil(count / 20)}
        total={count}
        query={{ pathname: "/admin/users", params }}
      />
    </>
  );
}
