# Remote script return limit

Increase the serialized JSON return value budget from 2,000 to 8,000 characters. This permits larger plugin parameter and project inspection summaries. Script source, runtime, graph update and entity limits remain unchanged. JSON quotes and escaping count toward the budget. Oversized returns must fail before any staged edits commit.

Validation: boundary coverage accepts 8,000 serialized characters and rejects 8,001 while preserving the live graph on failure. AI-assisted implementation.

Result WebSocket envelopes allow 32 KiB to accommodate Unicode returns and created IDs; non-result messages remain capped at 16 KiB.
