package main

import (
	"archive/zip"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

// 两份无可执行代码的 AAPT2 / bundletool 测试包。仅解析，绝不调用设备安装。
func TestRealPackages(t *testing.T) {
	aapt := os.Getenv("AAPT2_PATH")
	if aapt == "" {
		t.Skip("需要 Android SDK 的 AAPT2_PATH")
	}
	p := profile{33, []string{"arm64-v8a"}, 420, "zh-CN"}
	tmp := t.TempDir()
	xapk := filepath.Join(tmp, "player.xapk")
	f, e := os.Create(xapk)
	if e != nil {
		t.Fatal(e)
	}
	out := zip.NewWriter(f)
	src, e := zip.OpenReader("testdata/player.apks")
	if e != nil {
		t.Fatal(e)
	}
	defer src.Close()
	for _, in := range src.File {
		if strings.HasSuffix(in.Name, ".apk") {
			z, _ := out.Create(in.Name)
			r, _ := in.Open()
			_, e := io.Copy(z, r)
			r.Close()
			if e != nil {
				t.Fatal(e)
			}
		}
	}
	z, _ := out.Create("manifest.json")
	io.WriteString(z, `{"package_name":"org.example.easyadb.qa","split_apks":[{"file":"splits/base-master.apk"},{"file":"splits/base-zh.apk"}]}`)
	out.Close()
	f.Close()
	for _, file := range []string{"testdata/player.apk", "testdata/player.apks", xapk} {
		r, e := stage(file, t.TempDir(), aapt, p)
		if e != nil {
			t.Fatal(file, e)
		}
		if r["minSdk"] != 28 || r["versionName"] != "1.7" || r["label"] != "测试播放器" || r["packageName"] != "org.example.easyadb.qa" || r["compatibility"] != "compatible" || r["iconDataUrl"] == nil {
			t.Fatalf("%s: %v", file, r)
		}
		if file != "testdata/player.apk" && !reflect.DeepEqual(r["selectedSplits"], []string{"splits/base-master.apk", "splits/base-zh.apk"}) {
			t.Fatal(r)
		}
	}
	p.locale = "en-US"
	r, e := stage("testdata/player.apks", t.TempDir(), aapt, p)
	if e != nil || len(r["selectedSplits"].([]string)) != 1 {
		t.Fatal(r, e)
	}
	p.sdk = 26
	r, e = stage("testdata/player.apk", t.TempDir(), aapt, p)
	if e != nil || r["compatibility"] != "incompatible" {
		t.Fatal(r, e)
	}
}
