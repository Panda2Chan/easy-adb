using System.Globalization;
using System.Text.RegularExpressions;

namespace EasyAdb.Core;

public sealed record DeviceApp(string PackageName, bool IsSystem);
public sealed record PackageInfo(string? VersionName, long? SizeBytes);

public partial class AdbClient
{
    // android 是合法的单段系统包名。白名单同时约束传给设备 shell 的参数。
    [GeneratedRegex(@"\A[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)*\z", RegexOptions.CultureInvariant)]
    private static partial Regex PackageNamePattern();

    private static void ValidateTarget(string serial, string packageName)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(serial);
        if (string.IsNullOrEmpty(packageName) || !PackageNamePattern().IsMatch(packageName))
            throw new ArgumentException("无效的 Android 包名。", nameof(packageName));
    }

    private Task<Reply> RunOnDeviceAsync(string serial, string[] args, CancellationToken ct, bool allowShellFailure = false) =>
        RunAsync(["-s", serial, .. args], TimeSpan.FromSeconds(30), ct, allowShellFailure: allowShellFailure);

    private async Task<string[]> ReadPackagesAsync(string serial, string[] filters, CancellationToken ct)
    {
        var reply = await RunOnDeviceAsync(serial, ["shell", "pm", "list", "packages", .. filters], ct).ConfigureAwait(false);
        if (!string.IsNullOrWhiteSpace(reply.Error)) throw reply.Failure();
        return Lines(reply.Output).Select(line =>
        {
            if (!line.StartsWith("package:", StringComparison.Ordinal) || !PackageNamePattern().IsMatch(line[8..]))
                throw reply.Failure();
            return line[8..];
        }).ToArray();
    }

    public async Task<IReadOnlyList<DeviceApp>> ListAppsAsync(string serial, CancellationToken ct)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(serial);
        var users = await ReadPackagesAsync(serial, ["-3"], ct).ConfigureAwait(false);
        var systems = await ReadPackagesAsync(serial, ["-s"], ct).ConfigureAwait(false);
        return systems.Select(name => new DeviceApp(name, true))
            .Concat(users.Select(name => new DeviceApp(name, false)))
            .DistinctBy(app => app.PackageName, StringComparer.Ordinal).OrderBy(app => app.PackageName, StringComparer.Ordinal).ToArray();
    }

    public async Task<PackageInfo> AppInfoAsync(string serial, string packageName, CancellationToken ct)
    {
        ValidateTarget(serial, packageName);
        var dump = await RunOnDeviceAsync(serial, ["shell", "dumpsys", "package", packageName], ct, true).ConfigureAwait(false);
        var version = dump.ExitCode == 0 ? Lines(dump.Output).FirstOrDefault(line => line.StartsWith("versionName=", StringComparison.Ordinal))?[12..] : null;
        var size = await ReadApkSizeAsync(serial, packageName, ct).ConfigureAwait(false);
        return new(version is null or "" or "null" ? null : version, size);
    }

    private async Task<long?> ReadApkSizeAsync(string serial, string packageName, CancellationToken ct)
    {
        var paths = await RunOnDeviceAsync(serial, ["shell", "pm", "path", packageName], ct, true).ConfigureAwait(false);
        var lines = Lines(paths.Output);
        if (paths.ExitCode != 0 || paths.Error.Length > 0 || lines.Length == 0 ||
            lines.Any(line => !line.StartsWith("package:/", StringComparison.Ordinal) || !line.EndsWith(".apk", StringComparison.OrdinalIgnoreCase))) return null;
        // adb shell 会在设备端重新解析参数，逐个引用 pm 返回的绝对路径。
        var files = lines.Distinct(StringComparer.Ordinal).Select(line => "'" + line[8..].Replace("'", "'\\''") + "'").ToArray();
        var stat = await RunOnDeviceAsync(serial, ["shell", "stat", "-c", "%s", .. files], ct, true).ConfigureAwait(false);
        var sizes = Lines(stat.Output);
        if (stat.ExitCode != 0 || stat.Error.Length > 0 || sizes.Length != files.Length) return null;
        long total = 0;
        foreach (var value in sizes)
        {
            if (!long.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out var bytes) || bytes > long.MaxValue - total) return null;
            total += bytes;
        }
        return total;
    }

    public async Task UninstallAppAsync(string serial, string packageName, CancellationToken ct)
    {
        ValidateTarget(serial, packageName);
        // pm 的过滤条件是子串匹配。卸载前重新确认同一设备上的完整包名是第三方应用。
        var users = await ReadPackagesAsync(serial, ["-3", packageName], ct).ConfigureAwait(false);
        if (!users.Contains(packageName, StringComparer.Ordinal))
            throw new InvalidOperationException("不能卸载系统应用、已移除或无法确认类型的应用。");
        var reply = await RunOnDeviceAsync(serial, ["uninstall", packageName], ct).ConfigureAwait(false);
        if (reply.LastLine != "Success" || Lines(reply.Error).Concat(Lines(reply.Output)).Any(IsInstallError)) throw reply.Failure();
    }
}
