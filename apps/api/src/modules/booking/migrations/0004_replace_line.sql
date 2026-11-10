-- Changing a stay (dates, room or hotel) on a confirmed booking: a new line is reserved first and the old one is
-- cancelled only after the new one is confirmed (make before break).
ALTER TABLE booking.lines
  ADD COLUMN replaces_line_id uuid REFERENCES booking.lines (id),
  ADD COLUMN replace_state    text CHECK (replace_state IN ('open', 'done', 'failed'));
CREATE UNIQUE INDEX lines_one_open_replacement_idx ON booking.lines (replaces_line_id)
  WHERE replace_state IN ('open', 'done');
