ALTER TYPE "AcceptanceStatus" ADD VALUE 'UNKNOWN';
ALTER TABLE "Batch" ADD COLUMN "dataVersion" INTEGER NOT NULL DEFAULT 0;

CREATE FUNCTION bump_offer_data_version() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE "Batch" SET "dataVersion" = "dataVersion" + 1 WHERE id = OLD."batchId";
    RETURN OLD;
  END IF;
  UPDATE "Batch" SET "dataVersion" = "dataVersion" + 1 WHERE id = NEW."batchId";
  IF TG_OP = 'UPDATE' AND OLD."batchId" IS DISTINCT FROM NEW."batchId" THEN
    UPDATE "Batch" SET "dataVersion" = "dataVersion" + 1 WHERE id = OLD."batchId";
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER offer_data_version AFTER INSERT OR UPDATE OR DELETE ON "Offer"
FOR EACH ROW EXECUTE FUNCTION bump_offer_data_version();

CREATE FUNCTION bump_package_data_version() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "Batch" SET "dataVersion" = "dataVersion" + 1
  WHERE id IN (SELECT "batchId" FROM "Offer" WHERE "compensationId" = NEW.id);
  RETURN NEW;
END;
$$;
CREATE TRIGGER package_data_version AFTER UPDATE ON "CompensationPackage"
FOR EACH ROW EXECUTE FUNCTION bump_package_data_version();
