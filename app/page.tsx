import { redirect } from "next/navigation";
import { requireStudent } from "@/lib/auth/rbac";

/** The overview is the landing surface; there is nothing useful to put before it. */
export default async function Home() {
  await requireStudent("/");
  redirect("/overview");
}
