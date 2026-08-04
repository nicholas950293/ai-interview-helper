import { describe, it, expect } from 'vitest';
import { formatRemaining, phaseFor, WARNING_THRESHOLD_SEC } from '../../src/lib/use-countdown';
import { computeRemainingSec } from '../../src/store/selectors';

/**
 * 計時顯示與警示門檻（FR-020 / contracts/ui-contracts.md「倒數計時器」）。
 *
 * 憲章原則 III：計時邊界 MUST 以假時鐘驗證，MUST NOT 僅以手動點擊驗收——
 * 一次計時錯誤就是一位應試者的實質損害。
 */
describe('倒數顯示格式', () => {
  it('一小時以上顯示 h:mm:ss', () => {
    expect(formatRemaining(3661)).toBe('1:01:01');
  });

  it('一小時以內顯示 mm:ss', () => {
    expect(formatRemaining(305)).toBe('05:05');
  });

  it('個位數補零', () => {
    expect(formatRemaining(9)).toBe('00:09');
  });

  it('歸零顯示 00:00', () => {
    expect(formatRemaining(0)).toBe('00:00');
  });

  it('負值不顯示負號（時間不會倒流）', () => {
    expect(formatRemaining(-30)).toBe('00:00');
  });
});

describe('警示門檻（剩餘不足 5 分鐘）', () => {
  it('5 分 01 秒仍為一般樣式', () => {
    expect(phaseFor(WARNING_THRESHOLD_SEC + 1)).toBe('normal');
  });

  it('剛好 5 分鐘即轉為警示', () => {
    expect(phaseFor(WARNING_THRESHOLD_SEC)).toBe('warning');
  });

  it('5 分 01 秒經過 2 秒後轉為警示（spec US4 情境 1）', () => {
    expect(phaseFor(301)).toBe('normal');
    expect(phaseFor(299)).toBe('warning');
  });

  it('歸零為 expired，與 warning 可區分', () => {
    expect(phaseFor(0)).toBe('expired');
    expect(phaseFor(1)).toBe('warning');
  });
});

describe('剩餘秒數由 deadlineAt 與校時偏移推導（R-007）', () => {
  const now = Date.parse('2026-08-04T10:00:00.000Z');

  it('無偏移時直接相減', () => {
    const deadline = new Date(now + 600_000).toISOString();
    expect(computeRemainingSec(deadline, 0, now)).toBe(600);
  });

  it('本地時鐘快 10 秒時，剩餘時間相應減少（以伺服端為準）', () => {
    const deadline = new Date(now + 600_000).toISOString();
    // clockOffset = serverTime - clientTime；本地快 10 秒 → offset 為 -10000
    expect(computeRemainingSec(deadline, -10_000, now)).toBe(610);
  });

  it('本地時鐘慢 10 秒時同樣以伺服端為準', () => {
    const deadline = new Date(now + 600_000).toISOString();
    expect(computeRemainingSec(deadline, 10_000, now)).toBe(590);
  });

  it('已過 deadline 時回傳 0，不回傳負值', () => {
    const deadline = new Date(now - 5000).toISOString();
    expect(computeRemainingSec(deadline, 0, now)).toBe(0);
  });

  it('尚未取得 deadlineAt 時回傳 0', () => {
    expect(computeRemainingSec(null, 0, now)).toBe(0);
  });

  it('不足一秒的餘數向下取整，避免顯示跳動', () => {
    const deadline = new Date(now + 1500).toISOString();
    expect(computeRemainingSec(deadline, 0, now)).toBe(1);
  });
});
