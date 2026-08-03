// Een handvol verzoeken tegelijk in plaats van één voor één. Een labelsleep is
// tweehonderd keer hetzelfde verzoek; achter elkaar duurt dat minuten, allemaal
// tegelijk loopt tegen Gmail's quotum aan.
//
// De uitkomsten staan in de volgorde van de invoer, ook al komen ze door elkaar
// binnen: de bestandsnamen van een labelsleep zijn genummerd, dus die volgorde
// mag niet van het toeval afhangen.
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}
