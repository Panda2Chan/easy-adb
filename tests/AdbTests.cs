using System;
using System.Diagnostics;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using EasyAdb.Core;
using Xunit;

namespace EasyAdb.Tests;

public class AdbTests(FakeAdb fake) : IClassFixture<FakeAdb>
{
    private const string Endpoint = "127.0.0.1:4321";
    private AdbClient Client => new(fake.Executable);

    [Fact]
    public async Task ListPreservesOfflineAndUnauthorizedDevices()
    {
        fake.Reply(["devices", "-l"], "List of devices attached\r\nUSB1   device product:p model:Pixel_8 transport_id:5\r\nUSB2 offline transport_id:6\r\nUSB3 unauthorized\r\n", "* daemon started successfully *");
        var devices = await Client.ListAsync(default);
        Assert.Equal(new Device("USB1", "Pixel 8", "device"), devices[0]);
        Assert.Equal(new Device("USB2", "USB2", "offline"), devices[1]);
        Assert.Equal(new Device("USB3", "USB3", "unauthorized"), devices[2]);
        Assert.Equal(3, devices.Count);
    }

    [Fact]
    public async Task ListDistinguishesEmptyFromMalformedResponse()
    {
        fake.Reply(["devices", "-l"], "List of devices attached\n\n");
        Assert.Empty(await Client.ListAsync(default));
        fake.Reply(["devices", "-l"], "cannot connect to daemon");
        await Assert.ThrowsAsync<InvalidOperationException>(() => Client.ListAsync(default));
    }

    [Theory]
    [InlineData("connected to ")]
    [InlineData("already connected to ")]
    public async Task ConnectAcceptsBothPositiveReplies(string prefix)
    {
        fake.Reply(["connect", Endpoint], prefix + Endpoint);
        await Client.ConnectAsync(Endpoint, default);
    }

    [Theory]
    [InlineData("127.0.0.1", "127.0.0.1:5555")]
    [InlineData("::1", "[::1]:5555")]
    [InlineData("[::1]:4321", "[::1]:4321")]
    public async Task ConnectDefaultsOnlyMissingPort(string input, string endpoint)
    {
        fake.Reply(["connect", endpoint], "connected to " + endpoint);
        await Client.ConnectAsync(input, default);
    }

    [Fact]
    public async Task ConnectRejectsZeroExitWithFailureText()
    {
        fake.Reply(["connect", Endpoint], "failed to connect to " + Endpoint);
        await Assert.ThrowsAsync<InvalidOperationException>(() => Client.ConnectAsync(Endpoint, default));
    }

    [Fact]
    public async Task PairSendsExactlyOneCodeLineOnStdin()
    {
        fake.Reply(["pair", Endpoint], "Enter pairing code: Successfully paired to " + Endpoint + " [guid=adb-123]", input: "001234");
        await Client.PairAsync(Endpoint, "001234", default);
    }

    [Fact]
    public async Task PairFailureDoesNotDiscloseEchoedCode()
    {
        fake.Reply(["pair", Endpoint], "Enter pairing code: Failed to pair", "rejected 001234", input: "001234");
        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => Client.PairAsync(Endpoint, "001234", default));
        Assert.Contains("rejected", error.Message);
        Assert.DoesNotContain("001234", error.ToString());
    }

    [Theory]
    [InlineData("Success", "", 0, true)]
    [InlineData("Performing Incremental Install\nSuccess\nInstall command complete in 100 ms", "", 0, true)]
    [InlineData("Success\nFailure [INSTALL_FAILED_ABORTED]", "", 0, false)]
    [InlineData("Success", "adb: error: disconnected", 1, false)]
    [InlineData("Performing Streamed Install", "", 0, false)]
    [InlineData("Failure [INSTALL_FAILED_INVALID_APK]", "", 0, false)]
    [InlineData("", "adb: device offline", 1, false)]
    [InlineData("", "adb: device unauthorized.", 1, false)]
    public async Task InstallPreservesArgumentsAndChecksResult(string output, string error, int exit, bool succeeds)
    {
        var apk = Path.Combine(fake.DirectoryPath, "测试 & demo.apk");
        File.WriteAllBytes(apk, []);
        fake.Reply(["-s", Endpoint, "install", apk], output, error, exit);
        var operation = Client.InstallAsync(Endpoint, apk, default);
        if (succeeds) await operation;
        else
        {
            var exception = await Assert.ThrowsAsync<InvalidOperationException>(() => operation);
            Assert.Contains(error.Length == 0 ? output : error, exception.Message);
        }
    }

    [Fact]
    public async Task PairRejectsMultilineCodeBeforeLaunchingAdb()
    {
        fake.Reply(["pair", Endpoint], "");
        await Assert.ThrowsAsync<ArgumentException>(() => Client.PairAsync(Endpoint, "123456\n654321", default));
        Assert.False(File.Exists(fake.PidFile));
    }

    [Fact]
    public async Task ListDrainsBothPipesEvenWhenDaemonIsVerbose()
    {
        fake.Reply(["devices", "-l"], "List of devices attached\n" + new string(' ', 256 * 1024), new string('x', 256 * 1024));
        Assert.Empty(await Client.ListAsync(default));
    }

    [Fact]
    public async Task AlreadyCancelledDoesNotLaunchAdb()
    {
        fake.Reply(["devices", "-l"], "List of devices attached");
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => Client.ListAsync(new CancellationToken(true)));
        Assert.False(File.Exists(fake.PidFile));
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task CancellationAndTimeoutStopRunningProcess(bool cancel)
    {
        fake.Reply(["devices", "-l"], "", hang: true);
        using var cts = new CancellationTokenSource();
        var operation = Client.ListAsync(cts.Token);
        using var startup = new CancellationTokenSource(TimeSpan.FromSeconds(8));
        while (!File.Exists(fake.PidFile)) await Task.Delay(20, startup.Token);
        using var child = Process.GetProcessById(int.Parse(File.ReadAllText(fake.PidFile)));
        if (cancel)
        {
            cts.Cancel();
            await Assert.ThrowsAnyAsync<OperationCanceledException>(() => operation.WaitAsync(TimeSpan.FromSeconds(5)));
        }
        else
        {
            var completed = await Task.WhenAny(operation, Task.Delay(TimeSpan.FromSeconds(30)));
            Assert.Same(operation, completed);
            await Assert.ThrowsAsync<TimeoutException>(() => operation);
        }
        Assert.True(child.HasExited);
    }
}

