CREATE TABLE certificates (
  hash TEXT PRIMARY KEY NOT NULL CHECK(length(hash) = 64 AND hash NOT GLOB '*[^a-f0-9]*'),
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  signature TEXT NOT NULL CHECK(length(signature) = 86),
  key_id TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  credential_jwt TEXT NOT NULL,
  template_id TEXT NOT NULL CHECK(template_id IN ('program-v1', 'talk-v1')),
  CHECK(json_extract(payload_json, '$.templateId') = template_id)
) STRICT;

CREATE TRIGGER certificates_prevent_update
BEFORE UPDATE ON certificates
BEGIN
  SELECT RAISE(ABORT, 'Certificates are immutable');
END;

CREATE TRIGGER certificates_prevent_delete
BEFORE DELETE ON certificates
BEGIN
  SELECT RAISE(ABORT, 'Certificates are immutable');
END;
