using System.Diagnostics;
using System.Text;

namespace EasyAdb.Core;

public record Device(string Serial, string Name, string State);

public class AdbClient(string executable)
{
    public async Task<IReadOnlyList<Device>> ListAsync(CancellationToken ct)
    {
        var reply = await RunAsync(["devices", "-l"], TimeSpan.FromSeconds(15), ct).ConfigureAwait(false);
        var lines = Lines(reply.Output);
        int header = Array.IndexOf(lines, "List of devices attached");
        if (header < 0) throw reply.Failure();

        var devices = new List<Device>();
        foreach (var line in lines.Skip(header + 1))
        {
            var fields = line.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries);
            if (fields.Length < 2) throw reply.Failure();
            var model = fields.Skip(2).FirstOrDefault(f => f.StartsWith("model:", StringComparison.Ordinal));
            var name = model is { Length: > 6 } ? model[6..].Replace('_', ' ') : fields[0];
            var state = fields.Length >= 3 && fields[1] == "no" && fields[2] == "permissions" ? "no permissions" : fields[1];
            devices.Add(new Device(fields[0], name, state));
        }
        return devices;
    }

    public async Task ConnectAsync(string endpoint, CancellationToken ct)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(endpoint);
        var reply = await RunAsync(["connect", endpoint], TimeSpan.FromSeconds(30), ct).ConfigureAwait(false);
        var result = reply.LastLine;
        if (!HasTarget(result, "connected to ") && !HasTarget(result, "already connected to "))
            throw reply.Failure();
    }

    public async Task PairAsync(string endpoint, string code, CancellationToken ct)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(endpoint);
        if (code is not { Length: 6 } || !code.All(char.IsAsciiDigit))
            throw new ArgumentException("请输入六位数字配对码。", nameof(code));
        var reply = await RunAsync(["pair", endpoint], TimeSpan.FromSeconds(60), ct, code).ConfigureAwait(false);
        // adb 的交互提示没有换行，重定向 stdin 时提示和结果可能在同一行。
        const string prompt = "Enter pairing code:";
        var result = reply.LastLine;
        if (result.StartsWith(prompt, StringComparison.Ordinal)) result = result[prompt.Length..].TrimStart();
        if (!HasTarget(result, "Successfully paired to ")) throw reply.Failure();
    }

    public async Task InstallAsync(string serial, string file, CancellationToken ct)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(serial);
        ArgumentException.ThrowIfNullOrWhiteSpace(file);
        var reply = await RunAsync(["-s", serial, "install", Path.GetFullPath(file)], TimeSpan.FromMinutes(5), ct).ConfigureAwait(false);
        var lines = Lines(reply.Output);
        if (!lines.Contains("Success", StringComparer.Ordinal) || lines.Concat(Lines(reply.Error)).Any(IsInstallError))
            throw reply.Failure();
    }

    private static bool IsInstallError(string line) =>
        line.StartsWith("Failure", StringComparison.OrdinalIgnoreCase) ||
        line.StartsWith("Error:", StringComparison.OrdinalIgnoreCase) ||
        line.StartsWith("adb: failed", StringComparison.OrdinalIgnoreCase) ||
        line.StartsWith("adb: error:", StringComparison.OrdinalIgnoreCase);

    private static bool HasTarget(string result, string prefix) =>
        result.StartsWith(prefix, StringComparison.Ordinal) && result.Length > prefix.Length;

    private static string[] Lines(string text) =>
        text.Split('\n', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);

    private sealed record Reply(string Output, string Error, int ExitCode)
    {
        public string LastLine => Lines(Output).LastOrDefault() ?? "";

        public InvalidOperationException Failure()
        {
            var details = string.Join(Environment.NewLine, new[] { Error.Trim(), Output.Trim() }.Where(s => s.Length > 0));
            if (details.Length == 0) details = "未收到 ADB 结果。";
            return new InvalidOperationException($"ADB 操作失败（退出码 {ExitCode}）：{details}");
        }
    }

    private async Task<Reply> RunAsync(string[] args, TimeSpan timeout, CancellationToken ct, string? code = null)
    {
        ct.ThrowIfCancellationRequested();
        var start = new ProcessStartInfo(executable)
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            RedirectStandardInput = code is not null,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8
        };
        if (code is not null) start.StandardInputEncoding = new UTF8Encoding(false);
        foreach (var arg in args) start.ArgumentList.Add(arg);
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(ct);
        deadline.CancelAfter(timeout);
        using var process = Process.Start(start) ?? throw new InvalidOperationException("无法启动 ADB。");
        try
        {
            var stdout = process.StandardOutput.ReadToEndAsync(deadline.Token);
            var stderr = process.StandardError.ReadToEndAsync(deadline.Token);
            if (code is not null)
            {
                process.StandardInput.NewLine = "\n";
                await process.StandardInput.WriteLineAsync(code.AsMemory(), deadline.Token).ConfigureAwait(false);
                process.StandardInput.Close();
            }
            await process.WaitForExitAsync(deadline.Token).ConfigureAwait(false);
            var output = await stdout.WaitAsync(deadline.Token).ConfigureAwait(false);
            var error = await stderr.WaitAsync(deadline.Token).ConfigureAwait(false);
            if (code is not null)
            {
                output = output.Replace(code, "******", StringComparison.Ordinal);
                error = error.Replace(code, "******", StringComparison.Ordinal);
            }
            var reply = new Reply(output, error, process.ExitCode);
            if (reply.ExitCode != 0) throw reply.Failure();
            return reply;
        }
        catch (OperationCanceledException) when (deadline.IsCancellationRequested)
        {
            ct.ThrowIfCancellationRequested();
            throw new TimeoutException($"ADB 操作超过 {timeout.TotalSeconds:0} 秒。");
        }
        finally
        {
            if (!process.HasExited)
            {
                try { process.Kill(entireProcessTree: true); }
                catch (InvalidOperationException) when (process.HasExited) { }
                await process.WaitForExitAsync().ConfigureAwait(false);
            }
        }
    }
}
