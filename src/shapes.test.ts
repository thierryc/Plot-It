// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { SHAPES, shapeItem } from './shapes';
import { elements, markupRoot } from './editor';
import { initialState } from './model';
import { parsePlotIt, serializePlotIt } from './document-file';

describe('inserted shapes', () => {
  it('creates centered editable geometry within small and regular papers that round-trips in documents', () => {
    for (const paper of [{ name: 'Small', width: 10, height: 20 }, initialState.paper]) {
      const state = structuredClone(initialState); state.paper = paper;
      state.items = SHAPES.map(shape => shapeItem(shape.id, paper, '#123456'));
      expect(new Set(state.items.map(item => item.id)).size).toBe(SHAPES.length);
      for (const item of state.items) {
        expect(item.x + item.width / 2).toBeCloseTo(paper.width / 2);
        expect(item.y + item.height / 2).toBeCloseTo(paper.height / 2);
        expect(item.x).toBeGreaterThanOrEqual(0); expect(item.y).toBeGreaterThanOrEqual(0);
        expect(elements(markupRoot(item.markup))).toHaveLength(1);
        expect(item.stroke).toBe('#123456');
      }
      const restored = parsePlotIt(serializePlotIt(state)).state;
      expect(restored.items.map(item => [item.name, item.width, item.height, elements(markupRoot(item.markup))[0]!.localName]))
        .toEqual(state.items.map(item => [item.name, item.width, item.height, elements(markupRoot(item.markup))[0]!.localName]));
    }
  });
});
