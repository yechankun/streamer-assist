const { randomInt } = require("node:crypto");
function rouletteItems(input) {
  if (!Array.isArray(input) || input.length < 2 || input.length > 12)
    throw new Error("룰렛 항목은 2~12개로 설정하세요.");
  const items = input.map((item) => {
    if (
      !item ||
      typeof item.name !== "string" ||
      !item.name.trim() ||
      item.name.length > 50 ||
      !Number.isSafeInteger(item.weight) ||
      item.weight < 0 ||
      item.weight > 1000000000
    )
      throw new Error("항목은 50자 이하, 가중치는 0~10억의 정수로 입력하세요.");
    return { name: item.name.trim(), weight: item.weight };
  });
  if (new Set(items.map((item) => item.name)).size !== items.length)
    throw new Error("룰렛 항목은 서로 달라야 합니다.");
  if (!items.some((item) => item.weight > 0))
    throw new Error("하나 이상의 항목에 가중치를 설정하세요.");
  return items;
}
function spinRoulette(input, draw = randomInt) {
  const items = rouletteItems(input);
  const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
  const ticket = draw(totalWeight);
  if (!Number.isSafeInteger(ticket) || ticket < 0 || ticket >= totalWeight)
    throw new Error("룰렛 추첨 값을 생성하지 못했습니다.");
  let boundary = 0;
  const index = items.findIndex((item) => (boundary += item.weight) > ticket);
  return { index, name: items[index].name, totalWeight, items };
}
module.exports = { rouletteItems, spinRoulette };
