import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppLibrary } from "@/components/AppLibrary";
import { Bridge } from "@/lib/bridge";

afterEach(cleanup);
const user = { packageName: "org.test.reader", isSystem: false };
const system = { packageName: "org.test.settings", isSystem: true };
const info = { versionName: "2.4.1", sizeBytes: 1572864 };
const target = { serial: "A", packageName: user.packageName };
const button = (name: string | RegExp) => screen.getByRole("button", { name });

function setup(serial = "A") {
  const bus = new EventTarget();
  const post =
    vi.fn<
      (message: {
        id: string | number;
        action: string;
        payload: unknown;
      }) => void
    >();
  const bridge = new Bridge(Object.assign(bus, { postMessage: post }));
  const view = (id: string) => (
    <AppLibrary bridge={bridge} serial={id} deviceName={`设备 ${id}`} />
  );
  const { rerender } = render(view(serial));
  const calls = (action: string) =>
    post.mock.calls.map(([m]) => m).filter((m) => m.action === action);
  async function reply(
    action: string,
    result: unknown,
    index = 0,
    failed = false,
  ) {
    const request = calls(action)[index];
    expect(request).toBeDefined();
    await act(async () => {
      bus.dispatchEvent(
        new MessageEvent("message", {
          data: {
            id: request.id,
            ...(failed ? { error: result } : { result }),
          },
        }),
      );
    });
  }
  return { calls, reply, switchTo: (id: string) => rerender(view(id)) };
}

describe("设备应用库", () => {
  it("选择设备后才读取列表，区分加载、错误重试和空设备", async () => {
    const host = setup("");
    expect(screen.getByText(/请选择目标设备/)).toBeTruthy();
    expect(host.calls("listApps")).toHaveLength(0);
    host.switchTo("A");
    expect(host.calls("listApps")[0].payload).toEqual({ serial: "A" });
    expect(screen.getByText(/正在读取应用列表/)).toBeTruthy();
    await host.reply("listApps", "设备离线", 0, true);
    expect(screen.getByRole("alert").textContent).toContain("设备离线");
    fireEvent.click(button(/重试/));
    await host.reply("listApps", [], 1);
    expect(screen.getByText(/设备上没有已安装应用/)).toBeTruthy();
  });

  it("按真实包名搜索，系统应用仅允许查看，详情失败可重试", async () => {
    const host = setup();
    await host.reply("listApps", [user, system]);
    expect(host.calls("appInfo")).toHaveLength(0);
    fireEvent.click(screen.getByRole("checkbox", { name: "显示系统应用" }));
    const search = screen.getByRole("searchbox");
    fireEvent.change(search, { target: { value: "absent" } });
    expect(screen.getByText("没有找到匹配的应用")).toBeTruthy();
    fireEvent.click(button("清空搜索"));
    expect(document.activeElement).toBe(search);
    fireEvent.change(search, { target: { value: " SETTINGS " } });
    expect(
      screen.queryByRole("button", { name: /org.test.reader/ }),
    ).toBeNull();
    fireEvent.click(button(/org.test.settings/));
    expect(host.calls("appInfo")[0].payload).toEqual({
      serial: "A",
      packageName: system.packageName,
    });
    await host.reply("appInfo", "读取失败", 0, true);
    fireEvent.click(button(/重试/));
    await host.reply("appInfo", { versionName: null, sizeBytes: null }, 1);
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getAllByText("未知")).toHaveLength(2);
    expect(dialog.getByText(/系统应用受保护/)).toBeTruthy();
    expect(dialog.queryByRole("button", { name: /卸载/ })).toBeNull();
  });

  it("卸载要求二次确认，取消不发请求，失败后可以重试", async () => {
    const host = setup();
    await host.reply("listApps", [user]);
    fireEvent.click(button(/org.test.reader/));
    await host.reply("appInfo", info);
    expect(screen.getByText("2.4.1")).toBeTruthy();
    expect(screen.getByText("1.5 MiB")).toBeTruthy();
    fireEvent.click(button("卸载应用"));
    expect(screen.getByRole("dialog").textContent).toContain("设备 A");
    fireEvent.click(button("取消"));
    expect(host.calls("uninstallApp")).toHaveLength(0);
    fireEvent.click(button("卸载应用"));
    fireEvent.click(button("确认卸载"));
    expect(host.calls("uninstallApp")[0].payload).toEqual(target);
    expect((button("正在卸载…") as HTMLButtonElement).disabled).toBe(true);
    await host.reply("uninstallApp", "权限不足", 0, true);
    expect(screen.getByRole("alert").textContent).toContain("权限不足");
    fireEvent.click(button("确认卸载"));
    await host.reply("uninstallApp", true, 1);
    expect(host.calls("listApps")[1].payload).toEqual({ serial: "A" });
    await host.reply("listApps", [system], 1);
    fireEvent.click(screen.getByRole("checkbox", { name: "显示系统应用" }));
    expect(button(/org.test.settings/)).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      screen.queryByRole("button", { name: /org.test.reader/ }),
    ).toBeNull();
  });

  it("切换设备后忽略旧列表，切换应用后忽略旧详情", async () => {
    const host = setup();
    host.switchTo("B");
    await host.reply("listApps", [user, system], 1);
    await host.reply("listApps", [], 0);
    fireEvent.click(button(/org.test.reader/));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    fireEvent.click(screen.getByRole("checkbox", { name: "显示系统应用" }));
    fireEvent.click(button(/org.test.settings/));
    await host.reply("appInfo", info, 1);
    await host.reply("appInfo", "旧错误", 0, true);
    expect(screen.getByText("2.4.1")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("卸载期间切换设备，旧回执不会移除新设备上的同名包", async () => {
    const host = setup();
    await host.reply("listApps", [user]);
    fireEvent.click(button(/org.test.reader/));
    await host.reply("appInfo", info);
    fireEvent.click(button("卸载应用"));
    fireEvent.click(button("确认卸载"));
    host.switchTo("B");
    await host.reply("listApps", [user], 1);
    await host.reply("uninstallApp", true);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(button(/org.test.reader/)).toBeTruthy();
    expect(screen.queryByText(/已卸载/)).toBeNull();
    expect(host.calls("uninstallApp").map((m) => m.payload)).toEqual([target]);
  });
});
