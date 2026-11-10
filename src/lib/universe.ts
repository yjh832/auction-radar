const MAIN_BOARD_CODE = /^(600|601|603|605|000|001|002|003)\d{3}$/;

export function isMainBoardCode(code: string) {
  return MAIN_BOARD_CODE.test(String(code).trim());
}

export function filterMainBoard<T extends { code: string }>(items: T[]) {
  return items.filter((item) => isMainBoardCode(item.code));
}
