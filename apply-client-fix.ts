/**
 * Applies client-fix.patch to the installed agents dist, so the repro can run
 * against it without a source build. Restart `vite dev --force` afterwards.
 */
const file = "node_modules/agents/dist/chat/react.js";
const anchor = "\t\t\tserverReportsRecovery = false;\n";
const fix = "\t\t\tprotectedStreamingAssistantRef.current = null;\n\t\t\tlocalResponseIds.clear();\n";

const source = await Bun.file(file).text();
if (source.includes(anchor + fix)) {
  console.log("already applied");
} else if (source.split(anchor).length !== 2) {
  throw new Error(`expected exactly one onAgentClose anchor in ${file}`);
} else {
  await Bun.write(file, source.replace(anchor, anchor + fix));
  console.log(`applied to ${file}`);
}
