-- Tax identifier collected at application (field-encrypted; only the last 4 characters are kept in clear for display).
ALTER TABLE identity.advisors
  ADD COLUMN tax_id_enc   text,
  ADD COLUMN tax_id_last4 text;
