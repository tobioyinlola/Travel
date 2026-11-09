-- Identity: users, contact verification, MFA, advisor applications (FR-AUTH-01..07).

CREATE TABLE identity.users (
  id                 uuid PRIMARY KEY,
  email              citext UNIQUE,
  phone              text UNIQUE CHECK (phone ~ '^\+[1-9][0-9]{6,14}$'),
  display_name       text,
  password_hash      text NOT NULL,
  role               text NOT NULL
                       CHECK (role IN ('advisor', 'team_lead', 'supplier_manager', 'support', 'finance', 'admin')),
  status             text NOT NULL DEFAULT 'pending_verification'
                       CHECK (status IN ('pending_verification', 'active', 'disabled')),
  email_verified_at  timestamptz,
  phone_verified_at  timestamptz,
  mfa_secret_enc     text,          -- AES-256-GCM via FieldCrypto
  mfa_enabled_at     timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  version            integer NOT NULL DEFAULT 1,
  CHECK (email IS NOT NULL OR phone IS NOT NULL)
);

CREATE TABLE identity.verification_codes (
  id           uuid PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES identity.users (id),
  channel      text NOT NULL CHECK (channel IN ('email', 'sms')),
  destination  text NOT NULL,
  code_hash    text NOT NULL,
  attempts     integer NOT NULL DEFAULT 0,
  expires_at   timestamptz NOT NULL,
  consumed_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX verification_codes_user_idx ON identity.verification_codes (user_id, created_at DESC);

CREATE TABLE identity.mfa_recovery_codes (
  user_id    uuid NOT NULL REFERENCES identity.users (id),
  code_hash  text NOT NULL,
  used_at    timestamptz,
  PRIMARY KEY (user_id, code_hash)
);

CREATE TABLE identity.advisors (
  id                      uuid PRIMARY KEY,
  user_id                 uuid NOT NULL UNIQUE REFERENCES identity.users (id),
  status                  text NOT NULL
                            CHECK (status IN ('applied', 'under_review', 'approved', 'active',
                                              'suspended', 'offboarded', 'rejected')),
  -- Application (FR-AUTH-03)
  legal_name              text NOT NULL,
  country                 char(2) NOT NULL,
  address                 jsonb NOT NULL,
  tax_residency           char(2) NOT NULL,
  experience              text NOT NULL CHECK (experience IN ('none', 'some', 'professional')),
  niche                   text NOT NULL,
  submitted_at            timestamptz NOT NULL,
  info_request_note       text,
  -- KYC result only, never raw ID images (FR-AUTH-04)
  kyc_status              text NOT NULL DEFAULT 'not_started'
                            CHECK (kyc_status IN ('not_started', 'pending', 'passed', 'failed')),
  kyc_provider            text,
  kyc_reference           text,
  kyc_redirect_url        text,
  kyc_checked_at          timestamptz,
  -- Independent contractor agreement (FR-AUTH-05)
  agreement_status        text NOT NULL DEFAULT 'not_sent'
                            CHECK (agreement_status IN ('not_sent', 'sent', 'signed', 'declined')),
  agreement_version       text,
  agreement_envelope_ref  text,
  agreement_signing_url   text,
  agreement_document_ref  text,
  agreement_signed_at     timestamptz,
  -- Review and lifecycle
  accepted_at             timestamptz,
  decided_by              uuid,
  approved_at             timestamptz,
  essentials_passed_at    timestamptz,
  activated_at            timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  version                 integer NOT NULL DEFAULT 1
);
CREATE INDEX advisors_status_idx ON identity.advisors (status, submitted_at, id);
CREATE UNIQUE INDEX advisors_kyc_ref_idx ON identity.advisors (kyc_provider, kyc_reference);
CREATE UNIQUE INDEX advisors_envelope_idx ON identity.advisors (agreement_envelope_ref);
