import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import '../styles/theme.css';

/**
 * App Router 根版面（T031）。
 *
 * `noindex, nofollow` 是硬性要求：面試題目與應試者姓名 MUST NOT 被搜尋引擎收錄
 * （憲章「公正性與安全要求」——題目一旦外流，整批場次的評分就失去意義）。
 */
export const metadata: Metadata = {
  title: 'TechInterview Pro — 面試作答',
  robots: { index: false, follow: false },
};

// 桌機限定（產品決策：本期不做行動裝置與窄視窗）
export const viewport: Viewport = { width: 1280 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
