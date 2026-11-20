import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { App } from "@/App";
import { Bridge } from "@/lib/bridge";

afterEach(cleanup);
function setup() {
  const bus = new EventTarget();
  const devices = ["A", "B"].map((serial) => ({
    serial,
    name: `测试设备 ${serial}`,
    state: "device",
  }));
  const send = (data: unknown) =>
    bus.dispatchEvent(new MessageEvent("message", { data }));
  const postMessage = vi.fn(({ id, action }) => {
    if (action === "list")
      queueMicrotask(() => send({ id, result: [...devices] }));
    if (action === "pick")
      queueMicrotask(() => send({ id, result: "C:\\Downloads\\中文.apk" }));
    if (["pair", "connect", "cancel"].includes(action))
      queueMicrotask(() => send({ id, result: true }));
  });
  const drop = vi.fn();
  const port = Object.assign(bus, {
    postMessage,
    postMessageWithAdditionalObjects: drop,
  });
  const bridge = new Bridge(port);
  render(<App bridge={bridge} />);
  return { send, devices, postMessage, drop };
}

describe("桌面工作台", () => {
  it("刷新后保留锁定目标，拒绝改投其他设备", async () => {
    const { devices, postMessage } = setup();
    fireEvent.click(await screen.findByRole("button", { name: /测试设备 A/ }));
    fireEvent.click(screen.getByRole("button", { name: /选择 APK/ }));
    await screen.findByText("中文.apk");
    devices.shift();
    fireEvent.click(screen.getByRole("button", { name: /刷新 USB/ }));
    await screen.findByText(/目标设备已断开/);
    expect(
      (screen.getByRole("button", { name: /安装到/ }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(postMessage.mock.calls.some(([m]) => m.action === "install")).toBe(
      false,
    );
  });
  it("使用宿主路径安装，显示进度，取消后等待安装请求结束", async () => {
    const { send, postMessage, drop } = setup();
    const file = new File([], "中文.apk");
    fireEvent.click(await screen.findByRole("button", { name: /测试设备 B/ }));
    const zone = screen.getByRole("button", { name: /选择 APK/ });
    expect(fireEvent.dragOver(zone)).toBe(false);
    fireEvent.drop(zone, { dataTransfer: { files: [file] } });
    expect(drop).toHaveBeenCalledWith({ action: "drop" }, [file]);
    expect(
      (
        screen.getByRole("button", {
          name: /安装到 测试设备 B/,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    act(() => {
      send({ event: "file", value: "C:\\可信目录\\中文.apk" });
    });
    fireEvent.click(screen.getByRole("button", { name: /安装到 测试设备 B/ }));
    const request = postMessage.mock.calls.find(
      ([m]) => m.action === "install",
    )![0];
    expect(request.payload).toEqual({
      serial: "B",
      file: "C:\\可信目录\\中文.apk",
    });
    act(() => {
      send({ event: "stage", value: "downloading" });
      send({ event: "progress", value: 42 });
    });
    expect(screen.getByText("42%")).toBeTruthy();
    expect(screen.getByText("正在下载")).toBeTruthy();
    act(() => {
      send({ event: "stage", value: "installing" });
    });
    expect(screen.getByText("正在安装")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "取消安装" }));
    await waitFor(() =>
      expect(postMessage.mock.calls.some(([m]) => m.action === "cancel")).toBe(
        true,
      ),
    );
    act(() => {
      send({ id: request.id, error: "操作已取消" });
    });
    await screen.findByText("操作已取消");
  });
  it("仅填 IP 即可连接，确认上线后自动关闭并锁定目标", async () => {
    const { devices, postMessage } = setup();
    await screen.findByRole("button", { name: /测试设备 A/ });
    fireEvent.click(screen.getByRole("button", { name: "无线连接" }));
    fireEvent.change(screen.getByLabelText("连接地址"), {
      target: { value: "192.168.1.51" },
    });
    devices.push({
      serial: "192.168.1.51:5555",
      name: "客厅电视",
      state: "device",
    });
    fireEvent.click(screen.getByRole("button", { name: "连接设备" }));
    expect(await screen.findByText(/已连接到 客厅电视/)).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      screen
        .getByRole("button", { name: /客厅电视.*192/ })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(postMessage.mock.calls.map(([m]) => m)).toContainEqual(
      expect.objectContaining({
        action: "connect",
        payload: { endpoint: "192.168.1.51:5555" },
      }),
    );
  });
  it("配对后清空配对地址，明确要求输入连接端口", async () => {
    const { postMessage } = setup();
    fireEvent.click(screen.getByRole("button", { name: "无线连接" }));
    fireEvent.click(screen.getByRole("button", { name: "配对码配对" }));
    fireEvent.change(screen.getByLabelText("配对地址"), {
      target: { value: "192.168.1.20:41234" },
    });
    fireEvent.change(screen.getByLabelText("六位配对码"), {
      target: { value: "012345" },
    });
    fireEvent.click(screen.getByRole("button", { name: "配对设备" }));
    expect(await screen.findByText(/配对成功/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "手动连接" }));
    expect((screen.getByLabelText("连接地址") as HTMLInputElement).value).toBe(
      "",
    );
    expect(postMessage.mock.calls.some(([m]) => m.action === "connect")).toBe(
      false,
    );
  });
  it("链接只传 url，轮询保留安装错误与锁定目标", async () => {
    const { send, postMessage } = setup();
    fireEvent.click(await screen.findByRole("button", { name: /测试设备 A/ }));
    fireEvent.mouseDown(screen.getByRole("tab", { name: "链接安装" }), {
      button: 0,
    });
    const submit = screen.getByRole("button", {
      name: "安装到 测试设备 A",
    }) as HTMLButtonElement;
    fireEvent.change(screen.getByLabelText("APK 下载地址"), {
      target: { value: "file:///local.apk" },
    });
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("APK 下载地址"), {
      target: { value: "https://example.test/demo.apk" },
    });
    fireEvent.click(submit);
    const install = postMessage.mock.calls.find(
      ([m]) => m.action === "install",
    )![0];
    expect(install.payload).toEqual({
      serial: "A",
      url: "https://example.test/demo.apk",
    });
    act(() => {
      send({ id: install.id, error: "签名不匹配" });
    });
    await screen.findByText("签名不匹配");
    const before = postMessage.mock.calls.length;
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(
      postMessage.mock.calls.slice(before).map(([m]) => m.action),
    ).toContain("list");
    expect(screen.getByText("签名不匹配")).toBeTruthy();
    expect(submit.disabled).toBe(false);
  });
  it("配对设备自动上线时直接返回设备列表", async () => {
    const { devices, postMessage } = setup();
    await screen.findByRole("button", { name: /测试设备 A/ });
    fireEvent.click(screen.getByRole("button", { name: "无线连接" }));
    fireEvent.click(screen.getByRole("button", { name: "配对码配对" }));
    fireEvent.change(screen.getByLabelText("配对地址"), {
      target: { value: "192.168.1.20:41234" },
    });
    fireEvent.change(screen.getByLabelText("六位配对码"), {
      target: { value: "123456" },
    });
    devices.push({
      serial: "192.168.1.20:45678",
      name: "电视",
      state: "device",
    });
    fireEvent.click(screen.getByRole("button", { name: "配对设备" }));
    expect(await screen.findByText(/已连接到 电视/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "手动连接" })).toBeNull();
    expect(postMessage.mock.calls.some(([m]) => m.action === "connect")).toBe(
      false,
    );
  });
  it("未授权和离线设备显示恢复提示并禁止选择", async () => {
    const { devices } = setup();
    await screen.findByRole("button", { name: /测试设备 A/ });
    devices[0].state = "unauthorized";
    devices[1].state = "offline";
    fireEvent.click(screen.getByRole("button", { name: /刷新 USB/ }));
    expect(
      (
        (await screen.findByRole("button", {
          name: /请在设备上允许调试/,
        })) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (
        screen.getByRole("button", {
          name: /离线 · 请重新连接设备/,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
});
