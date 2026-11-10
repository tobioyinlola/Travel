-- Renewals and dunning (FR-MEM-03).
ALTER TABLE membership.memberships ADD COLUMN renewal_reminder_for timestamptz;  -- period end a reminder was sent for
ALTER TABLE membership.memberships ADD COLUMN past_due_since timestamptz;
ALTER TABLE membership.invoices ADD COLUMN kind text NOT NULL DEFAULT 'initial' CHECK (kind IN ('initial', 'renewal'));
ALTER TABLE membership.invoices ADD COLUMN next_attempt_at timestamptz;          -- dunning: when to try the card again
