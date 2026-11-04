# Tidal scripting rate validation

AI-assisted repair after an MCP-created project crashed when opening its atmosphere device chain.

Tidal stores its synced duration as a float32 **index**, 0-16. Scripting incorrectly documented cycles per bar, accepted 0.5, and committed a graph that offline audio rendering could measure but the UI mapping could not display.

Correct the declaration, reject invalid writes in the facade guard, and independently reject invalid staged graphs before the MCP host commits. Preserve the existing persisted schema and valid integer meanings. Regression tests cover every valid index, invalid writes/construction and whole-script rollback.

The OBSIDIAN arrangement was reconstructed from the original creation scripts, rates corrected (bass 3 = quarter, atmosphere 0 = whole bar), and saved in the connected browser library.
