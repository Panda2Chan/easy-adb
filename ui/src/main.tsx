import { createRoot } from "react-dom/client";
import { App } from "./App";
import { Bridge } from "./lib/bridge";
import "./styles.css";

const bridge = new Bridge(window.chrome?.webview);
const root = createRoot(document.getElementById("root")!);
root.render(<App bridge={bridge} />);
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    root.unmount();
    bridge.dispose();
  });
