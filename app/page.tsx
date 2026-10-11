import { redirect } from "next/navigation";

/** The overview is the landing surface; there is nothing useful to put before it. */
export default async function Home() {
  redirect("/overview");
}
