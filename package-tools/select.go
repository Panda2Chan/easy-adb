package main

import (
	"errors"
	"slices"
	"sort"
	"strings"
)

var abiNames = []string{"armeabi", "armeabi-v7a", "arm64-v8a", "x86", "x86_64", "mips", "mips64", "riscv64"}
var densities = map[string]int{"ldpi": 120, "mdpi": 160, "tvdpi": 213, "hdpi": 240, "xhdpi": 320, "xxhdpi": 480, "xxxhdpi": 640}

// Android 倾向于从大图缩小；不能单纯按绝对差值选密度。
func bestDensity(opts []int, target int) int {
	sort.Ints(opts)
	for i, high := range opts {
		if high >= target {
			if i == 0 || high == target {
				return high
			}
			low := opts[i-1]
			if (2*low-target)*high > target*target {
				return low
			}
			return high
		}
	}
	return opts[len(opts)-1]
}
func chooseFlat(ids []string, p profile) ([]int, error) {
	base := -1
	abis := map[string]int{}
	ds := map[int]int{}
	seen := map[string]bool{}
	var picked []int
	for i, id := range ids {
		if seen[id] {
			return nil, errors.New("重复 split ID 或多个基础包")
		}
		seen[id] = true
		if id == "" {
			base = i
			continue
		}
		if !strings.HasPrefix(id, "config.") {
			return nil, errors.New("无法确定功能模块的依赖或交付条件：" + id)
		}
		tag := strings.TrimPrefix(id, "config.")
		known := false
		for _, a := range abiNames {
			if strings.ReplaceAll(a, "-", "_") == tag {
				abis[a] = i
				known = true
				break
			}
		}
		if known {
			continue
		}
		if dpi, ok := densities[tag]; ok {
			ds[dpi] = i
			continue
		}
		if len(tag) == 2 && tag[0] >= 'a' && tag[0] <= 'z' && tag[1] >= 'a' && tag[1] <= 'z' {
			if p.locale == "" {
				return nil, errors.New("无法读取设备语言")
			}
			if strings.EqualFold(strings.Split(strings.ReplaceAll(p.locale, "_", "-"), "-")[0], tag) {
				picked = append(picked, i)
			}
			continue
		}
		return nil, errors.New("不支持的配置分包：" + id)
	}
	if base < 0 {
		return nil, errors.New("容器缺少基础 APK")
	}
	if len(abis) > 0 {
		match := false
		for _, a := range p.abis {
			if i, ok := abis[a]; ok {
				picked = append(picked, i)
				match = true
				break
			}
		}
		if !match {
			return nil, errors.New("设备 ABI 未知或没有匹配分包")
		}
	}
	if len(ds) > 0 {
		if p.density <= 0 {
			return nil, errors.New("无法读取设备密度")
		}
		var d []int
		for n := range ds {
			d = append(d, n)
		}
		picked = append(picked, ds[bestDensity(d, p.density)])
	}
	slices.Sort(picked)
	return append([]int{base}, picked...), nil
}
