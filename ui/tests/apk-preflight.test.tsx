import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import type { PackageReport } from '@/lib/bridge';
import { ApkPreflight } from '@/components/ApkPreflight';

afterEach(cleanup);
it('展示兼容性原因和真实选包名，只使用内嵌 PNG 图标', () => {
  const result: PackageReport = {
    token: 'test', format: 'apks', packageName: 'org.example.qa', label: '测试播放器',
    iconDataUrl: 'https://invalid.test/tracker', versionName: '1.7', versionCode: '7', minSdk: 28,
    compatibility: 'incompatible', reasons: ['需要 API 28'], abis: ['arm64-v8a'],
    selectedSplits: ['base.apk', 'config.zh.apk'],
  };
  const { container } = render(<ApkPreflight result={result} />);
  expect(screen.getByRole('status').textContent).toContain('设备不兼容 · 需要 API 28');
  expect(screen.getByText('config.zh.apk')).toBeTruthy();
  expect(container.querySelector('img')).toBeNull();
});
