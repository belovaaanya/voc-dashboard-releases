import { markDistribution } from './metrics.js';
import { roundShares } from './round.js';

/** Готовит согласованные для вывода доли, не отдавая округление DOM-блоку (`D-21`, `D-40`). */
export function distributionForDisplay(ratings) {
  const exact = markDistribution(ratings);
  const shares = roundShares(
    exact.map(({ share }) => share),
    exact.map(({ mark }) => mark),
  );

  return exact.map(({ mark, count }, index) => ({ mark, count, share: shares[index] }));
}
