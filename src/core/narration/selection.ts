/** Click selection is one closed interval in manuscript order. */
export function selectNarrationSentence(
  orderedIds: readonly string[],
  selectedIds: readonly string[],
  clickedId: string,
  only = false,
): string[] {
  const clicked = orderedIds.indexOf(clickedId)
  if (clicked < 0) return [...selectedIds]
  if (only || !selectedIds.length) return [clickedId]
  const indices = selectedIds.map((id) => orderedIds.indexOf(id)).filter((index) => index >= 0)
  if (!indices.length) return [clickedId]
  const first = Math.min(...indices),
    last = Math.max(...indices)
  if (clicked < first || clicked > last)
    return orderedIds.slice(Math.min(first, clicked), Math.max(last, clicked) + 1)
  if (clicked === first) return orderedIds.slice(first + 1, last + 1)
  return orderedIds.slice(first, clicked)
}
