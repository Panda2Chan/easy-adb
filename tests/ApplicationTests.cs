using EasyAdb.Core;
using Xunit;

namespace EasyAdb.Tests;

public class ApplicationTests(FakeAdb fake) : IClassFixture<FakeAdb>
{
    private const string Serial = "192.0.2.42:5555";
    private const string Package = "com.example.app";
    private AdbClient Client => new(fake.Executable);
    private static string[] Target(params string[] args) => ["-s", Serial, .. args];

    [Fact]
    public async Task ListsUserAndSystemPackagesOnSelectedDevice()
    {
        fake.Reply(Target("shell", "pm", "list", "packages", "-3"), "package:" + Package);
        fake.Then(1, Target("shell", "pm", "list", "packages", "-s"), "package:android");
        var apps = await Client.ListAppsAsync(Serial, default);
        Assert.Contains(new DeviceApp(Package, false), apps);
        Assert.Contains(new DeviceApp("android", true), apps);
        Assert.Equal(2, apps.Count);
    }

    [Theory]
    [InlineData("39\n3", 42L)]
    [InlineData("39", null)]
    [InlineData("39\nstat: Permission denied", null)]
    public async Task InfoCountsAllSplitFilesOrReturnsUnknown(string sizes, long? expected)
    {
        fake.Reply(Target("shell", "dumpsys", "package", Package), "    versionName=1.2.3\n");
        fake.Then(1, Target("shell", "pm", "path", Package), "package:/data/app/a/base.apk\npackage:/data/app/a/split foo.apk");
        fake.Then(2, Target("shell", "stat", "-c", "%s", "'/data/app/a/base.apk'", "'/data/app/a/split foo.apk'"), sizes);
        var info = await Client.AppInfoAsync(Serial, Package, default);
        Assert.Equal("1.2.3", info.VersionName);
        Assert.Equal(expected, info.SizeBytes);
    }

    [Fact]
    public async Task InfoReturnsNullForUnavailableFields()
    {
        fake.Reply(Target("shell", "dumpsys", "package", Package), "versionName=null");
        fake.Then(1, Target("shell", "pm", "path", Package), "", exit: 1);
        Assert.Equal(new PackageInfo(null, null), await Client.AppInfoAsync(Serial, Package, default));
    }

    [Theory]
    [InlineData("", "com.test")]
    [InlineData(Serial, "-k")]
    [InlineData(Serial, "com.app;id")]
    [InlineData(Serial, "a..b")]
    [InlineData(Serial, "com.app\n")]
    public async Task RejectsInvalidTargetBeforeRunningAdb(string serial, string package)
    {
        fake.Reply([], "");
        await Assert.ThrowsAnyAsync<ArgumentException>(() => Client.UninstallAppAsync(serial, package, default));
        await Assert.ThrowsAnyAsync<ArgumentException>(() => Client.AppInfoAsync(serial, package, default));
        Assert.Equal(0, fake.Calls);
    }

    [Theory]
    [InlineData("")]
    [InlineData("package:com.example.app.helper")]
    [InlineData("Error: package manager unavailable")]
    public async Task RefusesUninstallWithoutExactThirdPartyClassification(string proof)
    {
        fake.Reply(Target("shell", "pm", "list", "packages", "-3", Package), proof);
        await Assert.ThrowsAsync<InvalidOperationException>(() => Client.UninstallAppAsync(Serial, Package, default));
        Assert.Equal(1, fake.Calls);
    }

    [Theory]
    [InlineData("Success", true)]
    [InlineData("Failure [DELETE_FAILED_INTERNAL_ERROR]", false)]
    public async Task UninstallChecksRealReplyOnSameDevice(string output, bool success)
    {
        fake.Reply(Target("shell", "pm", "list", "packages", "-3", Package), "package:" + Package);
        fake.Then(1, Target("uninstall", Package), output);
        if (success) await Client.UninstallAppAsync(Serial, Package, default);
        else await Assert.ThrowsAsync<InvalidOperationException>(() => Client.UninstallAppAsync(Serial, Package, default));
        Assert.Equal(2, fake.Calls);
    }
}
