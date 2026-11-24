package main

import (
	"encoding/binary"
	"errors"
	"fmt"
	"slices"
	"strings"
)

// 只解析官方 commands.proto / targeting.proto 中参与选择的字段；未知定向维度拒绝安装。
type field struct {
	num   int
	value uint64
	data  []byte
}
type message []field

func decode(b []byte) (message, error) {
	var m message
	for len(b) > 0 {
		key, n := binary.Uvarint(b)
		if n <= 0 || key>>3 == 0 || len(m) >= 10000 {
			return nil, errors.New("无效 toc.pb")
		}
		b = b[n:]
		v, n := binary.Uvarint(b)
		if n <= 0 {
			return nil, errors.New("截断的 toc.pb")
		}
		b = b[n:]
		f := field{num: int(key >> 3)}
		switch key & 7 {
		case 0:
			f.value = v
		case 2:
			if v > uint64(len(b)) {
				return nil, errors.New("无效 toc.pb 长度")
			}
			f.data = b[:v]
			b = b[v:]
		default:
			return nil, errors.New("不支持的 toc.pb 字段类型")
		}
		m = append(m, f)
	}
	return m, nil
}
func (m message) all(k int) [][]byte {
	var a [][]byte
	for _, f := range m {
		if f.num == k {
			a = append(a, f.data)
		}
	}
	return a
}
func (m message) one(k int) []byte {
	for _, f := range m {
		if f.num == k {
			return f.data
		}
	}
	return nil
}
func (m message) number(k int) int {
	for _, f := range m {
		if f.num == k {
			return int(f.value)
		}
	}
	return 0
}
func matched(b []byte, variant bool, p profile) (bool, error) {
	m, e := decode(b)
	if e != nil {
		return false, e
	}
	for _, f := range m {
		dim := map[int]string{1: "abi", 3: "lang", 4: "dpi", 5: "sdk"}[f.num]
		if variant {
			dim = map[int]string{1: "sdk", 2: "abi", 3: "dpi"}[f.num]
		}
		if dim == "" {
			return false, fmt.Errorf("不支持的 APKS 定向维度 %d", f.num)
		}
		s, e := decode(f.data)
		if e != nil {
			return false, e
		}
		var values, alts []int
		for _, v := range s {
			if v.num != 1 && v.num != 2 {
				return false, errors.New("不支持的定向条件")
			}
			var n int
			if dim == "lang" {
				if p.locale == "" {
					return false, errors.New("设备语言未知")
				}
				if strings.EqualFold(strings.Split(strings.ReplaceAll(p.locale, "_", "-"), "-")[0], string(v.data)) {
					n = 1
				}
			} else {
				item, e := decode(v.data)
				if e != nil {
					return false, e
				}
				switch dim {
				case "abi":
					idx := item.number(1)
					if idx < 1 || idx > len(abiNames) {
						return false, errors.New("未知 ABI")
					}
					n = slices.Index(p.abis, abiNames[idx-1]) + 1
				case "sdk":
					min, e := decode(item.one(1))
					if e != nil {
						return false, e
					}
					n = min.number(1)
				case "dpi":
					n = item.number(2)
					if n == 0 {
						idx := item.number(1)
						d := []int{0, 0, 120, 160, 213, 240, 320, 480, 640}
						if idx < 2 || idx >= len(d) {
							return false, errors.New("未知屏幕密度")
						}
						n = d[idx]
					}
				}
			}
			if v.num == 1 {
				values = append(values, n)
			} else {
				alts = append(alts, n)
			}
		}
		all := append(slices.Clone(values), alts...)
		if len(all) == 0 {
			continue
		}
		best := -1
		switch dim {
		case "abi":
			if len(p.abis) == 0 {
				return false, errors.New("设备 ABI 未知")
			}
			for _, n := range all {
				if n > 0 && (best < 0 || n < best) {
					best = n
				}
			}
		case "sdk":
			if p.sdk <= 0 {
				return false, errors.New("设备 SDK 未知")
			}
			for _, n := range all {
				if n <= p.sdk && n > best {
					best = n
				}
			}
		case "lang":
			best = 1
		case "dpi":
			if p.density <= 0 {
				return false, errors.New("设备密度未知")
			}
			best = bestDensity(all, p.density)
		}
		if !(slices.Contains(values, best) || (len(values) == 0 && !slices.Contains(alts, best))) {
			return false, nil
		}
	}
	return true, nil
}

type tocEntry struct{ path, id string }

func selectToc(data []byte, p profile) ([]tocEntry, error) {
	root, e := decode(data)
	if e != nil {
		return nil, e
	}
	if root.one(3) != nil || root.one(6) != nil || root.one(7) != nil {
		return nil, errors.New("暂不支持带资产切片或默认定向的 APKS")
	}
	rank := -1
	var chosen message
	for _, b := range root.all(1) {
		v, e := decode(b)
		if e != nil {
			return nil, e
		}
		ok, e := matched(v.one(1), true, p)
		if e != nil {
			return nil, e
		}
		if ok && v.number(3) >= rank {
			if v.number(3) == rank {
				return nil, errors.New("APKS 变体优先级冲突")
			}
			rank = v.number(3)
			chosen = v
		}
	}
	if rank < 0 {
		return nil, errors.New("没有匹配设备的 APKS 变体")
	}
	var out []tocEntry
	for _, b := range chosen.all(2) {
		set, e := decode(b)
		if e != nil {
			return nil, e
		}
		module, e := decode(set.one(1))
		if e != nil {
			return nil, e
		}
		if module.number(2) == 1 || module.number(6) == 2 {
			continue
		}
		if module.number(6) > 2 || len(module.one(5)) > 0 || module.one(8) != nil || module.number(3) != 0 {
			return nil, errors.New("不支持此模块的交付条件")
		}
		for _, b := range set.all(2) {
			apk, e := decode(b)
			if e != nil {
				return nil, e
			}
			ok, e := matched(apk.one(1), false, p)
			if e != nil {
				return nil, e
			}
			if !ok {
				continue
			}
			if apk.one(3) == nil && apk.one(4) == nil {
				return nil, errors.New("不支持此 APKS 交付类型")
			}
			meta, e := decode(apk.one(3))
			if e != nil {
				return nil, e
			}
			out = append(out, tocEntry{string(apk.one(2)), string(meta.one(1))})
		}
	}
	return out, nil
}
