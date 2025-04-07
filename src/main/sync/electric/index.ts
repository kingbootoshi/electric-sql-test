/**
 * Electric module index file
 * Exports the Electric client and Shape processor
 */
import { ElectricClient } from './electric.client';
import { ShapeProcessor } from './shape.processor';
import type { ProcessedShapeEntry } from './shape.processor';

export { ElectricClient, ShapeProcessor };
export type { ProcessedShapeEntry };

export const electricClient = new ElectricClient();
export const shapeProcessor = new ShapeProcessor();

export default {
  electricClient,
  shapeProcessor
};
