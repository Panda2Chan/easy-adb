import { useRef, useState } from "react";
import { Send } from "lucide-react";
import { type Bridge, errorText } from "@/lib/bridge";
import { Button } from "./ui/button";
export function DeviceText({
  bridge,
  serial,
  name,
}: {
  bridge: Bridge;
  serial: string;
  name: string;
}) {
  const [text, setText] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const sending = useRef(false);
  async function send() {
    if (sending.current || !text.length) return;
    sending.current = true;
    setBusy(true);
    setMessage("");
    try {
      await bridge.request("sendText", { serial, text });
      setMessage(`已向 ${name} 发送文本`);
    } catch (err) {
      setMessage(errorText(err));
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="grid min-w-0 gap-3 font-sans text-sm text-foreground">
      <label htmlFor="device-text" className="text-xl leading-6 font-semibold wrap-anywhere">
        输入到 {name}
      </label>
      <p id="device-text-help" className="text-xs text-muted-foreground">
        先在设备上选中输入框。可发送英文、数字、空格和半角标点，最多 512 字符。
      </p>
      <textarea
        id="device-text"
        aria-describedby="device-text-help"
        rows={3}
        maxLength={512}
        value={text}
        disabled={busy}
        onChange={(e) => {
          setText(e.target.value);
          setMessage("");
        }}
        className="w-full rounded-md border border-input bg-background px-3 py-2 font-sans text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
        placeholder="输入网址、英文搜索词或登录名"
      />
      <Button className="justify-self-start" disabled={busy || !text.length} onClick={send}>
        <Send />
        {busy ? "发送中…" : "发送文本"}
      </Button>
      <p role="status" className="wrap-anywhere text-xs text-muted-foreground empty:sr-only">
        {message}
      </p>
    </section>
  );
}
