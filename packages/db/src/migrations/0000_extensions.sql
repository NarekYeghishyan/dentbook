-- Extensions required by the schema (CLAUDE.md §2.1, §5).
-- Must run before 0001: tables use citext, gist indexes use btree_gist.
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pgcrypto;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS citext;
