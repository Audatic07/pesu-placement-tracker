import { gunzipSync } from "node:zlib";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn<(role: string) => Promise<{ id: string }>>(),
  createLogicalBackup: vi.fn<(actorId: string) => Promise<unknown>>(),
}));
vi.mock("@/lib/auth/rbac", () => ({ requireRole: mocks.requireRole }));
vi.mock("@/lib/admin/backup", () => ({
  createLogicalBackup: mocks.createLogicalBackup,
}));
import { GET } from "../../app/api/admin/backup/route";

beforeEach(() => vi.resetAllMocks());

it("keeps a complete large private backup below the function payload limit", async () => {
  const backup = {
    format: "pesu-placement-backup",
    tables: {
      Student: [{ privateNotes: "synthetic repeated data ".repeat(300_000) }],
    },
  };
  mocks.requireRole.mockResolvedValue({ id: "owner" });
  mocks.createLogicalBackup.mockResolvedValue(backup);
  const response = await GET();
  const bytes = Buffer.from(await response.arrayBuffer());
  expect(JSON.stringify(backup).length).toBeGreaterThan(4_500_000);
  expect(bytes.length).toBeLessThan(4_500_000);
  expect(JSON.parse(gunzipSync(bytes).toString())).toEqual(backup);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(response.headers.get("Content-Type")).toBe("application/gzip");
  expect(response.headers.get("Content-Disposition")).toMatch(/\.json\.gz"$/);
  expect(mocks.requireRole).toHaveBeenCalledWith("SUPER_ADMIN");
  expect(mocks.createLogicalBackup).toHaveBeenCalledWith("owner");
});

it("refuses backup creation when owner authentication fails", async () => {
  mocks.requireRole.mockRejectedValue(new Error("Owner access required"));
  await expect(GET()).rejects.toThrow("Owner access required");
  expect(mocks.createLogicalBackup).not.toHaveBeenCalled();
});
