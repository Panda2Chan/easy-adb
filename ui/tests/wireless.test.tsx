import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Wireless } from "@/components/Wireless";
import type { Bridge, Device } from "@/lib/bridge";

const host = "192.168.1.23";
const connect = { endpoint: `${host}:41001`, name: "adb-TV", kind: "connect" };
const pair = { ...connect, endpoint: `${host}:42002`, kind: "pair" };
const click = (name: string) =>
  fireEvent.click(screen.getByRole("button", { name }));
const open = () => click("无线连接");
function setup(discover = async (): Promise<unknown> => [connect, pair]) {
  const request = vi.fn(async (action: string, _payload: unknown) =>
    action === "discoverDevices" ? discover() : true,
  );
  const props = {
    bridge: { request } as unknown as Bridge,
    refresh: vi.fn(),
    disabled: false,
    reliable: true,
    devices: [] as Device[],
    onConnected: vi.fn(),
  };
  const view = render(<Wireless {...props} />);
  const update = (serial: string, state: string, reliable = true) =>
    view.rerender(
      <Wireless
        {...props}
        reliable={reliable}
        devices={[{ serial, state, name: "客厅电视" }]}
      />,
    );
  open();
  return { request, update, ...view };
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

it("打开时只发现服务，连接与配对使用各自端口", async () => {
  const { request, update } = setup();
  await screen.findByRole("button", { name: `配对 ${pair.endpoint}` });
  expect(request.mock.calls).toEqual([["discoverDevices", {}]]);
  click(`配对 ${pair.endpoint}`);
  expect((screen.getByLabelText("配对地址") as HTMLInputElement).value).toBe(
    pair.endpoint,
  );
  fireEvent.change(screen.getByLabelText("六位配对码"), {
    target: { value: "654321" },
  });
  click("配对设备");
  await screen.findByText(/配对成功/);
  expect(request).toHaveBeenCalledWith("pair", {
    endpoint: pair.endpoint,
    code: "654321",
  });
  expect(request.mock.calls.some(([action]) => action === "connect")).toBe(
    false,
  );
  expect(localStorage.length).toBe(0);
  click(`连接 ${connect.endpoint}`);
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith("connect", {
      endpoint: connect.endpoint,
    }),
  );
  update(`${connect.name}._adb-tls-connect._tcp`, "device");
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  const saved = localStorage.getItem(localStorage.key(0)!)!;
  expect(saved).toContain(connect.endpoint);
  expect(saved).not.toContain(pair.endpoint);
  expect(saved).not.toContain("654321");
});

it("只记可靠且已授权的设备，重开后能重连和忘记", async () => {
  const { update, unmount } = setup();
  await screen.findByRole("button", { name: `连接 ${connect.endpoint}` });
  click(`连接 ${connect.endpoint}`);
  await screen.findByText(/正在确认在线状态/);
  update(connect.endpoint, "unauthorized");
  update(connect.endpoint, "device", false);
  expect(localStorage.length).toBe(0);
  update(connect.endpoint, "device");
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  unmount();
  const next = setup(async () => []);
  click(`重连 ${connect.endpoint}`);
  await waitFor(() =>
    expect(next.request).toHaveBeenCalledWith("connect", {
      endpoint: connect.endpoint,
    }),
  );
  click(`忘记 ${connect.endpoint}`);
  next.unmount();
  setup(async () => []);
  expect(
    screen.queryByRole("button", { name: `重连 ${connect.endpoint}` }),
  ).toBeNull();
});

it("发现失败和存储受限时仍可手动连接，同一窗口可重连", async () => {
  vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
    throw new DOMException("禁止访问", "SecurityError");
  });
  const { request, update } = setup(async () => {
    throw new Error("mDNS 不可用");
  });
  await screen.findByText(/mDNS 不可用/);
  fireEvent.change(screen.getByLabelText("连接地址"), {
    target: { value: host },
  });
  click("连接设备");
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith("connect", {
      endpoint: `${host}:5555`,
    }),
  );
  update(`${host}:5555`, "online");
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  open();
  expect(
    screen.getByRole("button", { name: `重连 ${host}:5555` }),
  ).toBeTruthy();
  expect(screen.getByText(/仅在当前窗口/)).toBeTruthy();
});

it("同一 mDNS 实例更换端口后，历史重连使用新发现的连接端口", async () => {
  const first = setup();
  await screen.findByRole("button", { name: `连接 ${connect.endpoint}` });
  click(`连接 ${connect.endpoint}`);
  await screen.findByText(/正在确认在线状态/);
  first.update(connect.endpoint, "device");
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  first.unmount();
  const current = `${host}:43210`;
  const next = setup(async () => [
    { ...connect, endpoint: current },
    { ...pair, endpoint: connect.endpoint },
  ]);
  await screen.findByRole("button", { name: `连接 ${current}` });
  click(`重连 ${current}`);
  expect(next.request).toHaveBeenCalledWith("connect", { endpoint: current });
});

it("最近连接最多保留五项，重复连接移动到首位", async () => {
  const { update } = setup(async () => []);
  for (const port of [41001, 41002, 41003, 41004, 41005, 41006, 41003]) {
    const address = `${host}:${port}`;
    fireEvent.change(screen.getByLabelText("连接地址"), {
      target: { value: address },
    });
    click("连接设备");
    await screen.findByText(/正在确认在线状态/);
    update(address, "device");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    open();
  }
  const expected = [41003, 41006, 41005, 41004, 41002].map(
    (p) => `重连 ${host}:${p}`,
  );
  expect(
    screen
      .getAllByRole("button", { name: /^重连 / })
      .map((b) => b.getAttribute("aria-label")),
  ).toEqual(expected);
});
