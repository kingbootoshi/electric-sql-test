/**
 * Shape processor for ElectricSQL
 * Responsible for parsing shape log entries into structured data
 */
import { getLogger } from '../../logging';
import { ElectricError } from '../../error/app.error';

const logger = getLogger('ShapeProcessor');

/**
 * Shape entry processing result
 */
export interface ProcessedShapeEntry {
  operation: 'insert' | 'update' | 'delete';
  id: string; // Extracted ID
  value: Record<string, any> | null; // Full data for insert/update
}

// Re-export for consistent importing
export type { ProcessedShapeEntry };

/**
 * Shape processor class
 */
export class ShapeProcessor {
  /**
   * Process shape log entries into a standardized format
   * @param entries The raw shape log entries from ElectricSQL
   * @returns Processed entries in a standard format
   */
  public processShapeLogEntries(entries: any[]): ProcessedShapeEntry[] {
    const results: ProcessedShapeEntry[] = [];
    let controlSkippedCount = 0;
    let processedDataCount = 0;
    let invalidSkippedCount = 0;
    
    // Add defensive check for non-array input
    if (!Array.isArray(entries)) {
      logger.warn('Received non-array input:', entries);
      return [];
    }
    
    logger.verbose('Raw shape entries received:', 
      entries.length > 0 ? JSON.stringify(entries.slice(0, 5)) + (entries.length > 5 ? ' (truncated)' : '') : '[]');
    
    try {
      for (const entry of entries) {
        // Skip control messages
        if (entry.headers && entry.headers.control) {
          controlSkippedCount++;
          logger.debug('Skipping control message:', entry.headers);
          continue;
        }
        
        // Ensure essential parts exist
        if (entry.headers?.operation && entry.key) {
          const operation = entry.headers.operation as 'insert' | 'update' | 'delete';
          
          // Extract ID from key (e.g., "public"."todos"/"uuid-goes-here")
          const keyParts = entry.key.split('/');
          const idWithQuotes = keyParts[keyParts.length - 1];
          const id = idWithQuotes?.replace(/"/g, ''); // Remove quotes
          
          if (!id) {
            logger.warn('Skipping entry with invalid key:', entry.key);
            invalidSkippedCount++;
            continue;
          }
          
          const value = entry.value || null; // Use value if present
          
          results.push({ operation, id, value });
          processedDataCount++; // Increment counter
        } else {
          invalidSkippedCount++;
          logger.warn('Skipping invalid entry:', JSON.stringify(entry).substring(0, 500));
        }
      }
      
      logger.info(`Processing summary: ${processedDataCount} data entries processed, ${controlSkippedCount} control messages skipped, ${invalidSkippedCount} invalid entries skipped`);
    } catch (error) {
      logger.error('Error processing entries:', error);
      throw new ElectricError(`Failed to process shape entries: ${(error as Error).message}`);
    }
    
    return results;
  }
}

// Export as singleton
export const shapeProcessor = new ShapeProcessor();
export default shapeProcessor;