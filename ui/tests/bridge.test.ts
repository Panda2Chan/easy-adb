import { expect, it, vi } from "vitest";
import { Bridge, type HostPort } from "@/lib/bridge";

function channel() {
  const bus = new EventTarget();
  const postMessage = vi.fn();
  const postMessageWithAdditionalObjects = vi.fn();
  const port: HostPort = Object.assign(bus, {
    postMessage,
    postMessageWithAdditionalObjects,
  });
  const bridge = new Bridge(port);
  const send = (data: unknown) =>
    bus.dispatchEvent(new MessageEvent("message", { data }));
  return { bridge, send, postMessage, postMessageWithAdditionalObjects };
}

it("按 id 匹配乱序响应并兼容数字和字符串", async () => {
  const { bridge, send, postMessage } = channel();
  const list = bridge.request("list", {}),
    pick = bridge.request("pick", {});
  const [first, second] = postMessage.mock.calls.map(([m]) => m.id);
  send({ id: String(second), result: null });
  send({ id: Number(first), error: "读取失败" });
  await expect(list).rejects.toThrow("读取失败");
  await expect(pick).resolves.toBeNull();
  bridge.dispose();
});

it("向宿主传递原始 File，并仅分发有效事件", () => {
  const { bridge, send, postMessageWithAdditionalObjects } = channel();
  const listener = vi.fn(),
    file = new File([], "中文.apk");
  const off = bridge.subscribe(listener);
  bridge.drop(file);
  expect(postMessageWithAdditionalObjects).toHaveBeenCalledWith(
    { action: "drop" },
    [file],
  );
  expect(listener).not.toHaveBeenCalled();
  send({ event: "progress", value: "错误类型" });
  send({ event: "file", value: "C:\\目录\\中文.apk" });
  expect(listener).toHaveBeenCalledTimes(1);
  off();
  send({ event: "stage", value: "安装" });
  expect(listener).toHaveBeenCalledTimes(1);
  bridge.dispose();
});
