# Dense telemetry browser experiment

Build from the repository root with `node scripts/dense-browser/build.mjs`. Serve `output/dense-wave-investigation-2026-11-02/browser-harness` using a separate static server, for example `python3 -m http.server 8894 --bind 127.0.0.1 --directory output/dense-wave-investigation-2026-11-02/browser-harness`. Open `http://127.0.0.1:8894`, choose **Run comparison**, then download the JSON evidence.

This harness never imports Web Serial adapters or accesses hardware. A real browser worker receives transferred readable/writable streams connected to a synthetic main-thread peer. The peer responds to an initial QG and QS. The worker then posts a synthetic continuous-stroke settlement burst and requests a final QG. All timestamps use performance.timeOrigin + performance.now() for cross-thread comparison.

The comparison uses the same synthetic 36,000-event geometry and settlement snapshots:

- Legacy: the former full-prefix position scan, livePlotView, actual PlotOverlay, and synchronous sidebar writes for each signal.
- Disabled: receives the same individual batches but does no visual processing.
- Coalesced: sends one verified-range endpoint and uses the actual current LivePlot/PlotOverlay with animation-frame rendering and sidebar throttling. Additional coalesced cases use 18,000 and 100,000 events.

The legacy renderer has an aggregate **1,500 ms work cap**. Subsequent signals count as `skipped`; this deliberately incomplete legacy rendering cannot establish whole-job completion or the production 5-second failure. Normal cases use the production-sized 5,000 ms deadline. Explicit absent, delayed, and main-thread-blocked fault cases use a deliberately shortened **500 ms** deadline; delayed and blocked peers take 750 ms. They demonstrate distinct response-loss and scheduling mechanisms, not a reproduction of the original unexplained missing reply.

The JSON records worker request/write/read/deadline times, peer query/reply times, main-thread batch transit/processing maxima, long tasks, processed/skipped counts, and visual/sidebar update counts. Browser memory availability varies. Long-task observation includes initial worker-message cloning and final rendering; its start/end scope differs from the per-batch processing timer. No background-tab test or Stop/pause interaction is currently automated. This is not a native-command or firmware replay, does not exercise WorkerSession/feeder/protocol, and cannot validate hardware pen-up.

## Recorded foreground run, 2 November 2026

Chrome evidence: `output/dense-wave-fix-2026-11-02/logs/dense-browser-evidence.json`.

The capped legacy case processed 9,483 events and skipped 26,517; final reply delivery was delayed about 1,535 ms. The coalesced 36k case processed one endpoint and its corresponding delay was about 0.2 ms. All three deliberately injected 500 ms deadline faults timed out. The 100k case included a 106 ms long task, so the proposed no-task-over-50-ms target is **not met for the entire harness setup/rendering lifecycle**. These measurements support reducing host UI work; they do not prove host starvation caused the original EBB failures. Production continuous execution and physical final Up still require separate validation.
