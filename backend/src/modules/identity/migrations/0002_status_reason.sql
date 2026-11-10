-- Why an advisor was suspended, reinstated or offboarded (FR-ADM-02), for the admin console and audit.
ALTER TABLE identity.advisors ADD COLUMN status_reason text;
ALTER TABLE identity.advisors ADD COLUMN status_changed_at timestamptz;
