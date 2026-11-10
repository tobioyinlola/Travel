# ADR-24: Sprint 14 decisions (message attachments)

- Status: Accepted (Sprint 14)

## 1. Scope

FR-TRV-06 asks that a traveler can message the advisor and attach documents. Messages were built in Sprint 11; this adds
files in both directions (traveler from the proposal link, advisor from the trip). No provider decision was needed.

## 2. Rules

- PDF, PNG and JPEG only, 1 byte to 5 MB, at most 5 per message and 25 per trip. The type is read from the file's own
  first bytes; the declared type and the file name are never trusted. Names are stripped of paths and control characters.
- Two steps: upload the file (raw bytes, gets an id), then send the message with `attachmentIds`. A file can be attached
  once, only by the side that uploaded it, and is not downloadable until it is part of a sent message.
- Downloads always use `Content-Disposition: attachment` with `nosniff` and the API's strict headers, so a file is never
  rendered in our origin.
- Travelers: 10 uploads an hour per link, plus the per-address limit. Advisors: owner-only through row-level security.
- Every file passes a scan port (`AttachmentScannerPort`) before it is stored. Today's adapter is a stand-in that flags
  the EICAR test string; production refuses it with the other fakes. A real scanner replaces it behind the same port
  (a contract suite should be added then).

## 3. Storage

Bytes are kept in Postgres (`itineraries.attachments.data`) with their SHA-256. That is fine for a pilot (small files,
backups already cover it) and keeps the restore drill honest. Before volume grows, move to object storage behind a
storage port with encryption at rest and a retention rule; the table keeps the metadata.

## 4. Erasure (FR-CRM-08)

When a client's data is erased, Itineraries now deletes that client's message thread and files and replaces the client's
first name in stored proposals with "Client" (trips, prices and bookings stay, as financial records). Sprint 11's thread
had no such step; this closes it.

## 5. Not done

Previews, and re-scanning stored files when scanner signatures update.
