import { progressReporter } from './task-progress';
import { generateGeometry, MAX_FILL_POINTS, type GeometryJob, type FillResult } from './fill';
self.onmessage = (event: MessageEvent<GeometryJob[]>) => {
  try {
    let points = 0;
    const report = progressReporter(progress => self.postMessage({progress}));
    const results: FillResult[] = event.data.map((region, index) => {
      const result = generateGeometry(region, progress => report({label: `${progress.label} · region ${index + 1}/${event.data.length}`, fraction: progress.fraction === undefined ? undefined : (index + progress.fraction) / event.data.length}));
      points += result.paths.reduce((sum, p) => sum + p.points.length, 0);
      if (points > MAX_FILL_POINTS) throw new Error('Document fill is too dense. Increase width or spacing.');
      return result;
    });
    self.postMessage({ results });
  } catch (error) { self.postMessage({ error: (error as Error).message }); }
};
