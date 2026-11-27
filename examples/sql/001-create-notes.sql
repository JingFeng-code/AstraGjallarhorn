BEGIN;
CREATE TABLE notes (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 40)
) STRICT;
PRAGMA user_version = 1;
COMMIT;
