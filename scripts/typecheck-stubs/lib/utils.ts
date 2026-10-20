/**
 * 独立类型校验用的 cn 工具存根。
 * 真实实现在主框架的 @/lib/utils 中（由同事提供）。
 */
export type ClassValue = string | number | null | undefined | false | ClassValue[];

/** 合并 className */
export function cn(...inputs: ClassValue[]): string {
  const out: string[] = [];
  const walk = (value: ClassValue): void => {
    if (!value && value !== 0) return;
    if (typeof value === 'string' || typeof value === 'number') {
      out.push(String(value));
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(walk);
    }
  };
  inputs.forEach(walk);
  return out.join(' ');
}
