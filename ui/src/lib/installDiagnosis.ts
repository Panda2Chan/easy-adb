export type Diagnosis = { title: string; advice: string; downgrade?: boolean };
const cases: [RegExp, Diagnosis][] = [
  [
    /INSTALL_FAILED_VERSION_DOWNGRADE\b/i,
    {
      title: "设备上已安装更高版本",
      advice:
        "优先选择相同或更高版本的安装包。对于允许降级的调试应用，可尝试保留数据降级。",
      downgrade: true,
    },
  ],
  [
    /(?:NO_MATCHING_ABIS|CPU_ABI_INCOMPATIBLE)\b/i,
    {
      title: "安装包与设备的 CPU 架构不匹配",
      advice: "选择支持设备架构的 APK，或下载包含该架构的完整分包。",
    },
  ],
  [
    /INSTALL_FAILED_OLDER_SDK\b/i,
    {
      title: "设备的 Android 系统版本过低",
      advice: "下载适配当前系统的旧版应用，或在设备设置中检查系统升级。",
    },
  ],
  [
    /INSTALL_FAILED_(?:UPDATE_INCOMPATIBLE|SHARED_USER_INCOMPATIBLE)|INSTALL_PARSE_FAILED_INCONSISTENT_CERTIFICATES/i,
    {
      title: "应用签名不一致",
      advice:
        "使用与已安装版本相同发布方的安装包。卸载原应用会移除其本地数据。",
    },
  ],
  [
    /INSTALL_FAILED_INSUFFICIENT_STORAGE/i,
    { title: "设备空间不足", advice: "在目标设备上释放存储空间后重试。" },
  ],
  [
    /INSTALL_FAILED_MISSING_SPLIT/i,
    {
      title: "应用缺少必要的分包",
      advice: "选择包含基础包及所需配置包的完整 APKS 或 XAPK。",
    },
  ],
  [
    /INSTALL_FAILED_USER_RESTRICTED/i,
    {
      title: "设备限制了应用安装",
      advice: "查看设备上的安装确认提示和 USB 调试安装权限。",
    },
  ],
  [
    /INSTALL_FAILED_(?:INVALID_APK|BAD_SIGNATURE)|INSTALL_PARSE_FAILED_/i,
    {
      title: "设备无法验证安装包",
      advice: "从原发布方重新获取完整安装包，再进行预检。",
    },
  ],
];
export const diagnoseInstall = (raw: string) =>
  cases.find(([pattern]) => pattern.test(raw))?.[1];
