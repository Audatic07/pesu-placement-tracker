CREATE FUNCTION bump_component_data_version() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE package_id TEXT;
BEGIN
  package_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."packageId" ELSE NEW."packageId" END;
  UPDATE "Batch" SET "dataVersion" = "dataVersion" + 1
  WHERE id IN (SELECT "batchId" FROM "Offer" WHERE "compensationId" = package_id);
  IF TG_OP = 'UPDATE' AND OLD."packageId" IS DISTINCT FROM NEW."packageId" THEN
    UPDATE "Batch" SET "dataVersion" = "dataVersion" + 1
    WHERE id IN (SELECT "batchId" FROM "Offer" WHERE "compensationId" = OLD."packageId");
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER component_data_version AFTER INSERT OR UPDATE OR DELETE ON "CompensationComponent"
FOR EACH ROW EXECUTE FUNCTION bump_component_data_version();
