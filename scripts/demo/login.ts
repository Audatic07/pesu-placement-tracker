import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client.js";
import { SignJWT } from "jose";

/**
 * Mints a session cookie for a demo student, so the app can be opened without
 * a PESU account.
 *
 *   npm run demo:login                 the first student of the 9998 batch
 *   npm run demo:login -- PES1UG24CS9007
 *
 * Used to test protected submission pages locally. Requires SESSION_SECRET
 * and direct database access, refuses production mode, and never contacts PESU.
 */

if (process.env.NODE_ENV === "production") {
  throw new Error("demo:login is a development utility and will not run in production.");
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set.");

const secret = process.env.SESSION_SECRET;
if (!secret || secret.length < 32) {
  throw new Error("SESSION_SECRET is missing or shorter than 32 characters.");
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function main() {
  const requested = process.argv[2]?.trim().toUpperCase();

  const student = requested
    ? await prisma.student.findUnique({ where: { srn: requested } })
    : await prisma.student.findFirst({
        where: { graduationYear: 9998 },
        orderBy: { srn: "asc" },
      });

  if (!student) {
    throw new Error(
      requested
        ? `No student with SRN ${requested}.`
        : "No demo students found. Run `npm run demo:9998` first.",
    );
  }

  const token = await new SignJWT({ srn: student.srn, role: student.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(student.id)
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(new TextEncoder().encode(secret));

  console.log(
    `\n${student.name} · ${student.srn} · batch ${student.graduationYear} · role ${student.role}\n`,
  );
  console.log("Paste this into the browser console on http://localhost:3000, then reload:\n");
  console.log(`  document.cookie = "pt_session=${token}; path=/"`);
  console.log("\nOr with curl:\n");
  console.log(`  curl -H "Cookie: pt_session=${token}" http://localhost:3000/overview\n`);
}

main()
  .catch((error) => {
    console.error(`\n${error instanceof Error ? error.message : error}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
