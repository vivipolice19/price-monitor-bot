/** スプレッドシート設定の「0始まり列番号」を、人が見える A/B/C と対応させるヘルパー */
export function columnIndexToExcelLetter(index: number): string {
  if (!Number.isFinite(index) || index < 0) return "?";
  let n = Math.floor(index) + 1;
  let col = "";
  while (n > 0) {
    const remainder = (n - 1) % 26;
    col = String.fromCharCode(65 + remainder) + col;
    n = Math.floor((n - 1) / 26);
  }
  return col;
}

export function formatColumnHint(index: number): string {
  const letter = columnIndexToExcelLetter(index);
  return `${index} ＝ ${letter}列`;
}
