# Alpha compatibility

**Implemented** means a profile or feature exists in source. **Physically tested** needs a dated result on the exact candidate/configuration. **Supported** requires repeatable acceptance. This alpha has no blanket supported-machine certification.

| Configuration | Implementation | Physical evidence / alpha status |
| --- | --- | --- |
| Editing and simulation | Browser app; no hardware required | Ready for usability testing; release checks recorded separately |
| Author's EBB setup / XyloDraw profile | Existing calibration and SM backend | Local tests do not establish acceptance of the current build; record the exact setup and candidate |
| AxiDraw V3 A4 / V3 A3 | Model envelopes, scaling and pen profile | Untested by the author; seek independent owners |
| NextDraw 8511 / 1117 / 2234 | Model profiles, standard/brushless lift setup, explicit homing | Physical compatibility not established; dedicated validation needed |
| Node desktop runner | Same core; separate API and runner | Experimental trusted-LAN workflow; native Windows server installation unqualified |
| Raspberry Pi 4, OS Lite 64-bit | ARM64 package and service installer | Hardware acceptance pending; Pi 3 and Zero 2 W unvalidated |

## Firmware and advanced features

The core has SM compatibility starting at firmware 2.8.1. NextDraw requires 3.0.2 or newer. Explicit S-curve/T3/TD targets 3.1.7. Physical Auto stays on SM while modern hardware acceptance is pending. No upgrade is needed for SM on the existing 2.8.1 setup; Plot-it does not flash firmware.

Servo type, board revision, travel, orientation, and scaling are separate from firmware. NextDraw homing is model-specific and explicit; a generic EBB profile does not provide sensor homing. Legacy origin references the placed carriage, not encoder measurements.

Repeats, layers, reloads, checkpoints, and modern motion need individual hardware tests. See the [hardware test procedure](validation/README.md). Counters and virtual tests cannot prove pen contact or exclude missed steps.

## Known limits

- Direct USB needs Web Serial in a secure context, normally desktop Chrome or Edge. Mobile USB plotting is not advertised.
- The public website/browser-only build provide Direct USB and Simulate. Network appears in the app served by the Node API.
- Network services have no authentication and are intended for a trusted LAN.
- SVG support is bounded. Imported native text must become paths before plotting; the built-in Text tool supplies paths. Images, masks, filters and unsupported paints are not general plotting inputs. The Node runner accepts only its validated prepared-job/SVG input subset.
- Ordinary outline fonts and stroke fonts produce different paths. Some Hershey symbol collections use private-use mappings, without standard non-Latin text coverage.
- Fill quality depends on measured pen width/paper; narrow regions can be omitted with diagnostics. [Fill limits](FILLS.md).
- Estimates exclude manual pen-change time. Fonts retain separate licenses.
