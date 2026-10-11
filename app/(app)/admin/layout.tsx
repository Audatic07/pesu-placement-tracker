import Link from "next/link";
import { requireRole } from "@/lib/auth/rbac";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const actor = await requireRole("ADMIN", "/admin");
  const links = [
    ["/admin", "Operations"],
    ["/admin/offers", "Outcomes"],
    ["/admin/imports", "Imports"],
    ["/admin/batches", "Batch settings"],
    ["/admin/reports", "Reports"],
    ["/admin/audit", "Audit log"],
  ];
  if (actor.role === "SUPER_ADMIN") links.push(["/admin/users", "Access"]);
  return (
    <>
      <nav
        aria-label="Administration"
        className="flex flex-wrap gap-x-5 gap-y-2 border-b px-6 py-3 text-[12px]"
        style={{ borderColor: "var(--line)", color: "var(--text-secondary)" }}
      >
        {links.map(([href, label]) => (
          <Link key={href} href={href!}>
            {label}
          </Link>
        ))}
      </nav>
      {children}
    </>
  );
}
