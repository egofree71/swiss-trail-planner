/**
 * Business context: protects the small public routing facade. Grid behaviour is
 * tested in routingGrid.test.ts; this suite only ensures the compatibility
 * re-export remains available to existing callers.
 */
import { describe, expect, it } from 'vitest';
import { createLocalCellKeys as publicCreateLocalCellKeys } from './dynamicRoutingNetwork';
import { createLocalCellKeys } from './routingGrid';

describe('dynamicRoutingNetwork public facade', () => {
  it('re-exports the routing-grid helper without wrapping it', () => {
    expect(publicCreateLocalCellKeys).toBe(createLocalCellKeys);
  });
});
