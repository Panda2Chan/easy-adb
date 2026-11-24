package main

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"image/png"
	"io"
	"os"
	"path/filepath"
	"slices"
	"sort"
	"strings"
)

type part struct {
	file, name string
	meta       metadata
	icon       any
}

func inspect(aapt, file, name string) (part, error) {
	v := part{file: file, name: name}
	z, e := zip.OpenReader(file)
	if e != nil {
		return v, e
	}
	defer z.Close()
	entries, e := entries(&z.Reader)
	if e != nil {
		return v, e
	}
	if entries["AndroidManifest.xml"] == nil || entries["AndroidManifest.xml"].UncompressedSize64 > 8<<20 {
		return v, errors.New("AndroidManifest.xml 缺失或过大")
	}
	if table := entries["resources.arsc"]; table != nil && table.UncompressedSize64 > 128<<20 {
		return v, errors.New("APK 资源表超限")
	}
	s, e := command(aapt, "dump", "badging", file)
	if e != nil {
		return v, e
	}
	v.meta, e = parseBadging(s)
	if e != nil {
		return v, e
	}
	if b, e := readEntry(entries[v.meta.Icon], 512<<10); e == nil {
		if c, e := png.DecodeConfig(bytes.NewReader(b)); e == nil && c.Width <= 1024 && c.Height <= 1024 {
			v.icon = "data:image/png;base64," + base64.StdEncoding.EncodeToString(b)
		}
	}
	return v, nil
}
func nullable(s string) any {
	if s != "" {
		return s
	}
	return nil
}
func stage(src, work, aapt string, p profile) (map[string]any, error) {
	before, e := os.Lstat(src)
	if e != nil || !before.Mode().IsRegular() || before.Size() > maxFile {
		return nil, errors.New("请选择普通的本地安装包文件")
	}
	input, e := os.Open(src)
	if e != nil {
		return nil, e
	}
	defer input.Close()
	info, e := input.Stat()
	if e != nil || !os.SameFile(before, info) || !info.Mode().IsRegular() || info.Size() > maxFile {
		return nil, errors.New("请选择 512 MiB 以内的普通文件")
	}
	snapshot := filepath.Join(work, "source.apk")
	if e = copyPrivate(snapshot, input, maxFile); e != nil {
		return nil, e
	}
	z, e := zip.OpenReader(snapshot)
	if e != nil {
		return nil, e
	}
	defer z.Close()
	files, e := entries(&z.Reader)
	if e != nil {
		return nil, e
	}
	if files["AndroidManifest.xml"] == nil && files["toc.pb"] != nil && files["manifest.json"] != nil {
		return nil, errors.New("分包容器含冲突的格式标记")
	}
	format := "apk"
	var parts []part
	var idx []int
	if files["AndroidManifest.xml"] != nil {
		v, e := inspect(aapt, snapshot, "base.apk")
		if e != nil {
			return nil, e
		}
		if v.meta.Split != "" || v.meta.Required {
			return nil, errors.New("该 APK 需要配套分包")
		}
		parts = []part{v}
		idx = []int{0}
	} else {
		format = "apks"
		var names []string
		var toc []tocEntry
		xpkg := ""
		switch {
		case files["toc.pb"] != nil:
			b, e := readEntry(files["toc.pb"], 4<<20)
			if e != nil {
				return nil, e
			}
			toc, e = selectToc(b, p)
			if e != nil {
				return nil, e
			}
			for _, entry := range toc {
				names = append(names, entry.path)
			}
		case files["manifest.json"] != nil:
			format = "xapk"
			b, e := readEntry(files["manifest.json"], 1<<20)
			if e != nil {
				return nil, e
			}
			var x struct {
				Package    string            `json:"package_name"`
				Expansions []json.RawMessage `json:"expansions"`
				Splits     []struct {
					File string `json:"file"`
				} `json:"split_apks"`
			}
			if json.Unmarshal(b, &x) != nil || !pkgID.MatchString(x.Package) || len(x.Expansions) > 0 {
				return nil, errors.New("XAPK 清单无效或包含 OBB 资源")
			}
			xpkg = x.Package
			for _, s := range x.Splits {
				names = append(names, s.File)
			}
		default:
			if files["base.apk"] == nil && files["meta.sai_v1.json"] == nil && files["meta.sai_v2.json"] == nil {
				return nil, errors.New("无法识别分包容器")
			}
		}
		if files["toc.pb"] == nil {
			var all []string
			for n := range files {
				l := strings.ToLower(n)
				if strings.HasSuffix(l, ".obb") || strings.HasPrefix(l, "android/obb/") {
					return nil, errors.New("暂不支持带 OBB 的容器")
				}
				if strings.HasSuffix(l, ".apk") {
					all = append(all, n)
				}
			}
			sort.Strings(all)
			if len(names) > 0 {
				sort.Strings(names)
				if !slices.Equal(all, names) {
					return nil, errors.New("XAPK 声明与实际 APK 不一致")
				}
			}
			names = all
		}
		if len(names) == 0 || len(names) > 128 {
			return nil, errors.New("分包数为空或超过 128")
		}
		var ids []string
		seen := map[string]bool{}
		for i, n := range names {
			f := files[n]
			if f == nil || !strings.HasSuffix(strings.ToLower(n), ".apk") || seen[n] {
				return nil, errors.New("分包引用无效")
			}
			seen[n] = true
			dest := filepath.Join(work, fmt.Sprintf("part-%03d.apk", i))
			s, e := f.Open()
			if e != nil {
				return nil, e
			}
			e = copyPrivate(dest, s, int64(f.UncompressedSize64))
			s.Close()
			if e != nil {
				return nil, e
			}
			v, e := inspect(aapt, dest, n)
			if e != nil {
				return nil, e
			}
			if (i > 0 && (v.meta.Package != parts[0].meta.Package || v.meta.Code != parts[0].meta.Code)) || (xpkg != "" && xpkg != v.meta.Package) {
				return nil, errors.New("分包包名或版本不一致")
			}
			if toc != nil && toc[i].id != v.meta.Split {
				return nil, errors.New("toc.pb 分包身份与清单不一致")
			}
			ids = append(ids, v.meta.Split)
			parts = append(parts, v)
		}
		if toc == nil {
			idx, e = chooseFlat(ids, p)
			if e != nil {
				return nil, e
			}
		} else {
			base := -1
			seen := map[string]bool{}
			for i, id := range ids {
				if seen[id] {
					return nil, errors.New("重复 split ID")
				}
				seen[id] = true
				if id == "" {
					base = i
				} else {
					idx = append(idx, i)
				}
			}
			if base < 0 {
				return nil, errors.New("缺少基础 APK")
			}
			idx = append([]int{base}, idx...)
		}
	}
	first := parts[idx[0]]
	m := first.meta
	abis := []string{}
	selected := []string{}
	paths := []string{}
	digests := []string{}
	minSDK := m.MinSDK
	var labelID string
	for _, i := range idx {
		v := parts[i]
		if v.meta.Split != "config.zh" {
			continue
		}
		if labelID == "" {
			tree, _ := command(aapt, "dump", "xmltree", "--file", "AndroidManifest.xml", first.file)
			labelID = packageLabelID(tree)
		}
		if labelID != "" {
			res, _ := command(aapt, "dump", "resources", v.file)
			if label := chineseLabel(res, labelID); label != "" {
				m.Label = label
			}
		}
	}

	for _, i := range idx {
		v := parts[i]
		minSDK = max(minSDK, v.meta.MinSDK)
		for _, a := range v.meta.ABIs {
			if !slices.Contains(abis, a) {
				abis = append(abis, a)
			}
		}
		selected = append(selected, v.name)
		paths = append(paths, filepath.Base(v.file))
		f, e := os.Open(v.file)
		if e != nil {
			return nil, e
		}
		h := sha256.New()
		_, e = io.Copy(h, f)
		f.Close()
		if e != nil {
			return nil, e
		}
		digests = append(digests, fmt.Sprintf("%x", h.Sum(nil)))
	}
	reasons := []string{}
	status := "compatible"
	if p.sdk == 0 || minSDK == 0 || (len(abis) > 0 && len(p.abis) == 0) {
		status = "unknown"
		reasons = append(reasons, "SDK 或 ABI 信息不足，无法完整判断兼容性")
	}
	if p.sdk > 0 && minSDK > p.sdk {
		status = "incompatible"
		reasons = append(reasons, fmt.Sprintf("需要 Android API %d，设备为 %d", minSDK, p.sdk))
	}
	if len(idx) > 1 && p.sdk > 0 && p.sdk < 21 {
		status = "incompatible"
		reasons = append(reasons, "分包安装需要 API 21 或更高版本")
	}
	if len(abis) > 0 && len(p.abis) > 0 && !slices.ContainsFunc(abis, func(a string) bool { return slices.Contains(p.abis, a) }) {
		status = "incompatible"
		reasons = append(reasons, "设备 ABI 与 APK 不匹配")
	}
	var sdk any
	if minSDK > 0 {
		sdk = minSDK
	}
	return map[string]any{"format": format, "label": nullable(m.Label), "packageName": m.Package, "versionCode": nullable(m.Code), "versionName": nullable(m.Version), "minSdk": sdk, "abis": abis, "iconDataUrl": first.icon, "compatibility": status, "reasons": reasons, "selectedSplits": selected, "files": paths, "digests": digests}, nil
}
func main() {
	if len(os.Args) != 6 {
		os.Exit(2)
	}
	r, e := stage(os.Args[1], os.Args[2], os.Args[3], device(os.Args[4], os.Args[5]))
	if e == nil {
		var b []byte
		b, e = json.Marshal(r)
		if e == nil {
			e = os.WriteFile(filepath.Join(os.Args[2], "report.json"), b, 0600)
		}
	}
	if e != nil {
		fmt.Fprintln(os.Stderr, e)
		os.Exit(1)
	}
}
