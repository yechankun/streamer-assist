// Retain only the best rows while scanning; ties keep Map insertion order.
function rankedCounts(counts, limit, minimum = -Infinity) {
  const heap = [], worse = (a, b) => a.rank < b.rank || (a.rank === b.rank && a.order > b.order);
  let order = 0;
  for (const [text, count] of counts) {
    const ordinal = order++;
    if (!(count > minimum)) continue;
    const rank = Number(count);
    if (!Number.isFinite(rank)) return [...counts].filter(([, n]) => n > minimum).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([text, count]) => ({ text, count }));
    if (heap.length === limit && rank <= heap[0].rank) continue;
    const row = { text, count, rank, order: ordinal };
    if (heap.length < limit) {
      let i = heap.length; heap.push(row);
      while (i && worse(row, heap[(i - 1) >> 1])) { heap[i] = heap[(i - 1) >> 1]; i = (i - 1) >> 1; }
      heap[i] = row;
    } else {
      let i = 0;
      while (i * 2 + 1 < heap.length) {
        let child = i * 2 + 1;
        if (child + 1 < heap.length && worse(heap[child + 1], heap[child])) child++;
        if (!worse(heap[child], row)) break;
        heap[i] = heap[child]; i = child;
      }
      heap[i] = row;
    }
  }
  return heap.sort((a, b) => b.rank - a.rank || a.order - b.order).map(({ text, count }) => ({ text, count }));
}
module.exports = { rankedCounts };
