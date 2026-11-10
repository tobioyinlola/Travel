-- Learning: courses, lessons, quizzes, progress (FR-LRN-01, 02).

CREATE TABLE learning.courses (
  id             uuid PRIMARY KEY,
  slug           text NOT NULL UNIQUE,
  title          text NOT NULL,
  summary        text NOT NULL,
  is_essentials  boolean NOT NULL DEFAULT false,
  pass_mark_pct  integer NOT NULL CHECK (pass_mark_pct BETWEEN 1 AND 100),
  published      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now()
);
-- Exactly one course gates booking.
CREATE UNIQUE INDEX courses_one_essentials ON learning.courses (is_essentials) WHERE is_essentials;

CREATE TABLE learning.lessons (
  id           uuid PRIMARY KEY,
  course_id    uuid NOT NULL REFERENCES learning.courses (id),
  position     integer NOT NULL,
  title        text NOT NULL,
  body_md      text NOT NULL,
  est_minutes  integer NOT NULL,
  UNIQUE (course_id, position)
);

CREATE TABLE learning.quiz_questions (
  id              uuid PRIMARY KEY,
  course_id       uuid NOT NULL REFERENCES learning.courses (id),
  position        integer NOT NULL,
  prompt          text NOT NULL,
  options         jsonb NOT NULL,          -- [{ "id": "a", "text": "..." }]
  correct_option  text NOT NULL,           -- never sent to clients
  explanation     text NOT NULL,
  UNIQUE (course_id, position)
);

CREATE TABLE learning.lesson_progress (
  advisor_id    uuid NOT NULL,
  lesson_id     uuid NOT NULL REFERENCES learning.lessons (id),
  completed_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (advisor_id, lesson_id)
);

