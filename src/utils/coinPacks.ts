// i18n-ignore-file: ids, numbers and prices; the website writes the words.
// The packs of ceramos that are sold (besides the plans of a person): what each one gives and what it costs. One list for the bot and the website (the website asks the catalog),
// so the page, the payment and the ceramos that arrive can never disagree. The price here is the one the page shows; the charge is the one of the product in Polar, so they are kept equal by hand.
// Written in TypeScript: `npm run build:ts` compiles it over utils/coinPacks.js.
export interface CoinPack { id: string; coins: number; price: number }

export const COIN_PACKS: readonly CoinPack[] = [
  { id: 'pile', coins: 500, price: 2.99 },
  { id: 'small-bag', coins: 850, price: 4.99 },
  { id: 'big-bag', coins: 1200, price: 7.99 },
  { id: 'chest', coins: 2000, price: 11.99 },
];

export const packById = (id: unknown): CoinPack | null => COIN_PACKS.find((pack) => pack.id === id) ?? null;
