import createBlockDataTable from '@/migrations/0002_block_data.sql?raw';
import createMorrowConfigTable from '@/migrations/0001_morrow_config.sql?raw';

/**
 * The migration files are the single source of truth. Local development runs
 * the same statements at startup so no migration step is needed.
 */
export const schemaStatements = [createMorrowConfigTable, createBlockDataTable];

export { createMorrowConfigTable };
