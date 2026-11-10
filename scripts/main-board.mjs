const MAIN_BOARD_CODE = /^(600|601|603|605|000|001|002|003)\d{3}$/;

export function isMainBoardCode(code) {
  return MAIN_BOARD_CODE.test(String(code ?? "").trim());
}

export function filterMainBoard(items) {
  return items.filter((item) => isMainBoardCode(item?.code));
}
