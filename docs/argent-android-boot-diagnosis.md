# Fresh Android boot diagnosis

Both newly created project AVDs failed before any app install or launch. Focus Garden's diagnostic attempt terminated after about18 seconds; Libauth's first attempt terminated after20192ms. Both errors were `adb: device offline` during `sys.boot_completed`, followed by Argent-owned emulator termination. These are early terminal-state failures, not observed full boot timeouts.

Read-only inspection of installed Argent0.32.0 shows `device offline` in `TERMINAL_ADB_ERROR_PATTERNS`; `waitForBootCompleted` throws immediately on that classifier. The official0.33.0 npm tarball was downloaded into memory, its integrity checked, and the same code path remains. No version was installed or tool-server restarted. This explains early termination but does not prove the guest's underlying offline cause or a product defect.

The assigned AVDs and ownership remain in `native-test-targets.json`. Both cold-boot windows are released. No ready serial, native runtime proof, wipe, foreign-device takeover or OX transfer is recorded. An external way to unblock is manually starting the assigned fresh AVD in Android Studio Device Manager, waiting for full boot, then verifying its exact name and ready serial through Argent before the owning project proceeds. Agent-side alternative device controllers remain prohibited.

## Coordinator recovery outcome

After the user explicitly asked the coordinator to perform startup, exclusive setup ownership transferred to the coordinator. The assigned OX/Libauth AVD had GPU disabled. Its config was backed up, GPU enabled and mode set to host without wiping userdata or resizing its actual partition. One explicit Argent boot then succeeded in5.6 seconds. A fresh Argent inventory identified `Blaze_OX_Libauth_20261115` as `emulator-5558`, state `device`, API36, and `describe` verified its Android launcher/home tree. No product app was installed or launched by the coordinator. This successful configuration/startup sequence does not establish the sole root cause of prior failures.

Exclusive access now returns to Libauth for its recorded native acceptance, followed only by an explicit OX transfer. The manual-start request is superseded; the user does not need to operate Android Studio for this target. Focus Garden and iOS remain separate pending targets.
