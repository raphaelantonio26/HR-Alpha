import { Shell } from "./shell/Shell.js";
import { DemoGate } from "./shell/DemoGate.js";
import { useApp } from "./store.js";

export function App() {
  // In Profile D the demo front door gates entry until a role is chosen.
  // Outside demo, `entered` initializes true, so the app renders straight through.
  const entered = useApp((s) => s.entered);
  return entered ? <Shell /> : <DemoGate />;
}
