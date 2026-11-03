# Simulation

Simulation plays the compiled motion plan without sending hardware commands. It uses the shared Plotter Core planner, motor records and pen timing; the app supplies playback and canvas overlays.

Choose **Plot → Simulate**. Pause, resume, stop or scrub playback. Different pen assignments pause at a pen-change point; manual pen-change waiting time is excluded from estimates. Return to **Edit** when finished. Overlays are not saved as artwork.

The plan includes quantized steps, raised travel and pen-transition waits. Physical machines can still differ because of servo response, queue delays, USB latency, missed steps and mechanics. Simulation does not establish contact, calibration or line quality.

For actual machine behavior, origin and recovery, see [Plot controls](PLOT_CONTROLS.md). For a first session and reporting, see [Alpha testing](ALPHA_TESTING.md).