// 在临时目录生成原生 apphost，Windows CI 能验证真实 argv、管道与进程退出行为。
public sealed class FakeAdb : IDisposable
{
    public string DirectoryPath { get; } = Directory.CreateTempSubdirectory("easy adb tests ").FullName;
    private string Output => Path.Combine(DirectoryPath, "out");
    public string Executable => Path.Combine(Output, OperatingSystem.IsWindows() ? "FakeAdb.exe" : "FakeAdb");
    public string PidFile => Path.Combine(Output, "pid");

    public FakeAdb()
    {
        File.WriteAllText(Path.Combine(DirectoryPath, "NuGet.Config"), "<configuration><packageSources><clear/></packageSources></configuration>");
        File.WriteAllText(Path.Combine(DirectoryPath, "FakeAdb.csproj"), $"""
            <Project Sdk="Microsoft.NET.Sdk"><PropertyGroup>
              <OutputType>Exe</OutputType><TargetFramework>net{Environment.Version.Major}.0</TargetFramework>
            </PropertyGroup></Project>
            """);
        File.WriteAllText(Path.Combine(DirectoryPath, "Program.cs"), """
            using System;
            using System.IO;
            using System.Linq;
            using System.Threading;
            Directory.SetCurrentDirectory(AppContext.BaseDirectory);
            var step = File.Exists("step") ? int.Parse(File.ReadAllText("step")) : 0;
            File.WriteAllText("step", (step + 1).ToString());
            File.WriteAllText("pid.tmp", Environment.ProcessId.ToString());
            File.Move("pid.tmp", "pid", true);
            if (step > 0) Directory.SetCurrentDirectory("step" + step);
            if (!args.SequenceEqual(File.ReadAllLines("argv"))) return 71;
            if (File.Exists("stdin") && (Console.ReadLine() != File.ReadAllText("stdin") || Console.ReadLine() != null)) return 72;
            if (File.Exists("hang")) Thread.Sleep(TimeSpan.FromSeconds(40));
            Console.Write(File.ReadAllText("stdout"));
            Console.Error.Write(File.ReadAllText("stderr"));
            return int.Parse(File.ReadAllText("exit"));
            """);
        var start = new ProcessStartInfo("dotnet") { WorkingDirectory = DirectoryPath, UseShellExecute = false };
        foreach (var arg in new[] { "build", "FakeAdb.csproj", "--nologo", "-o", Output }) start.ArgumentList.Add(arg);
        using var build = Process.Start(start) ?? throw new InvalidOperationException("无法启动测试替身构建");
        if (!build.WaitForExit(60_000)) { build.Kill(true); throw new TimeoutException("构建测试替身超时"); }
        if (build.ExitCode != 0) throw new InvalidOperationException($"构建测试替身失败 ({build.ExitCode})");
    }

    public void Reply(string[] args, string output, string error = "", int exit = 0, string? input = null, bool hang = false)
    {
        File.Delete(PidFile);
        File.Delete(Path.Combine(Output, "step"));
        WriteReply(Output, args, output, error, exit, input, hang);
    }

    public void Then(int step, string[] args, string output, string error = "", int exit = 0) =>
        WriteReply(Directory.CreateDirectory(Path.Combine(Output, "step" + step)).FullName, args, output, error, exit, null, false);

    public int Calls => File.Exists(Path.Combine(Output, "step")) ? int.Parse(File.ReadAllText(Path.Combine(Output, "step"))) : 0;

    private static void WriteReply(string directory, string[] args, string output, string error, int exit, string? input, bool hang)
    {
        File.WriteAllLines(Path.Combine(directory, "argv"), args);
        File.WriteAllText(Path.Combine(directory, "stdout"), output);
        File.WriteAllText(Path.Combine(directory, "stderr"), error);
        File.WriteAllText(Path.Combine(directory, "exit"), exit.ToString());
        var stdin = Path.Combine(directory, "stdin");
        if (input is null) File.Delete(stdin); else File.WriteAllText(stdin, input);
        var delay = Path.Combine(directory, "hang");
        if (hang) File.WriteAllText(delay, ""); else File.Delete(delay);
    }

    public void Dispose() => Directory.Delete(DirectoryPath, true);
}
