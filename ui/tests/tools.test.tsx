import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { DeviceText } from "@/components/DeviceText";
import { UpdateCheck, isNewRelease } from "@/components/UpdateCheck";
import { diagnoseInstall } from "@/lib/installDiagnosis";
import { Bridge } from "@/lib/bridge";
afterEach(cleanup);
it("只把降级修复建议用于明确的版本降级错误", () => {
  expect(
    diagnoseInstall("Failure [INSTALL_FAILED_VERSION_DOWNGRADE]")?.downgrade,
  ).toBe(true);
  expect(diagnoseInstall("INSTALL_FAILED_NO_MATCHING_ABIS")?.title).toContain(
    "CPU",
  );
  expect(
    diagnoseInstall("INSTALL_FAILED_UPDATE_INCOMPATIBLE")?.downgrade,
  ).toBeUndefined();
  expect(diagnoseInstall("操作已取消")).toBeUndefined();
});
it("按数值比较稳定版，并只在用户点击后打开发行页", async () => {
  expect(isNewRelease("v0.10.0", "0.2.0")).toBe(true);
  expect(isNewRelease("v1.0.0-beta", "0.2.0")).toBe(false);
  const request = vi.fn().mockResolvedValue({ version: "v0.10.0" });
  render(
    <UpdateCheck
      bridge={{ available: true, request } as unknown as Bridge}
      current="0.2.0"
    />,
  );
  await screen.findByText("发现新版本 v0.10.0");
  expect(request.mock.calls).toEqual([["checkUpdate", {}]]);
  fireEvent.click(screen.getByRole("button", { name: "查看并下载" }));
  expect(request).toHaveBeenCalledWith("openReleases", {});
});
it("仅把用户填写的文本发送到选中的序列号", async () => {
  const request = vi.fn().mockResolvedValue(null);
  render(
    <DeviceText
      bridge={{ request } as unknown as Bridge}
      serial="A"
      name="客厅电视"
    />,
  );
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "test A&B" },
  });
  fireEvent.click(screen.getByRole("button", { name: "发送文本" }));
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toContain(
      "已向 客厅电视 发送文本",
    ),
  );
  expect(request.mock.calls).toEqual([
    ["sendText", { serial: "A", text: "test A&B" }],
  ]);
});
