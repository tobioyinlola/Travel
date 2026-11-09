# ADR-12: Sprint 2 decisions (learning, community, client CRM)

- Status: Accepted (Sprint 2)

## 1. Row-level security driven by transaction settings

Advisor-owned tables (`clients.*`) enable **and force** row-level security, so the policy applies even to the
owning module role the app runs as. Each unit of work declares whose data it may see with a
transaction-local setting (`tx.setLocal('atp.advisor_id', ...)`, or `atp.scope = 'all'` for staff tools and
jobs). With no setting, queries see nothing. Application queries still filter by owner explicitly; RLS is the
second line of defence (ARCH security). This pattern is the template for every later advisor-owned table
(itineraries, bookings, commission).

## 2. Who can use what

| Feature                    | Advisor statuses                        | Staff                                                |
| -------------------------- | --------------------------------------- | ---------------------------------------------------- |
| Courses (incl. Essentials) | applied, under_review, approved, active | none                                                 |
| Community forum            | approved, active                        | support and admin take part and moderate             |
| Client CRM                 | approved, active                        | support and admin only through privacy-request tools |

Applicants can start learning while under review; passing Essentials early means approval activates them
straight away (AC-01 allows either order).

## 3. Quiz answers

Questions are served without answers. After a failed attempt the advisor learns which questions were wrong,
not the right answers; correct answers and explanations are revealed once the course is passed. Five
attempts per 24 hours. Passing Essentials calls Identity in the same transaction, so the completion record
and the booking unlock commit together.

## 4. Forum content

Plain text only (no HTML or Markdown rendering), so posts cannot inject markup. Author names are
snapshotted at posting time. Three distinct open reports hide a post automatically until a moderator
dismisses or confirms it. Authors may edit only their own posts; moderators hide, restore and lock.

## 5. Privacy requests (FR-CRM-08, NFR-10)

The advisor logs an export or deletion request on the client's behalf; support verifies the requester's
identity before anything happens; a job then produces the export (kept 30 days) or erases the client:
personal fields are blanked, companions deleted, the row kept as `erased` so bookings and commission stay
intact, and `ClientDataErased` tells other modules to erase their copies. Client audit entries record field
names and ids only, never personal data.
