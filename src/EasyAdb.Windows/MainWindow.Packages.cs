using System.Diagnostics;
using System.IO;
using System.Security.Cryptography;
using System.Text.Json.Nodes;
using EasyAdb.Core;

namespace EasyAdb.Windows;

public partial class MainWindow
{
    private sealed record PackagePlan(string Token, string Serial, string Directory, string[] Files, string[] Hashes, bool Blocked);
    private PackagePlan? prepared;

    private async Task<object> PrepareFilesAsync(AdbClient adb, string serial, string file, CancellationToken ct)
    {
        if (prepared is { } previous) { prepared = null; Directory.Delete(previous.Directory, true); }
        string token = Guid.NewGuid().ToString("N");
        string directory = Path.Combine(session, token);
        Directory.CreateDirectory(directory);
        try
        {
            var tools = Path.Combine(AppContext.BaseDirectory, "package-tools");
            var start = new ProcessStartInfo(Path.Combine(tools, "preflight.exe"))
            { UseShellExecute = false, CreateNoWindow = true, RedirectStandardError = true, StandardErrorEncoding = System.Text.Encoding.UTF8 };
            foreach (var arg in new[] { file, directory, Path.Combine(tools, "aapt2.exe"), adb.ExecutablePath, serial }) start.ArgumentList.Add(arg);
            using var proc = Process.Start(start) ?? throw new IOException("无法启动预检工具。");
            using var deadline = CancellationTokenSource.CreateLinkedTokenSource(ct);
            deadline.CancelAfter(TimeSpan.FromMinutes(5));
            var error = proc.StandardError.ReadToEndAsync();
            try { await proc.WaitForExitAsync(deadline.Token); }
            catch (OperationCanceledException) { if (!proc.HasExited) proc.Kill(true); await proc.WaitForExitAsync(); throw; }
            if (proc.ExitCode != 0) throw new InvalidDataException((await error).Trim());
            var report = JsonNode.Parse(await File.ReadAllTextAsync(Path.Combine(directory, "report.json"), ct))!.AsObject();
            var paths = report["files"]!.AsArray().Select(v => (string)v!).ToArray();
            if (paths.Length == 0 || paths.Any(n => !System.Text.RegularExpressions.Regex.IsMatch(n, @"\A(?:source|part-[0-9]{3})\.apk\z"))) throw new InvalidDataException("预检结果无效。");
            var hashes = report["digests"]!.AsArray().Select(v => (string)v!).ToArray();
            if (hashes.Length != paths.Length) throw new InvalidDataException("预检校验值无效。");
            prepared = new(token, serial, directory, paths.Select(n => Path.Combine(directory, n)).ToArray(), hashes, (string?)report["compatibility"] == "incompatible");
            report.Remove("files"); report.Remove("digests"); report["token"] = token;
            return report;
        }
        catch { Directory.Delete(directory, true); throw; }
    }

    private async Task InstallPreparedAsync(string serial, string token, bool downgrade)
    {
        if (installing != null || prepared is not { } plan || plan.Serial != serial || plan.Token != token || plan.Blocked)
            throw new InvalidOperationException("预检失效、设备不匹配或不兼容，请重新预检。");
        using var operation = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token);
        installing = operation;
        var locks = new List<FileStream>();
        try
        {
            for (int i = 0; i < plan.Files.Length; i++)
            {
                var stream = File.Open(plan.Files[i], FileMode.Open, FileAccess.Read, FileShare.Read);
                locks.Add(stream);
                var digest = await SHA256.HashDataAsync(stream, operation.Token);
                if (!Convert.ToHexString(digest).Equals(plan.Hashes[i], StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("文件已变更，请重新预检。");
            }
            Send(new { @event = "stage", value = "installing" });
            await Client().InstallPackagesAsync(serial, plan.Files, downgrade, operation.Token);
            prepared = null;
        }
        finally
        {
            foreach (var stream in locks) stream.Dispose();
            installing = null;
            if (closing) _ = Dispatcher.BeginInvoke(new Action(Close));
            if (prepared == null) Directory.Delete(plan.Directory, true);
        }
    }
}
