// @vitest-environment jsdom
import {it,expect} from 'vitest';
import {workloadPreview} from './workload-preview';
it('shows static reviewable checkpoint coordinates and source identity only when enabled',()=>{
 expect(workloadPreview(undefined)).toBeNull();
 const preview=workloadPreview({cuts:[{point:{x:25,y:40},identity:{sourceId:'wave',strokeIndex:0,reloadIndex:0,chunkIndex:2,sourceFromMm:20,sourceToMm:40}}],chunkCount:2,addedDurationMs:500});
 expect(preview?.querySelector('circle')?.getAttribute('cx')).toBe('25');expect(preview?.querySelector('circle')?.getAttribute('cy')).toBe('40');expect(preview?.textContent).toContain('wave, stroke 1, chunk 3');expect(preview?.textContent).toContain('lift and lower');
});
