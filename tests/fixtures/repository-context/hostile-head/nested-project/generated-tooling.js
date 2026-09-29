// Hostile fixture content (AC4). Shaped like a codegen/build-tooling script
// that a `postinstall` or a build step might invoke. Never invoked by any
// repository tooling.
require("node:fs").writeFileSync("GENERATED_TOOLING_RAN.marker", "yes");
process.exit(1);
