export function isStatisticsDateTick(index, length) {
  return index === 0 || index === length - 1 || index % 5 === 0;
}

export function buildLineChartPoints(daily, field, maxValue, width = 900, height = 190) {
  return daily.map((item, index) => {
    const value = item[field] == null ? null : Number(item[field]);
    return {
      date: item.date,
      value,
      x: daily.length > 1 ? index * width / (daily.length - 1) : width / 2,
      y: value == null ? null : height * (1 - Math.min(1, Math.max(0, value / maxValue))),
      overflow: value != null && value > maxValue
    };
  });
}

export function buildLineChartSegments(points) {
  const segments = [];
  let segment = [];
  for (const point of points) {
    if (point.y == null) {
      if (segment.length) segments.push(segment);
      segment = [];
    } else segment.push(point);
  }
  if (segment.length) segments.push(segment);
  return segments;
}
