# Local MCP audio analysis

AI-assisted implementation. Render exact-length PCM by stepping the offline engine (no silence trimming). Render a frozen project copy locally in the connected tab; measure PCM in a dedicated worker. Only JSON summaries and paged windows cross the bridge. No file downloads, uploads, cloud audio storage, or live-project edits.

Tools: `analyze_audio`, `get_audio_analysis`, `cancel_audio_analysis`. Start requires project ID and expected revision. Omit audioUnitIds for master output, or select up to four mixer-unit UUIDs for post-effects/post-strip stems before downstream buses. Shared sends/returns are excluded from those stems; current mute/solo state applies. Specify zero-based quarter-note beats OR seconds. Rendering starts at zero for context; only the selected interval is measured.

48 kHz stereo per target. Range ends within 300 seconds; render budget is 32 million float values with FIR lookahead. One running job, eight retained jobs, 120s execution deadline, ten-minute result retention. Disconnect/reload cancels jobs. Summaries can be read without another render; request page 0 for 20 time windows, follow nextPage. Window times are absolute project seconds.

Metrics: per-channel sample peak, 4x FIR estimated true peak and its time, RMS, DC offset, full-scale sample counts; gated integrated LUFS; max 400ms momentary and 3s short-term LUFS; short-term 10th/95th percentile LRA; stereo correlation; 4096-point Hann FFT band mean power with 11.71875Hz resolution; 100ms sample-peak/RMS/M/S windows and silence below -80dBFS. Silence/insufficient duration is JSON null plus explanations. LRA on a short excerpt is not whole-programme LRA.

Algorithms: ITU-R BS.1770-5 Annex 1 48kHz coefficients, 400ms blocks with 75% overlap and absolute -70/relative -10 LU gates. Annex 2 4-phase, 12-tap FIR interpolation, with real adjacent context and delay-compensated peak times. EBU short-term LRA absolute and -20LU relative gating.

References:
- https://www.itu.int/rec/R-REC-BS.1770-5-202311-I
- https://tech.ebu.ch/publications/tech3341
- https://tech.ebu.ch/publications/tech3342

Validation: synthetic silence, reference sine peak/RMS and stereo -23 LUFS, gated silence/tone, intersample peak, requested range, opposite-phase stereo, overload, job cancellation/revision isolation/paging. Independent FFmpeg EBU R128 comparison on faded 48kHz tones: 1kHz -22.997 LUFS versus -23.0; quarter-rate tone 2.433 LUFS versus 2.4 and -0.870 dBTP versus -0.9. These checks do not constitute full meter certification.
