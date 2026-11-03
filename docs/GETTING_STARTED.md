# Your first drawing

[Open Plot-it](https://thierryc.github.io/Plot-It/app/). Editing and simulation need no plotter or installation.

## Import and simulate

1. Download [alpha-starter.svg](../public/examples/alpha-starter.svg), then choose **Import SVG** in the app. The sample contains a 50 mm square, a 20 mm circle, curves, and short marks in a 60 × 60 mm region. Import leaves your paper preset unchanged.
2. Set the selected object's **Width** and **Height** to **80 mm** in the inspector. Imports start at a default display size; this step restores the sample's intended 50 mm square and 20 mm circle. Keep it inside the paper's safe margin. You can also use **Add text** with the default stroke font.
3. Choose **Plot** at the top right. Wait for preparation, then click **Simulate** at the bottom of the sidebar. No hardware destination is needed.
4. Watch drawing and raised travel. Try Pause, Resume, and Stop; simulation sends no hardware commands.
5. Choose **Edit** to return to your drawing.

## Keep your work

Open the top-left menu and choose **Save** for an editable `.plit.json` document. **Load** replaces the current drawing and can be undone. SVG export is for other tools; it does not preserve all editable text and fill settings.

The browser also saves locally, but that storage belongs to the hostname. Export a backup before clearing browser data or moving to another address. Loaded fonts may be included in document files; keep their licenses in mind when sharing.

## First physical test

Physical plotting is experimental. Check [compatibility](COMPATIBILITY.md) and the [alpha testing guide](ALPHA_TESTING.md) before proceeding. A default profile is not a recommendation for your machine.

1. Close any other app or server using the same board. Select the actual machine/profile, model, orientation, and resolution. Use conservative settings suitable for that hardware.
2. For browser USB, use desktop Chrome or Edge, select **Direct USB · this computer**, and click **Connect**. For the Node runner, open its app on port 8787, select **Network plotter (Node server)**, and click **Connect**. Network Connect claims control and opens the server EBB when idle. Connection alone does not start a drawing.
3. Follow the machine's calibration procedure. Confirm that **Up** clears the page and **Down** reaches it. Heights are machine-specific; do not copy another tester's percentages.
4. Place the carriage at your intended physical origin and use **Set origin**. Keep the sample within actual machine travel. Paper size and margins do not identify the physical bed.
5. Choose **Preview bounds** with the pen raised. It returns and releases motors, so restore the physical reference and use **Set origin** again before the drawing.
6. Load the indicated pen and choose **Start with this pen**. Photograph the result and record candidate/settings.

Pause waits for a planned rest, lifts the pen, and holds alignment; a long stroke can take time to pause. Stop settles and returns to a known origin. Cancel purges and requires explicit origin recovery after interrupted motion. Follow your machine's emergency procedure when necessary. After a fault, USB loss, or moving a released carriage, restore origin and prepare a fresh job.

[Detailed controls](PLOT_CONTROLS.md) · [Report your test](ALPHA_TESTING.md)