CREATE TABLE learning.quiz_attempts (
  id            uuid PRIMARY KEY,
  advisor_id    uuid NOT NULL,
  course_id     uuid NOT NULL REFERENCES learning.courses (id),
  answers       jsonb NOT NULL,
  score_pct     integer NOT NULL,
  passed        boolean NOT NULL,
  submitted_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX quiz_attempts_advisor_idx ON learning.quiz_attempts (advisor_id, course_id, submitted_at DESC);

CREATE TABLE learning.course_completions (
  advisor_id  uuid NOT NULL,
  course_id   uuid NOT NULL REFERENCES learning.courses (id),
  attempt_id  uuid NOT NULL REFERENCES learning.quiz_attempts (id),
  passed_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (advisor_id, course_id)
);

-- Seed: the Essentials course. Content is reviewed by the advisor-success lead before launch.

INSERT INTO learning.courses (id, slug, title, summary, is_essentials, pass_mark_pct) VALUES
  ('01970000-0000-7000-8000-00000000c001', 'essentials', 'Essentials', 'The core course every advisor passes before booking real client trips.', true, 80);

INSERT INTO learning.lessons (id, course_id, position, title, body_md, est_minutes) VALUES
  ('01970000-0000-7000-8000-000000000101', '01970000-0000-7000-8000-00000000c001', 1, 'How the platform works', $md$Welcome to the **Essentials** course. Pass it to unlock booking.

## What a host agency does
You run your own travel business. The platform is your host agency: it holds the licences and supplier
agreements, takes payments, collects commission and pays you. You bring the relationships and the taste.

## What you are accountable for
- Understanding what your client wants and recommending trips that fit.
- Getting the details right before you book: names, dates, room types, policies.
- Staying reachable while your client travels.

## What the platform does for you
- Access to hotel inventory and preferred-partner perks.
- Secure payments: card details never pass through your hands.
- Commission tracking from booking to payout, visible at every step.$md$, 5);

INSERT INTO learning.lessons (id, course_id, position, title, body_md, est_minutes) VALUES
  ('01970000-0000-7000-8000-000000000102', '01970000-0000-7000-8000-00000000c001', 2, 'Getting to know your client', $md$Great trips start with good questions.

## Capture the essentials
- **Who is travelling**, including companions and children's ages.
- **Dates and flexibility**.
- **Budget range**, per night or for the whole trip.
- **Style**: boutique or resort, quiet or lively.
- **Needs**: dietary requirements, accessibility, loyalty programme numbers.

Record these in the client's profile so you never ask twice.

## Privacy
Client data belongs to your relationship with that client. Only you (and your team, if you have one) can
see it. If a client asks for a copy of their data or asks you to delete it, log a privacy request from the
client's page; the platform completes it within 30 days.$md$, 6);

INSERT INTO learning.lessons (id, course_id, position, title, body_md, est_minutes) VALUES
  ('01970000-0000-7000-8000-000000000103', '01970000-0000-7000-8000-00000000c001', 3, 'Proposals and pricing', $md$A proposal is a priced offer your client can approve from a link, with no account needed.

## Build it day by day
Add hotels, activities, transfers and notes. Each hotel rate shows taxes, fees and the cancellation policy.

## Prices change
Hotel rates are live. A proposal shows when pricing was last checked, and rates expire. Before booking,
the platform checks the price again and refuses stale rates, so you never book at a price the client did
not see.

## Be transparent
Show the total, including any planning fee you charge. Never hide fees inside room rates.$md$, 6);

INSERT INTO learning.lessons (id, course_id, position, title, body_md, est_minutes) VALUES
  ('01970000-0000-7000-8000-000000000104', '01970000-0000-7000-8000-00000000c001', 4, 'Booking hotels correctly', $md$## Before you book
1. Confirm names exactly as on the travellers' passports.
2. Confirm dates, room type and number of guests.
3. Read the cancellation policy to your client and make sure they accept it.

## When you book
The platform re-validates price and availability, then reserves with the hotel. If a request times out,
it is safe to retry: the platform never creates a duplicate booking.

## Never book outside the platform
Bookings made directly with a hotel are not tracked, so no commission is paid and perks are not attached.

## Changes and cancellations
Modify or cancel through the platform. Any penalty is shown before you confirm.$md$, 7);

INSERT INTO learning.lessons (id, course_id, position, title, body_md, est_minutes) VALUES
  ('01970000-0000-7000-8000-000000000105', '01970000-0000-7000-8000-00000000c001', 5, 'Commission and getting paid', $md$## How commission is calculated
Expected commission = commissionable amount × the supplier's commission rate. Your share is set by your
**split tier**: you start at 70%, move to 80% after $300,000 of commissionable sales in a calendar year,
and 90% after $2,000,000.

*Example:* a $2,500 stay at 12% earns $300 commission. At a 70% split you receive $210.

## When you are paid
Commission moves through: Expected → Invoiced → Received → Reconciled → Payable → Paid. You are paid
**after the hotel pays the platform**, on the regular payout schedule.

## Clawbacks
If a booking is cancelled or the guest does not stay, the commission is reversed. If it was already paid,
it is recovered from your next payout.$md$, 7);

INSERT INTO learning.lessons (id, course_id, position, title, body_md, est_minutes) VALUES
  ('01970000-0000-7000-8000-000000000106', '01970000-0000-7000-8000-00000000c001', 6, 'Perks and partners', $md$## Preferred partners
Some hotels are preferred partners. Their rates are marked in search and come with perks such as a room
upgrade on arrival, daily breakfast or a hotel credit.

## How perks are attached
When you book an eligible rate, the platform attaches the perks automatically. Tell your client what to
expect, but do not promise upgrades that depend on availability as if they were guaranteed.

## When something goes wrong
If a promised perk is not delivered, tell the support team. Service recovery is part of what clients pay
an advisor for.$md$, 5);

INSERT INTO learning.lessons (id, course_id, position, title, body_md, est_minutes) VALUES
  ('01970000-0000-7000-8000-000000000107', '01970000-0000-7000-8000-00000000c001', 7, 'Compliance basics', $md$## Selling travel is regulated
Some states and provinces require sellers of travel to be registered. The platform handles registration
where it sells; check with support before you advertise in a new region.

## Honest marketing
Do not claim to be a supplier's employee, and do not use supplier logos without permission.

## Using the AI assistant
The assistant can research and draft, but it never contacts your clients. Check every fact it gives you,
especially prices, policies and perks, before you send anything.

## Money
Never take card details by email or phone. Clients pay through secure payment pages only.$md$, 6);

INSERT INTO learning.quiz_questions (id, course_id, position, prompt, options, correct_option, explanation) VALUES
  ('01970000-0000-7000-8000-000000000201', '01970000-0000-7000-8000-00000000c001', 1, 'Who holds the supplier agreements and takes payments for your bookings?', '[{"id": "a", "text": "You, the advisor"}, {"id": "b", "text": "The platform, as your host agency"}, {"id": "c", "text": "The client''s bank"}, {"id": "d", "text": "The hotel''s sales manager"}]', 'b', 'The platform is the host agency.');

INSERT INTO learning.quiz_questions (id, course_id, position, prompt, options, correct_option, explanation) VALUES
  ('01970000-0000-7000-8000-000000000202', '01970000-0000-7000-8000-00000000c001', 2, 'A rate in a proposal changed before you book. What happens?', '[{"id": "a", "text": "The booking goes through at the old price"}, {"id": "b", "text": "The platform refuses the stale rate and shows the new price"}, {"id": "c", "text": "The client is charged the difference later"}, {"id": "d", "text": "Nothing; rates never change"}]', 'b', 'Rates are checked again immediately before booking.');

INSERT INTO learning.quiz_questions (id, course_id, position, prompt, options, correct_option, explanation) VALUES
  ('01970000-0000-7000-8000-000000000203', '01970000-0000-7000-8000-00000000c001', 3, 'A $2,500 stay pays 12% commission and your split is 70%. What is your share?', '[{"id": "a", "text": "$300"}, {"id": "b", "text": "$210"}, {"id": "c", "text": "$90"}, {"id": "d", "text": "$175"}]', 'b', '$2,500 × 12% = $300; 70% of $300 = $210.');

INSERT INTO learning.quiz_questions (id, course_id, position, prompt, options, correct_option, explanation) VALUES
  ('01970000-0000-7000-8000-000000000204', '01970000-0000-7000-8000-00000000c001', 4, 'When is your commission paid to you?', '[{"id": "a", "text": "When the client approves the proposal"}, {"id": "b", "text": "When the booking is confirmed"}, {"id": "c", "text": "After the supplier pays the platform"}, {"id": "d", "text": "On the day the trip starts"}]', 'c', 'Advisors are paid after the supplier pays the platform.');

INSERT INTO learning.quiz_questions (id, course_id, position, prompt, options, correct_option, explanation) VALUES
  ('01970000-0000-7000-8000-000000000205', '01970000-0000-7000-8000-00000000c001', 5, 'Your booking request timed out. Is it safe to retry?', '[{"id": "a", "text": "No, it may create a duplicate"}, {"id": "b", "text": "Yes, the platform never creates duplicate bookings"}, {"id": "c", "text": "Only after calling the hotel"}, {"id": "d", "text": "Only on weekdays"}]', 'b', 'Booking requests are idempotent.');

INSERT INTO learning.quiz_questions (id, course_id, position, prompt, options, correct_option, explanation) VALUES
  ('01970000-0000-7000-8000-000000000206', '01970000-0000-7000-8000-00000000c001', 6, 'A client cancels after you were paid commission. What happens?', '[{"id": "a", "text": "Nothing"}, {"id": "b", "text": "The commission is reversed and recovered from your next payout"}, {"id": "c", "text": "The client pays you directly"}, {"id": "d", "text": "The hotel pays twice"}]', 'b', 'Clawbacks are recovered from the next payout.');

INSERT INTO learning.quiz_questions (id, course_id, position, prompt, options, correct_option, explanation) VALUES
  ('01970000-0000-7000-8000-000000000207', '01970000-0000-7000-8000-00000000c001', 7, 'A client asks you to delete their data. What do you do?', '[{"id": "a", "text": "Delete their profile yourself"}, {"id": "b", "text": "Ignore it"}, {"id": "c", "text": "Log a privacy request from the client''s page"}, {"id": "d", "text": "Email the data to them"}]', 'c', 'Privacy requests are verified and completed by the platform within 30 days.');

INSERT INTO learning.quiz_questions (id, course_id, position, prompt, options, correct_option, explanation) VALUES
  ('01970000-0000-7000-8000-000000000208', '01970000-0000-7000-8000-00000000c001', 8, 'The AI assistant drafted a proposal with a price. What must you do?', '[{"id": "a", "text": "Send it straight away"}, {"id": "b", "text": "Check the facts, especially prices, policies and perks, before sending"}, {"id": "c", "text": "Let the assistant send it"}, {"id": "d", "text": "Nothing; AI is always right"}]', 'b', 'Drafts always need your review; the assistant never contacts clients.');
